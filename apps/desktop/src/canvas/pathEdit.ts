import { apply, invert, multiply, worldMatrix, type AnimaDocument, type Mat, type PathNode, type PathPoint } from "@raveanima/core";
import { screenMat, type View } from "./geometry";

const ACCENT = "#ff3b2e";

export type PathHit = { kind: "point"; index: number } | { kind: "in" | "out"; index: number } | { kind: "segment"; index: number; t: number } | null;

function mats(doc: AnimaDocument, id: string, v: View) {
  const m: Mat = multiply(screenMat(v), worldMatrix(doc, id));
  return { m, inv: invert(m) };
}

/** What is under the pointer while editing a path: a vertex, a handle, or a segment (with t). */
export function hitPath(doc: AnimaDocument, node: PathNode, v: View, sx: number, sy: number, selected: number | null): PathHit {
  const { m } = mats(doc, node.id, v);
  const near = (x: number, y: number, r = 7) => {
    const p = apply(m, x, y);
    return Math.hypot(p.x - sx, p.y - sy) < r;
  };
  // Handles of the selected point (and its neighbours) win over points.
  const pts = node.points;
  const handleOwners = selected === null ? [] : [selected, selected - 1, selected + 1].filter((i) => i >= 0 && i < pts.length);
  for (const i of handleOwners) {
    const p = pts[i]!;
    if ((p.outX || p.outY) && near(p.x + p.outX, p.y + p.outY, 6)) return { kind: "out", index: i };
    if ((p.inX || p.inY) && near(p.x + p.inX, p.y + p.inY, 6)) return { kind: "in", index: i };
  }
  for (let i = pts.length - 1; i >= 0; i--) if (near(pts[i]!.x, pts[i]!.y, 8)) return { kind: "point", index: i };
  const segs = node.closed ? pts.length : pts.length - 1;
  let best: PathHit = null;
  let bestD = 6;
  for (let i = 0; i < segs; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    for (let s = 1; s < 32; s++) {
      const t = s / 32, u = 1 - t;
      const x = u * u * u * a.x + 3 * u * u * t * (a.x + a.outX) + 3 * u * t * t * (b.x + b.inX) + t * t * t * b.x;
      const y = u * u * u * a.y + 3 * u * u * t * (a.y + a.outY) + 3 * u * t * t * (b.y + b.inY) + t * t * t * b.y;
      const p = apply(m, x, y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bestD) {
        bestD = d;
        best = { kind: "segment", index: i, t };
      }
    }
  }
  return best;
}

/** Screen point -> path-local point. */
export function toLocal(doc: AnimaDocument, id: string, v: View, sx: number, sy: number) {
  return apply(mats(doc, id, v).inv, sx, sy);
}

/** Move a vertex (handles follow) or a handle (mirrored unless `broken`). */
export function dragPoint(points: PathPoint[], hit: Exclude<PathHit, null | { kind: "segment" }>, lx: number, ly: number, broken: boolean): PathPoint[] {
  const out = points.map((p) => ({ ...p }));
  const p = out[hit.index]!;
  if (hit.kind === "point") {
    p.x = lx;
    p.y = ly;
  } else {
    const dx = lx - p.x, dy = ly - p.y;
    if (hit.kind === "out") {
      p.outX = dx;
      p.outY = dy;
      if (!broken) {
        const len = Math.hypot(p.inX, p.inY) || Math.hypot(dx, dy);
        const k = len / (Math.hypot(dx, dy) || 1);
        p.inX = -dx * k;
        p.inY = -dy * k;
      }
    } else {
      p.inX = dx;
      p.inY = dy;
      if (!broken) {
        const len = Math.hypot(p.outX, p.outY) || Math.hypot(dx, dy);
        const k = len / (Math.hypot(dx, dy) || 1);
        p.outX = -dx * k;
        p.outY = -dy * k;
      }
    }
  }
  return out;
}

export function drawPathEditor(ctx: CanvasRenderingContext2D, doc: AnimaDocument, node: PathNode, v: View, selected: number | null, hover: PathHit) {
  const { m } = mats(doc, node.id, v);
  const S = (x: number, y: number) => apply(m, x, y);
  ctx.save();
  ctx.lineWidth = 1;
  node.points.forEach((p, i) => {
    const showHandles = selected !== null && Math.abs(i - selected) <= 1;
    if (showHandles) {
      const c = S(p.x, p.y);
      for (const [hx, hy] of [[p.inX, p.inY], [p.outX, p.outY]] as const) {
        if (!hx && !hy) continue;
        const h = S(p.x + hx, p.y + hy);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(h.x, h.y);
        ctx.strokeStyle = ACCENT;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h.x, h.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.stroke();
      }
    }
  });
  if (hover?.kind === "segment") {
    const a = node.points[hover.index]!, b = node.points[(hover.index + 1) % node.points.length]!;
    const t = hover.t, u = 1 - t;
    const x = u * u * u * a.x + 3 * u * u * t * (a.x + a.outX) + 3 * u * t * t * (b.x + b.inX) + t * t * t * b.x;
    const y = u * u * u * a.y + 3 * u * u * t * (a.y + a.outY) + 3 * u * t * t * (b.y + b.inY) + t * t * t * b.y;
    const p = S(x, y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
  }
  node.points.forEach((p, i) => {
    const c = S(p.x, p.y);
    const on = i === selected;
    const hot = hover?.kind === "point" && hover.index === i;
    ctx.beginPath();
    ctx.rect(c.x - 4.5, c.y - 4.5, 9, 9);
    ctx.fillStyle = on ? ACCENT : "#fff";
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = hot ? 2 : 1.25;
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}
