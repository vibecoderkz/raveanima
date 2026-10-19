import { useEffect, useRef, useState } from "react";
import { apply, clone, invert, multiply, nodeBounds, renderDocument, walkNodes, worldMatrix, type AnimaDocument, type AnimaNode, type Ctx2D, type PathPoint } from "@raveanima/core";
import { editor, editProp, editProps, getUi, images, refresh, run, setUi, smRuntime, useStore, viewDoc, type Tool } from "../store";
import { importFile } from "../platform";
import { anchorWorld, deltaToParent, hitNode, localBounds, screenMat, toScreen, toWorld, traceNode, type View } from "./geometry";
import { dragPoint, drawPathEditor, hitPath, toLocal, type PathHit } from "./pathEdit";
import { snapBox, snapTargets, type Guide, type SnapTargets } from "./snap";
import type { Bounds, PathNode } from "@raveanima/core";

const ACCENT = "#ff3b2e";
const HANDLES: [number, number][] = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];

type Drag =
  | { kind: "pan"; sx: number; sy: number; px: number; py: number }
  | { kind: "move"; wx: number; wy: number; nodes: { id: string; x: number; y: number }[]; key: string; moved: boolean; box0: Bounds | null; targets: SnapTargets }
  | { kind: "vertex"; hit: Exclude<PathHit, null | { kind: "segment" }>; key: string }
  | { kind: "marquee"; wx: number; wy: number; cx: number; cy: number; additive: boolean }
  | { kind: "create"; type: Exclude<Tool, "select" | "pen" | "text">; wx: number; wy: number; cx: number; cy: number }
  | { kind: "scale"; id: string; u: number; v: number; node0: AnimaNode; inv0: ReturnType<typeof invert>; a0: { x: number; y: number }; key: string }
  | { kind: "rotate"; id: string; cx: number; cy: number; a0: number; r0: number; key: string }
  | { kind: "penHandle"; index: number };

interface Pen {
  points: PathPoint[]; // world space
}

const view = (): View => ({ zoom: getUi().zoom, panX: getUi().panX, panY: getUi().panY });

/** Selected top-level node for a hit: clicks select whole groups unless deep is set. */
function pickTarget(doc: AnimaDocument, id: string, deep: boolean): string {
  if (deep) return id;
  let cur = doc.nodes[id]!;
  while (cur.parent && doc.nodes[cur.parent]) cur = doc.nodes[cur.parent]!;
  return cur.id;
}

function hitTest(doc: AnimaDocument, wx: number, wy: number, deep: boolean): string | null {
  const tol = 4 / getUi().zoom;
  let hit: string | null = null;
  walkNodes(doc, (n) => {
    if (n.locked) return;
    if (hitNode(doc, n, wx, wy, tol)) hit = n.id;
  });
  if (hit && !isVisibleChain(doc, hit)) return null;
  return hit ? pickTarget(doc, hit, deep) : null;
}

function isVisibleChain(doc: AnimaDocument, id: string): boolean {
  let cur: AnimaNode | undefined = doc.nodes[id];
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent ? doc.nodes[cur.parent] : undefined;
  }
  return true;
}

/** Oriented selection box corners (screen space) for a single shape, or null. */
function orientedBox(doc: AnimaDocument, id: string, v: View) {
  const n = doc.nodes[id];
  if (!n) return null;
  if (n.type === "group") {
    const b = nodeBounds(doc, id);
    if (!b) return null;
    const p = (x: number, y: number) => toScreen(v, x, y);
    return { at: (u: number, w: number) => p(b.x + b.width * u, b.y + b.height * w) };
  }
  const lb = localBounds(n);
  if (!lb) return null;
  const m = multiply(screenMat(v), worldMatrix(doc, id));
  return { at: (u: number, w: number) => apply(m, lb.minX + (lb.maxX - lb.minX) * u, lb.minY + (lb.maxY - lb.minY) * w) };
}

function handleAt(doc: AnimaDocument, sx: number, sy: number): { kind: "scale"; u: number; v: number } | { kind: "rotate" } | null {
  const sel = editor.state.selection;
  if (sel.length !== 1 || doc.nodes[sel[0]!]?.locked || getUi().editPath === sel[0]) return null;
  const box = orientedBox(doc, sel[0]!, view());
  if (!box) return null;
  for (const [u, v] of HANDLES) {
    const p = box.at(u, v);
    if (Math.hypot(p.x - sx, p.y - sy) < 7) return { kind: "scale", u, v };
  }
  for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
    const p = box.at(u, v);
    const c = box.at(0.5, 0.5);
    const d = Math.hypot(p.x - sx, p.y - sy);
    const outward = Math.hypot(sx - c.x, sy - c.y) > Math.hypot(p.x - c.x, p.y - c.y);
    if (d < 22 && outward) return { kind: "rotate" };
  }
  return null;
}

function fitView(el: HTMLElement) {
  const d = editor.doc;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (!w || !h) return;
  const zoom = Math.min((w - 120) / d.width, (h - 120) / d.height, 2);
  setUi({ zoom, panX: (w - d.width * zoom) / 2, panY: (h - d.height * zoom) / 2 });
}

export function Canvas() {
  useStore();
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const pen = useRef<Pen | null>(null);
  const hover = useRef<string | null>(null);
  const space = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });
  const selPoint = useRef<number | null>(null);
  const pathHover = useRef<PathHit>(null);
  const guides = useRef<Guide[]>([]);
  const [textEdit, setTextEdit] = useState<string | null>(null);

  const draw = () => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext("2d")!;
    const v = view();
    const doc = viewDoc();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);

    // Artboard with a soft, deep shadow, then the content clipped to it.
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ab = { x: v.panX, y: v.panY, w: doc.width * v.zoom, h: doc.height * v.zoom };
    ctx.shadowColor = "rgba(10,10,11,0.10)";
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 18;
    ctx.fillStyle = "#fff";
    ctx.fillRect(ab.x, ab.y, ab.w, ab.h);
    ctx.restore();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.rect(ab.x, ab.y, ab.w, ab.h);
    ctx.clip();
    renderDocument(ctx as unknown as Ctx2D, doc, { scale: dpr * v.zoom, offsetX: dpr * v.panX, offsetY: dpr * v.panY, images });
    ctx.restore();

    // Overlays in CSS pixels.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "600 11px SFT, sans-serif";
    ctx.fillStyle = "#6c6c74";
    if (getUi().smPreview) {
      ctx.fillStyle = ACCENT;
      ctx.fillText(`Preview: ${smRuntime?.sm.name ?? ""} / ${smRuntime?.current.state.name ?? ""}`, ab.x, ab.y - 10);
      return;
    }
    ctx.fillText(`${doc.name}  ${doc.width} x ${doc.height}`, ab.x, ab.y - 10);
    const sm = screenMat(v);
    const sel = editor.state.selection;

    if (hover.current && !sel.includes(hover.current) && doc.nodes[hover.current] && !drag.current) {
      ctx.beginPath();
      traceNode(ctx, doc, hover.current, sm);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    for (const id of sel) {
      if (!doc.nodes[id]) continue;
      ctx.beginPath();
      traceNode(ctx, doc, id, sm);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (sel.length === 1 && getUi().editPath !== sel[0]) {
      const box = orientedBox(doc, sel[0]!, v);
      if (box) {
        const corners = [box.at(0, 0), box.at(1, 0), box.at(1, 1), box.at(0, 1)];
        ctx.beginPath();
        corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1;
        ctx.stroke();
        for (const [u, w] of HANDLES) {
          const p = box.at(u, w);
          ctx.beginPath();
          ctx.rect(p.x - 4, p.y - 4, 8, 8);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.stroke();
        }
        // Pivot marker.
        const n = doc.nodes[sel[0]!]!;
        const pv = apply(multiply(sm, n.parent ? worldMatrix(doc, n.parent) : [1, 0, 0, 1, 0, 0]), n.transform.x, n.transform.y);
        ctx.beginPath();
        ctx.arc(pv.x, pv.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = ACCENT;
        ctx.fill();
      }
    } else if (sel.length > 1) {
      const bs = sel.map((id) => nodeBounds(doc, id)).filter(Boolean) as NonNullable<ReturnType<typeof nodeBounds>>[];
      if (bs.length) {
        const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
        const x1 = Math.max(...bs.map((b) => b.x + b.width)), y1 = Math.max(...bs.map((b) => b.y + b.height));
        const a = toScreen(v, x0, y0), b = toScreen(v, x1, y1);
        ctx.strokeStyle = ACCENT;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.setLineDash([]);
      }
    }

    const ep = getUi().editPath;
    const epNode = ep ? doc.nodes[ep] : null;
    if (epNode?.type === "path") drawPathEditor(ctx, doc, epNode, v, selPoint.current, pathHover.current);
    if (guides.current.length) {
      ctx.save();
      ctx.strokeStyle = ACCENT;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      for (const g of guides.current) {
        ctx.beginPath();
        if (g.axis === "x") {
          const x = toScreen(v, g.at, 0).x;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
        } else {
          const y = toScreen(v, 0, g.at).y;
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    const d = drag.current;
    if (d?.kind === "marquee") {
      const a = toScreen(v, d.wx, d.wy), b = toScreen(v, d.cx, d.cy);
      ctx.fillStyle = "#ff3b2e12";
      ctx.strokeStyle = ACCENT;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    if (d?.kind === "create") {
      const r = createRect(d);
      const a = toScreen(v, r.cx - r.w / 2, r.cy - r.h / 2);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (d.type === "ellipse") ctx.ellipse(a.x + (r.w * v.zoom) / 2, a.y + (r.h * v.zoom) / 2, (r.w * v.zoom) / 2, (r.h * v.zoom) / 2, 0, 0, Math.PI * 2);
      else if (d.type === "rect") ctx.rect(a.x, a.y, r.w * v.zoom, r.h * v.zoom);
      else {
        const c = toScreen(v, d.wx, d.wy);
        ctx.arc(c.x, c.y, Math.hypot(d.cx - d.wx, d.cy - d.wy) * v.zoom, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.fillStyle = ACCENT;
      ctx.font = "600 11px SFT, sans-serif";
      const label = d.type === "rect" || d.type === "ellipse" ? `${Math.round(r.w)} x ${Math.round(r.h)}` : `r ${Math.round(Math.hypot(d.cx - d.wx, d.cy - d.wy))}`;
      const lp = toScreen(v, d.cx, d.cy);
      ctx.fillText(label, lp.x + 10, lp.y + 18);
    }
    if (pen.current) drawPen(ctx, pen.current, v, pointer.current);
  };

  useEffect(draw);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    fitView(el);
    const off = editor.subscribe((e) => {
      if (e.command === "doc.load") requestAnimationFrame(() => fitView(el));
    });
    (window as unknown as { __animaFit?: () => void }).__animaFit = () => fitView(el);
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) space.current = true;
      if (pen.current && (e.key === "Enter" || e.key === "Escape")) {
        finishPen(false);
        e.stopPropagation();
      }
      const ep = getUi().editPath;
      if (ep && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        if (e.key === "Enter" || e.key === "Escape") {
          setUi({ editPath: null });
          selPoint.current = null;
          e.stopPropagation();
        } else if ((e.key === "Delete" || e.key === "Backspace") && selPoint.current !== null) {
          run("path.deletePoint", { id: ep, index: selPoint.current });
          selPoint.current = null;
          e.stopPropagation();
        }
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", kd, true);
    window.addEventListener("keyup", ku);
    return () => {
      ro.disconnect();
      off();
      window.removeEventListener("keydown", kd, true);
      window.removeEventListener("keyup", ku);
    };
  }, []);

  // Abandon an unfinished pen path when switching tools.
  const tool = getUi().tool;
  useEffect(() => {
    if (tool !== "pen" && pen.current) finishPen(false);
  }, [tool]);

  function finishPen(close: boolean) {
    const p = pen.current;
    pen.current = null;
    if (!p || p.points.length < 2) return draw();
    const xs = p.points.map((q) => q.x), ys = p.points.map((q) => q.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    run("node.add", {
      type: "path",
      props: {
        name: close ? "Shape" : "Path",
        points: p.points.map((q) => ({ ...q, x: q.x - cx, y: q.y - cy })),
        closed: close,
        fill: close ? "#ff3b2e" : null,
        stroke: close ? null : { paint: "#0a0a0b", width: 4 },
        transform: { x: cx, y: cy },
      },
    });
    setUi({ tool: "select" });
  }

  const local = (e: React.PointerEvent | React.WheelEvent) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // State machine preview: the canvas behaves like the player, pointer events go to listeners, nothing is editable.
  const previewHover = useRef<string | null>(null);
  const previewPointer = (e: React.PointerEvent, kind: "move" | "down" | "up") => {
    const rt = smRuntime;
    if (!rt) return;
    const s = local(e);
    const w = toWorld(view(), s.x, s.y);
    const doc = viewDoc();
    let hit: string | null = null;
    walkNodes(doc, (n) => {
      if (n.type !== "group" && hitNode(doc, n, w.x, w.y, 2 / getUi().zoom)) hit = n.id;
    });
    if (hit && !isVisibleChain(doc, hit)) hit = null;
    const interactive = rt.interactiveNodes();
    let cur: string | null = hit, over = false;
    while (cur) {
      if (interactive.has(cur)) over = true;
      cur = doc.nodes[cur]?.parent ?? null;
    }
    cv.current!.style.cursor = over ? "pointer" : "default";
    if (kind === "move") {
      if (hit === previewHover.current) return;
      if (previewHover.current) rt.pointer("leave", previewHover.current);
      if (hit) rt.pointer("enter", hit);
      previewHover.current = hit;
    } else if (hit) {
      rt.pointer(kind, hit);
      if (kind === "up") rt.pointer("click", hit);
    }
    refresh();
  };

  const onDown = (e: React.PointerEvent) => {
    if (getUi().smPreview && e.button === 0 && !space.current) return previewPointer(e, "down");
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const s = local(e);
    const v = view();
    const w = toWorld(v, s.x, s.y);
    const ui = getUi();
    if (e.button === 1 || space.current) {
      drag.current = { kind: "pan", sx: s.x, sy: s.y, px: v.panX, py: v.panY };
      return;
    }
    if (e.button !== 0) return;
    const doc = viewDoc();
    if (ui.editPath && ui.tool === "select") {
      const node = doc.nodes[ui.editPath];
      if (node?.type === "path") {
        const hit = hitPath(doc, node, v, s.x, s.y, selPoint.current);
        if (hit?.kind === "segment") {
          const r = run<{ index: number }>("path.insertPoint", { id: node.id, index: hit.index, t: hit.t });
          if (r) selPoint.current = r.index;
          return draw();
        }
        if (hit) {
          if (hit.kind === "point") selPoint.current = hit.index;
          drag.current = { kind: "vertex", hit, key: `vtx-${Date.now()}` };
          return draw();
        }
      }
      setUi({ editPath: null });
      selPoint.current = null;
    }
    if (ui.tool === "text") {
      e.preventDefault(); // keep focus free for the inline editor that opens next
      const r = run<{ id: string }>("node.add", { type: "text", props: { text: "Text", transform: { x: Math.round(w.x), y: Math.round(w.y) } } });
      setUi({ tool: "select" });
      if (r) setTextEdit(r.id);
      return;
    }
    if (ui.tool === "pen") {
      const p = pen.current ?? (pen.current = { points: [] });
      const first = p.points[0];
      if (first && p.points.length > 1 && Math.hypot(first.x - w.x, first.y - w.y) * v.zoom < 9) return finishPen(true);
      p.points.push({ x: w.x, y: w.y, inX: 0, inY: 0, outX: 0, outY: 0 });
      drag.current = { kind: "penHandle", index: p.points.length - 1 };
      return draw();
    }
    if (ui.tool !== "select") {
      drag.current = { kind: "create", type: ui.tool, wx: w.x, wy: w.y, cx: w.x, cy: w.y };
      return;
    }
    const h = handleAt(doc, s.x, s.y);
    const sel = editor.state.selection;
    if (h && sel.length === 1) {
      const id = sel[0]!;
      const n = doc.nodes[id]!;
      const key = `xf-${Date.now()}`;
      if (h.kind === "scale") {
        if (n.type === "group") return; // groups scale via their transform in the inspector
        drag.current = { kind: "scale", id, u: h.u, v: h.v, node0: clone(n), inv0: invert(worldMatrix(doc, id)), a0: anchorWorld(doc, n, 1 - h.u, 1 - h.v), key };
      } else {
        const pw = n.parent ? worldMatrix(doc, n.parent) : ([1, 0, 0, 1, 0, 0] as const);
        const c = apply([...pw] as never, n.transform.x, n.transform.y);
        drag.current = { kind: "rotate", id, cx: c.x, cy: c.y, a0: Math.atan2(w.y - c.y, w.x - c.x), r0: n.transform.rotation, key };
      }
      return;
    }
    const hit = hitTest(doc, w.x, w.y, e.detail >= 2 || e.metaKey || e.ctrlKey);
    if (hit) {
      let next = sel;
      if (e.shiftKey) next = sel.includes(hit) ? sel.filter((x) => x !== hit) : [...sel, hit];
      else if (!sel.includes(hit)) next = [hit];
      run("select.set", { ids: next });
      if (!next.includes(hit)) return;
      const movable = next.filter((id) => !doc.nodes[id]?.locked);
      const bs = movable.map((id) => nodeBounds(doc, id)).filter(Boolean) as Bounds[];
      const box0 = bs.length
        ? { x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)), width: Math.max(...bs.map((b) => b.x + b.width)) - Math.min(...bs.map((b) => b.x)), height: Math.max(...bs.map((b) => b.y + b.height)) - Math.min(...bs.map((b) => b.y)) }
        : null;
      drag.current = { kind: "move", wx: w.x, wy: w.y, nodes: movable.map((id) => ({ id, x: doc.nodes[id]!.transform.x, y: doc.nodes[id]!.transform.y })), key: `move-${Date.now()}`, moved: false, box0, targets: snapTargets(doc, movable) };
    } else {
      if (!e.shiftKey) run("select.set", { ids: [] });
      drag.current = { kind: "marquee", wx: w.x, wy: w.y, cx: w.x, cy: w.y, additive: e.shiftKey };
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (getUi().smPreview && !drag.current) return previewPointer(e, "move");
    const s = local(e);
    pointer.current = s;
    const v = view();
    const w = toWorld(v, s.x, s.y);
    const d = drag.current;
    const doc = viewDoc();
    const c = cv.current!;
    if (!d) {
      const ep = getUi().editPath;
      const epNode = ep ? doc.nodes[ep] : null;
      if (epNode?.type === "path") {
        pathHover.current = hitPath(doc, epNode, v, s.x, s.y, selPoint.current);
        c.style.cursor = pathHover.current?.kind === "segment" ? "copy" : pathHover.current ? "move" : "default";
        draw();
        return;
      }
      if (getUi().tool === "select") {
        const h = handleAt(doc, s.x, s.y);
        c.style.cursor = h ? (h.kind === "rotate" ? "alias" : "crosshair") : space.current ? "grab" : "default";
        const hit = h ? null : hitTest(doc, w.x, w.y, e.metaKey || e.ctrlKey);
        if (hit !== hover.current) {
          hover.current = hit;
          draw();
        }
      } else {
        c.style.cursor = "crosshair";
        if (pen.current) draw();
      }
      return;
    }
    switch (d.kind) {
      case "pan":
        setUi({ panX: d.px + s.x - d.sx, panY: d.py + s.y - d.sy });
        break;
      case "move": {
        let dx = w.x - d.wx, dy = w.y - d.wy;
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        if (!d.moved && Math.hypot(dx, dy) * v.zoom < 2) return;
        d.moved = true;
        guides.current = [];
        if (d.box0 && !(e.ctrlKey || e.metaKey)) {
          const sn = snapBox({ ...d.box0, x: d.box0.x + dx, y: d.box0.y + dy }, d.targets, 6 / v.zoom);
          dx += sn.dx;
          dy += sn.dy;
          guides.current = sn.guides;
        }
        for (const n0 of d.nodes) {
          const node = doc.nodes[n0.id]!;
          const pd = deltaToParent(doc, node, dx, dy);
          editProps(n0.id, { "transform.x": round(n0.x + pd.x), "transform.y": round(n0.y + pd.y) }, d.key);
        }
        break;
      }
      case "marquee": {
        d.cx = w.x;
        d.cy = w.y;
        const x0 = Math.min(d.wx, d.cx), x1 = Math.max(d.wx, d.cx), y0 = Math.min(d.wy, d.cy), y1 = Math.max(d.wy, d.cy);
        const ids = doc.root.filter((id) => {
          const b = nodeBounds(doc, id);
          return b && b.x < x1 && b.x + b.width > x0 && b.y < y1 && b.y + b.height > y0 && doc.nodes[id]!.visible && !doc.nodes[id]!.locked;
        });
        run("select.set", { ids });
        break;
      }
      case "create":
        d.cx = w.x;
        d.cy = w.y;
        if (e.shiftKey && (d.type === "rect" || d.type === "ellipse")) {
          const m = Math.max(Math.abs(d.cx - d.wx), Math.abs(d.cy - d.wy));
          d.cx = d.wx + Math.sign(d.cx - d.wx || 1) * m;
          d.cy = d.wy + Math.sign(d.cy - d.wy || 1) * m;
        }
        draw();
        break;
      case "scale":
        scaleTo(doc, d, w, e.shiftKey);
        break;
      case "rotate": {
        let deg = d.r0 + ((Math.atan2(w.y - d.cy, w.x - d.cx) - d.a0) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        editProps(d.id, { "transform.rotation": round(deg) }, d.key);
        break;
      }
      case "vertex": {
        const id = getUi().editPath;
        const node = id ? (viewDoc().nodes[id] as PathNode | undefined) : undefined;
        if (!node) break;
        const l = toLocal(viewDoc(), node.id, v, s.x, s.y);
        editProp(node.id, "points", dragPoint(node.points, d.hit, Math.round(l.x * 100) / 100, Math.round(l.y * 100) / 100, e.altKey), d.key);
        break;
      }
      case "penHandle": {
        const p = pen.current?.points[d.index];
        if (p) {
          p.outX = w.x - p.x;
          p.outY = w.y - p.y;
          p.inX = -p.outX;
          p.inY = -p.outY;
          draw();
        }
        break;
      }
    }
  };

  const onUp = (e: React.PointerEvent) => {
    if (getUi().smPreview && !drag.current) return previewPointer(e, "up");
    const d = drag.current;
    drag.current = null;
    guides.current = [];
    if (d?.kind === "create") {
      const r = createRect(d);
      const tiny = r.w < 3 && r.h < 3;
      const radius = Math.hypot(d.cx - d.wx, d.cy - d.wy);
      const props: Record<string, unknown> =
        d.type === "rect" || d.type === "ellipse"
          ? { width: tiny ? 200 : round(r.w), height: tiny ? 200 : round(r.h), transform: { x: round(tiny ? d.wx : r.cx), y: round(tiny ? d.wy : r.cy) } }
          : { radius: tiny ? 100 : round(radius), ...(d.type === "star" ? { innerRadius: round((tiny ? 100 : radius) / 2) } : {}), transform: { x: round(d.wx), y: round(d.wy) } };
      run("node.add", { type: d.type, props });
      setUi({ tool: "select" });
    }
    draw();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (getUi().smPreview) return;
    const r = cv.current!.getBoundingClientRect();
    const v = view();
    const w = toWorld(v, e.clientX - r.left, e.clientY - r.top);
    const doc = viewDoc();
    const hit = hitTest(doc, w.x, w.y, true);
    if (!hit) return;
    const n = doc.nodes[hit]!;
    if (n.locked) return;
    if (n.type === "text") return setTextEdit(n.id);
    if (n.type === "rect" || n.type === "ellipse" || n.type === "polygon" || n.type === "star") run("node.convertToPath", { id: n.id });
    if (n.type === "path" || editor.doc.nodes[n.id]?.type === "path") {
      run("select.set", { ids: [n.id] });
      selPoint.current = null;
      setUi({ editPath: n.id, tool: "select" });
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const r = cv.current!.getBoundingClientRect();
    const w = toWorld(view(), e.clientX - r.left, e.clientY - r.top);
    for (const f of Array.from(e.dataTransfer.files)) await importFile(f, w);
  };

  const onWheel = (e: React.WheelEvent) => {
    const v = view();
    if (e.ctrlKey || e.metaKey) {
      const s = local(e);
      const zoom = Math.min(32, Math.max(0.05, v.zoom * Math.exp(-e.deltaY * 0.01)));
      const w = toWorld(v, s.x, s.y);
      setUi({ zoom, panX: s.x - w.x * zoom, panY: s.y - w.y * zoom });
    } else setUi({ panX: v.panX - e.deltaX, panY: v.panY - e.deltaY });
  };

  const ui = getUi();
  const zoomBy = (f: number) => {
    const el = wrap.current!;
    const v = view();
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    const w = toWorld(v, cx, cy);
    const zoom = Math.min(32, Math.max(0.05, v.zoom * f));
    setUi({ zoom, panX: cx - w.x * zoom, panY: cy - w.y * zoom });
  };

  return (
    <div className="stage" ref={wrap}>
      <canvas
        ref={cv}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => {
          hover.current = null;
          draw();
          if (!smRuntime || !previewHover.current) return;
          smRuntime.pointer("leave", previewHover.current);
          previewHover.current = null;
          refresh();
        }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      />
      {textEdit && <TextEditor id={textEdit} onDone={() => setTextEdit(null)} />}
      {ui.editPath && <div className="anim-badge" style={{ background: "var(--ink)", left: ui.mode === "animate" ? 300 : 12 }}>Editing points: click a segment to add, Delete removes, Alt breaks handles, Enter to finish</div>}
      {ui.mode === "animate" && <div className="anim-badge">Animate mode: edits create keyframes</div>}
      <div className="zoom">
        <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out">-</button>
        <button onClick={() => fitView(wrap.current!)} title="Fit (Shift+1)">{Math.round(ui.zoom * 100)}%</button>
        <button onClick={() => zoomBy(1.25)} title="Zoom in">+</button>
      </div>
    </div>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;

function createRect(d: { wx: number; wy: number; cx: number; cy: number }) {
  return { cx: (d.wx + d.cx) / 2, cy: (d.wy + d.cy) / 2, w: Math.abs(d.cx - d.wx), h: Math.abs(d.cy - d.wy) };
}

function scaleTo(doc: AnimaDocument, d: Extract<Drag, { kind: "scale" }>, w: { x: number; y: number }, uniform: boolean) {
  const n0 = d.node0;
  const lb = localBounds(n0)!;
  const pl = apply(d.inv0, w.x, w.y);
  const bw = lb.maxX - lb.minX || 1, bh = lb.maxY - lb.minY || 1;
  const ax = lb.minX + bw * (1 - d.u), ay = lb.minY + bh * (1 - d.v);
  const cx = lb.minX + bw * d.u, cy = lb.minY + bh * d.v;
  let fx = d.u === 0.5 ? 1 : (pl.x - ax) / (cx - ax);
  let fy = d.v === 0.5 ? 1 : (pl.y - ay) / (cy - ay);
  if (uniform) {
    const f = d.u === 0.5 ? fy : d.v === 0.5 ? fx : Math.max(Math.abs(fx), Math.abs(fy));
    fx = d.u === 0.5 && d.v !== 0.5 ? Math.abs(f) : Math.sign(fx || 1) * Math.abs(f);
    fy = Math.sign(fy || 1) * Math.abs(f);
  }
  const n1 = clone(n0);
  const values: Record<string, number> = {};
  if (n1.type === "rect" || n1.type === "ellipse") {
    n1.width = Math.max(1, Math.abs(n0.type === "rect" || n0.type === "ellipse" ? n0.width * fx : 1));
    n1.height = Math.max(1, Math.abs(n0.type === "rect" || n0.type === "ellipse" ? n0.height * fy : 1));
    values.width = round(n1.width);
    values.height = round(n1.height);
  } else {
    n1.transform.scaleX = n0.transform.scaleX * (Math.abs(fx) < 0.01 ? 0.01 : fx);
    n1.transform.scaleY = n0.transform.scaleY * (Math.abs(fy) < 0.01 ? 0.01 : fy);
    values["transform.scaleX"] = Math.round(n1.transform.scaleX * 1000) / 1000;
    values["transform.scaleY"] = Math.round(n1.transform.scaleY * 1000) / 1000;
  }
  const a1 = anchorWorld(doc, n1, 1 - d.u, 1 - d.v);
  const pd = deltaToParent(doc, n1, d.a0.x - a1.x, d.a0.y - a1.y);
  values["transform.x"] = round(n0.transform.x + pd.x);
  values["transform.y"] = round(n0.transform.y + pd.y);
  editProps(d.id, values, d.key);
}

function drawPen(ctx: CanvasRenderingContext2D, pen: Pen, v: View, mouse: { x: number; y: number }) {
  const pts = pen.points.map((p) => ({ p, s: toScreen(v, p.x, p.y) }));
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.s.x, pts[0]!.s.y);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!.p, b = pts[i]!.p;
    const c1 = toScreen(v, a.x + a.outX, a.y + a.outY), c2 = toScreen(v, b.x + b.inX, b.y + b.inY);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, pts[i]!.s.x, pts[i]!.s.y);
  }
  const last = pts[pts.length - 1]!;
  const lc = toScreen(v, last.p.x + last.p.outX, last.p.y + last.p.outY);
  ctx.bezierCurveTo(lc.x, lc.y, mouse.x, mouse.y, mouse.x, mouse.y);
  ctx.strokeStyle = "#0a0a0b";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  for (const { p, s } of pts) {
    if (p.outX || p.outY) {
      const o = toScreen(v, p.x + p.outX, p.y + p.outY), i = toScreen(v, p.x + p.inX, p.y + p.inY);
      ctx.beginPath();
      ctx.moveTo(i.x, i.y);
      ctx.lineTo(o.x, o.y);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.stroke();
      for (const q of [i, o]) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = ACCENT;
        ctx.fill();
      }
    }
    ctx.beginPath();
    ctx.rect(s.x - 4, s.y - 4, 8, 8);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
  }
}

/** Inline text editing over the canvas, committed on blur or Ctrl+Enter. */
function TextEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const doc = viewDoc();
  const n = doc.nodes[id];
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Focus after the pointer sequence that created the text has finished.
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 60);
    return () => clearTimeout(t);
  }, []);
  if (!n || n.type !== "text") return null;
  const v = view();
  const b = nodeBounds(doc, id);
  if (!b) return null;
  const a = toScreen(v, b.x, b.y);
  // Edits apply live (one undo step per session); blur just closes the editor.
  const commit = () => onDone();
  return (
    <textarea
      ref={ref}
      defaultValue={n.text}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onDone();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
      }}
      style={{
        position: "absolute",
        left: a.x - 12,
        top: a.y - 6,
        width: Math.max(80, b.width * v.zoom + 24),
        height: b.height * v.zoom + 12,
        font: `${n.fontWeight} ${n.fontSize * v.zoom}px ${n.fontFamily}`,
        lineHeight: n.lineHeight,
        textAlign: n.align,
        color: "transparent",
        caretColor: "#ff3b2e",
        background: "rgba(255,59,46,0.06)",
        border: "1.5px solid #ff3b2e",
        borderRadius: 6,
        outline: "none",
        resize: "none",
        padding: "6px 8px",
        overflow: "hidden",
        zIndex: 4,
      }}
      onInput={(e) => run("node.update", { id, props: { text: (e.target as HTMLTextAreaElement).value } }, `text-${id}`)}
    />
  );
}
