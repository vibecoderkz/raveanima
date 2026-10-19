import { z } from "zod";
import { upsertKey } from "./animation.js";
import { clone, getAnimation, getNode, insertNode, makeNode, migrateDocument, nextId } from "./doc.js";
import { defineCommand, type CommandDef } from "./editor.js";
import { invert, nodeBounds, shapeContour, splitCubic, worldMatrix, type Bounds } from "./geometry.js";
import { getProp } from "./props.js";
import { PathPointSchema } from "./schema.js";
import { parseSvg, type SvgNode } from "./svg-import.js";
import type { AnimaDocument, AnimaNode, Ease, PathPoint, Track } from "./types.js";

const Id = z.string().min(1);

/** A self-contained piece of a document: nodes (with subtrees) plus their animation tracks. */
export interface Fragment {
  format: "anima-fragment";
  roots: string[];
  nodes: Record<string, AnimaNode>;
  tracks: Record<string, Track[]>;
}

function collect(doc: AnimaDocument, ids: string[]): Fragment {
  const nodes: Record<string, AnimaNode> = {};
  const walk = (id: string) => {
    const n = getNode(doc, id);
    nodes[id] = clone(n);
    if (n.type === "group") n.children.forEach(walk);
  };
  // Skip ids whose ancestor is also copied: the subtree already contains them.
  const roots = ids.filter((id) => {
    let p = doc.nodes[id]?.parent ?? null;
    while (p) {
      if (ids.includes(p)) return false;
      p = doc.nodes[p]?.parent ?? null;
    }
    return true;
  });
  roots.forEach(walk);
  const tracks: Fragment["tracks"] = {};
  for (const a of doc.animations) {
    const ts = a.tracks.filter((t) => t.nodeId in nodes).map((t) => clone(t));
    if (ts.length) tracks[a.name] = ts;
  }
  return { format: "anima-fragment", roots, nodes, tracks };
}

/** Insert a fragment with fresh ids. Tracks go to animations with the same name, else the active one. */
function paste(doc: AnimaDocument, frag: Fragment, parent: string | null, dx: number, dy: number): string[] {
  const map = new Map<string, string>();
  for (const id of Object.keys(frag.nodes)) map.set(id, nextId(doc, "n"));
  const add = (oldId: string, par: string | null) => {
    const n = clone(frag.nodes[oldId]!);
    n.id = map.get(oldId)!;
    const kids = n.type === "group" ? n.children : [];
    if (n.type === "group") n.children = [];
    insertNode(doc, n, par);
    for (const k of kids) if (frag.nodes[k]) add(k, n.id);
  };
  for (const r of frag.roots) {
    add(r, parent);
    const n = doc.nodes[map.get(r)!]!;
    n.transform.x += dx;
    n.transform.y += dy;
  }
  migrateDocument(doc);
  for (const [animName, tracks] of Object.entries(frag.tracks)) {
    const anim = doc.animations.find((a) => a.name === animName) ?? doc.animations.find((a) => a.id === doc.activeAnimation);
    if (!anim) continue;
    for (const t of tracks) {
      const nodeId = map.get(t.nodeId);
      if (!nodeId) continue;
      const keys = t.keys.map((k) => {
        const isX = t.prop === "transform.x" && frag.roots.includes(t.nodeId);
        const isY = t.prop === "transform.y" && frag.roots.includes(t.nodeId);
        return { ...k, value: isX ? (k.value as number) + dx : isY ? (k.value as number) + dy : k.value };
      });
      anim.tracks.push({ nodeId, prop: t.prop, keys });
      anim.duration = Math.max(anim.duration, ...keys.map((k) => k.time));
    }
  }
  return frag.roots.map((r) => map.get(r)!);
}

/** Move a node by a world-space delta (handles nested, rotated parents). */
function moveWorld(doc: AnimaDocument, n: AnimaNode, dx: number, dy: number) {
  const inv = n.parent ? invert(worldMatrix(doc, n.parent)) : ([1, 0, 0, 1, 0, 0] as const);
  n.transform.x += inv[0] * dx + inv[2] * dy;
  n.transform.y += inv[1] * dx + inv[3] * dy;
}

function union(bs: Bounds[]): Bounds {
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.width)), y1 = Math.max(...bs.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function setKey(doc: AnimaDocument, animId: string | undefined, nodeId: string, prop: string, time: number, value: unknown, ease: Ease = "easeInOut") {
  const anim = getAnimation(doc, animId);
  let track = anim.tracks.find((t) => t.nodeId === nodeId && t.prop === prop);
  if (!track) anim.tracks.push((track = { nodeId, prop, keys: [] }));
  upsertKey(track, { time: +time.toFixed(4), value, ease });
  if (time > anim.duration) anim.duration = +time.toFixed(4);
}

export const PRESETS = ["fadeIn", "fadeOut", "popIn", "popOut", "slideInLeft", "slideInRight", "slideInUp", "slideInDown", "bounce", "pulse", "shake", "spin", "float", "wiggle", "draw", "blink", "heartbeat"] as const;
const PRESET_DURATION: Record<(typeof PRESETS)[number], number> = {
  fadeIn: 0.5, fadeOut: 0.5, popIn: 0.6, popOut: 0.4, slideInLeft: 0.7, slideInRight: 0.7, slideInUp: 0.7, slideInDown: 0.7,
  bounce: 0.8, pulse: 0.8, shake: 0.5, spin: 1.2, float: 2, wiggle: 0.8, draw: 1.2, blink: 0.4, heartbeat: 1,
};

function svgToNodes(doc: AnimaDocument, items: SvgNode[], parent: string | null, map: (x: number, y: number) => { x: number; y: number }, scale: number): string[] {
  const ids: string[] = [];
  for (const it of items) {
    if (it.kind === "group") {
      const g = makeNode(doc, "group", { name: it.name, opacity: it.opacity });
      insertNode(doc, g, parent);
      svgToNodes(doc, it.children, g.id, map, scale);
      ids.push(g.id);
      continue;
    }
    const contours = it.contours.map((c) => ({
      closed: c.closed,
      points: c.points.map((p) => {
        const q = map(p.x, p.y);
        return { x: q.x, y: q.y, inX: p.inX * scale, inY: p.inY * scale, outX: p.outX * scale, outY: p.outY * scale };
      }),
    }));
    // Centre the shape on its own transform so rotation and scale pivot naturally.
    const all = contours.flatMap((c) => c.points);
    if (!all.length) continue;
    const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const shift = (pts: PathPoint[]) => pts.map((p) => ({ ...p, x: p.x - cx, y: p.y - cy }));
    const mapPaint = <T extends import("./types.js").Paint>(paint: T): T => {
      if (paint.type === "linear") return { ...paint, from: rel(map(paint.from.x, paint.from.y)), to: rel(map(paint.to.x, paint.to.y)) };
      if (paint.type === "radial") return { ...paint, center: rel(map(paint.center.x, paint.center.y)), radius: paint.radius * scale };
      return paint;
    };
    const rel = (p: { x: number; y: number }) => ({ x: p.x - cx, y: p.y - cy });
    const n = makeNode(doc, "path", {
      name: it.name,
      opacity: it.opacity,
      points: shift(contours[0]!.points),
      closed: contours[0]!.closed,
      subpaths: contours.slice(1).map((c) => ({ closed: c.closed, points: shift(c.points) })),
      fillRule: it.fillRule,
      fill: mapPaint(it.fill),
      stroke: it.stroke ? { ...it.stroke, paint: mapPaint(it.stroke.paint), width: it.stroke.width * scale } : null,
      transform: { x: cx, y: cy },
    });
    insertNode(doc, n, parent);
    ids.push(n.id);
  }
  return ids;
}

export const editCommands: CommandDef[] = [
  defineCommand({
    id: "node.copy",
    title: "Copy",
    description: "Serialize nodes (with children and animation tracks) into a fragment for node.paste. The UI puts it on the clipboard.",
    params: z.object({ ids: z.array(Id).min(1) }),
    mutates: false,
    run: ({ doc }, p) => ({ fragment: collect(doc, p.ids) }),
  }),
  defineCommand({
    id: "node.paste",
    title: "Paste",
    description: "Insert a fragment from node.copy (works across documents) with fresh ids, optionally offset and into a group.",
    params: z.object({ fragment: z.object({ format: z.literal("anima-fragment") }).passthrough(), parent: Id.nullable().optional(), offsetX: z.number().default(0), offsetY: z.number().default(0) }),
    mutates: true,
    run: ({ doc, editor }, p) => {
      const ids = paste(doc, p.fragment as unknown as Fragment, p.parent ?? null, p.offsetX, p.offsetY);
      editor.state.selection = ids;
      return { ids };
    },
  }),
  defineCommand({
    id: "node.align",
    title: "Align",
    description: "Align nodes: left, center, right, top, middle, bottom. to: selection (their joint bounds; default when 2+ nodes) or artboard.",
    params: z.object({ ids: z.array(Id).min(1), align: z.enum(["left", "center", "right", "top", "middle", "bottom"]), to: z.enum(["selection", "artboard"]).optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const items = p.ids.map((id) => ({ n: getNode(doc, id), b: nodeBounds(doc, id) })).filter((x) => x.b) as { n: AnimaNode; b: Bounds }[];
      const to = p.to ?? (items.length > 1 ? "selection" : "artboard");
      const t = to === "artboard" ? { x: 0, y: 0, width: doc.width, height: doc.height } : union(items.map((i) => i.b));
      for (const { n, b } of items) {
        const dx = p.align === "left" ? t.x - b.x : p.align === "right" ? t.x + t.width - b.x - b.width : p.align === "center" ? t.x + t.width / 2 - b.x - b.width / 2 : 0;
        const dy = p.align === "top" ? t.y - b.y : p.align === "bottom" ? t.y + t.height - b.y - b.height : p.align === "middle" ? t.y + t.height / 2 - b.y - b.height / 2 : 0;
        moveWorld(doc, n, dx, dy);
      }
      return { aligned: items.length, to };
    },
  }),
  defineCommand({
    id: "node.distribute",
    title: "Distribute",
    description: "Space 3+ nodes evenly between the outermost ones (equal gaps), horizontally or vertically.",
    params: z.object({ ids: z.array(Id).min(3), axis: z.enum(["horizontal", "vertical"]) }),
    mutates: true,
    run: ({ doc }, p) => {
      const h = p.axis === "horizontal";
      const items = p.ids.map((id) => ({ n: getNode(doc, id), b: nodeBounds(doc, id)! })).filter((x) => x.b);
      items.sort((a, b) => (h ? a.b.x - b.b.x : a.b.y - b.b.y));
      const first = items[0]!.b, last = items[items.length - 1]!.b;
      const span = h ? last.x + last.width - first.x : last.y + last.height - first.y;
      const total = items.reduce((s, i) => s + (h ? i.b.width : i.b.height), 0);
      const gap = (span - total) / (items.length - 1);
      let cur = h ? first.x : first.y;
      for (const { n, b } of items) {
        const d = cur - (h ? b.x : b.y);
        moveWorld(doc, n, h ? d : 0, h ? 0 : d);
        cur += (h ? b.width : b.height) + gap;
      }
      return { gap };
    },
  }),
  defineCommand({
    id: "node.convertToPath",
    title: "Convert to path",
    description: "Turn a rect, ellipse, polygon or star into an editable path with the same look (keeps id, transform, paint and animation of shared props).",
    params: z.object({ id: Id }),
    mutates: true,
    run: ({ doc }, p) => {
      const n = getNode(doc, p.id);
      if (n.type !== "rect" && n.type !== "ellipse" && n.type !== "polygon" && n.type !== "star") throw new Error(`${n.type} cannot be converted to a path`);
      const { points, closed } = shapeContour(n);
      const geo = ["width", "height", "cornerRadius", "radius", "innerRadius", "sides", "points"];
      const rec = n as unknown as Record<string, unknown>;
      for (const k of geo) delete rec[k];
      Object.assign(rec, { type: "path", points: clone(points), closed, subpaths: [], fillRule: "nonzero" });
      for (const a of doc.animations) a.tracks = a.tracks.filter((t) => !(t.nodeId === p.id && geo.includes(t.prop)));
      return { id: n.id };
    },
  }),
  defineCommand({
    id: "path.setPoint",
    title: "Edit point",
    description: "Change one vertex of a path: any of x, y, inX, inY, outX, outY (handles are relative to the point).",
    params: z.object({ id: Id, index: z.number().int().min(0), point: PathPointSchema.partial() }),
    mutates: true,
    run: ({ doc }, p) => {
      const n = getNode(doc, p.id);
      if (n.type !== "path") throw new Error(`"${p.id}" is a ${n.type}; run node.convertToPath first`);
      const pt = n.points[p.index];
      if (!pt) throw new Error(`Point ${p.index} out of range (0..${n.points.length - 1})`);
      Object.assign(pt, Object.fromEntries(Object.entries(p.point).filter(([, v]) => v !== undefined)));
      return { point: pt };
    },
  }),
  defineCommand({
    id: "path.insertPoint",
    title: "Add point",
    description: "Split the segment that starts at `index` at parameter t (0..1) without changing the shape; returns the new point index.",
    params: z.object({ id: Id, index: z.number().int().min(0), t: z.number().min(0.001).max(0.999).default(0.5) }),
    mutates: true,
    run: ({ doc }, p) => {
      const n = getNode(doc, p.id);
      if (n.type !== "path") throw new Error(`"${p.id}" is a ${n.type}; run node.convertToPath first`);
      const a = n.points[p.index], b = n.points[(p.index + 1) % n.points.length];
      if (!a || !b || (!n.closed && p.index >= n.points.length - 1)) throw new Error(`No segment starts at point ${p.index}`);
      const q = { x0: a.x, y0: a.y, c1x: a.x + a.outX, c1y: a.y + a.outY, c2x: b.x + b.inX, c2y: b.y + b.inY, x1: b.x, y1: b.y };
      const L = splitCubic(q, 0, p.t), R = splitCubic(q, p.t, 1);
      a.outX = L.c1x - a.x;
      a.outY = L.c1y - a.y;
      b.inX = R.c2x - b.x;
      b.inY = R.c2y - b.y;
      const mid = { x: L.x1, y: L.y1, inX: L.c2x - L.x1, inY: L.c2y - L.y1, outX: R.c1x - L.x1, outY: R.c1y - L.y1 };
      n.points.splice(p.index + 1, 0, mid);
      for (const anim of doc.animations) anim.tracks = anim.tracks.filter((t) => !(t.nodeId === p.id && t.prop === "points"));
      return { index: p.index + 1 };
    },
  }),
  defineCommand({
    id: "path.deletePoint",
    title: "Delete point",
    description: "Remove a vertex from a path (a path keeps at least 2 points).",
    params: z.object({ id: Id, index: z.number().int().min(0) }),
    mutates: true,
    run: ({ doc }, p) => {
      const n = getNode(doc, p.id);
      if (n.type !== "path") throw new Error(`"${p.id}" is a ${n.type}`);
      if (n.points.length <= 2) throw new Error("A path needs at least 2 points");
      n.points.splice(p.index, 1);
      for (const anim of doc.animations) anim.tracks = anim.tracks.filter((t) => !(t.nodeId === p.id && t.prop === "points"));
      return { points: n.points.length };
    },
  }),
  defineCommand({
    id: "anim.preset",
    title: "Animation preset",
    description: `Add a ready-made motion to a node, relative to its current pose, starting at \`time\`: ${PRESETS.join(", ")}. duration defaults per preset; distance (px) for slides/bounce/float/shake. Creates an animation if none exists.`,
    params: z.object({ nodeId: Id, preset: z.enum(PRESETS), time: z.number().min(0).default(0), duration: z.number().positive().optional(), distance: z.number().positive().optional(), animation: Id.optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const n = getNode(doc, p.nodeId);
      if (!doc.animations.length) {
        const a = { id: nextId(doc, "a"), name: "Animation", duration: 2, loop: "loop" as const, tracks: [] };
        doc.animations.push(a);
        doc.activeAnimation = a.id;
      }
      const t0 = p.time;
      const d = p.duration ?? PRESET_DURATION[p.preset];
      const k = (prop: string, frames: [number, unknown, Ease?][]) => {
        if (getProp(n, prop) === undefined) throw new Error(`Preset "${p.preset}" needs "${prop}", which a ${n.type} node does not have`);
        for (const [f, v, e] of frames) setKey(doc, p.animation, n.id, prop, t0 + f * d, v, e ?? "easeInOut");
      };
      const { x, y, rotation: r, scaleX: sx, scaleY: sy } = n.transform;
      const o = n.opacity;
      const dist = p.distance;
      switch (p.preset) {
        case "fadeIn": k("opacity", [[0, 0, "easeOut"], [1, o]]); break;
        case "fadeOut": k("opacity", [[0, o, "easeIn"], [1, 0]]); break;
        case "popIn":
          k("transform.scaleX", [[0, 0, "backOut"], [1, sx]]);
          k("transform.scaleY", [[0, 0, "backOut"], [1, sy]]);
          k("opacity", [[0, 0, "easeOut"], [0.4, o]]);
          break;
        case "popOut":
          k("transform.scaleX", [[0, sx, "backIn"], [1, 0]]);
          k("transform.scaleY", [[0, sy, "backIn"], [1, 0]]);
          break;
        case "slideInLeft": case "slideInRight": case "slideInUp": case "slideInDown": {
          const s = dist ?? 240;
          const horiz = p.preset === "slideInLeft" || p.preset === "slideInRight";
          const sign = p.preset === "slideInLeft" || p.preset === "slideInUp" ? -1 : 1;
          k(horiz ? "transform.x" : "transform.y", [[0, (horiz ? x : y) + sign * s, "easeOut"], [1, horiz ? x : y]]);
          k("opacity", [[0, 0, "easeOut"], [0.6, o]]);
          break;
        }
        case "bounce": { const h = dist ?? 80; k("transform.y", [[0, y, "easeOut"], [0.45, y - h, "easeIn"], [0.9, y, "easeOut"], [0.95, y - h * 0.12, "easeIn"], [1, y]]); break; }
        case "pulse": k("transform.scaleX", [[0, sx], [0.5, sx * 1.12], [1, sx]]); k("transform.scaleY", [[0, sy], [0.5, sy * 1.12], [1, sy]]); break;
        case "heartbeat":
          for (const prop of ["transform.scaleX", "transform.scaleY"]) { const s0 = prop.endsWith("X") ? sx : sy; k(prop, [[0, s0], [0.14, s0 * 1.18], [0.28, s0], [0.42, s0 * 1.12], [0.6, s0], [1, s0]]); }
          break;
        case "shake": { const s = dist ?? 14; k("transform.x", [[0, x], [0.15, x + s], [0.3, x - s], [0.45, x + s * 0.7], [0.6, x - s * 0.7], [0.8, x + s * 0.3], [1, x]]); break; }
        case "spin": k("transform.rotation", [[0, r, "linear"], [1, r + 360]]); break;
        case "float": { const s = dist ?? 18; k("transform.y", [[0, y], [0.5, y - s], [1, y]]); break; }
        case "wiggle": k("transform.rotation", [[0, r], [0.2, r + 8], [0.4, r - 7], [0.6, r + 4], [0.8, r - 2], [1, r]]); break;
        case "draw": k("trimEnd", [[0, 0], [1, 1]]); break;
        case "blink": k("opacity", [[0, o, "hold"], [0.5, 0, "hold"], [1, o]]); break;
      }
      return { preset: p.preset, from: t0, to: +(t0 + d).toFixed(4) };
    },
  }),
  defineCommand({
    id: "import.svg",
    title: "Import SVG",
    description: "Import SVG markup as editable paths and groups (transforms baked, gradients kept). Fits into `width` px if given, placed with its top-left at x,y (default: centred on the artboard).",
    params: z.object({ svg: z.string().min(1), x: z.number().optional(), y: z.number().optional(), width: z.number().positive().optional(), parent: Id.nullable().optional(), name: z.string().optional() }),
    mutates: true,
    run: ({ doc, editor }, p) => {
      const res = parseSvg(p.svg);
      const [vx, vy, vw, vh] = res.viewBox;
      const scale = p.width ? p.width / vw : res.width / vw;
      const w = vw * scale, h = vh * scale;
      const ox = p.x ?? (doc.width - w) / 2, oy = p.y ?? (doc.height - h) / 2;
      const g = makeNode(doc, "group", { name: p.name ?? "SVG" });
      insertNode(doc, g, p.parent ?? null);
      svgToNodes(doc, res.nodes, g.id, (x, y) => ({ x: ox + (x - vx) * scale, y: oy + (y - vy) * scale }), scale);
      editor.state.selection = [g.id];
      return { id: g.id, nodes: Object.keys(doc.nodes).length, warnings: res.warnings };
    },
  }),
];
