import type { AnimaDocument, AnimaNode, Contour, PathPoint, ShapeNode, TextNode, Transform } from "./types.js";

/** 2D affine matrix [a, b, c, d, e, f], same layout as Canvas setTransform and SVG matrix(). */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  const i = 1 / det;
  return [m[3] * i, -m[1] * i, -m[2] * i, m[0] * i, (m[2] * m[5] - m[3] * m[4]) * i, (m[1] * m[4] - m[0] * m[5]) * i];
}

export function apply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function localMatrix(t: Transform): Mat {
  const r = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const a = cos * t.scaleX;
  const b = sin * t.scaleX;
  const c = -sin * t.scaleY;
  const d = cos * t.scaleY;
  return [a, b, c, d, t.x - a * t.originX - c * t.originY, t.y - b * t.originX - d * t.originY];
}

export function worldMatrix(doc: AnimaDocument, id: string): Mat {
  const chain: AnimaNode[] = [];
  let cur: AnimaNode | undefined = doc.nodes[id];
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent ? doc.nodes[cur.parent] : undefined;
  }
  return chain.reduce<Mat>((m, n) => multiply(m, localMatrix(n.transform)), [...IDENTITY]);
}

const KAPPA = 0.5522847498;

function pt(x: number, y: number, inX = 0, inY = 0, outX = 0, outY = 0): PathPoint {
  return { x, y, inX, inY, outX, outY };
}

/** Every shape as one Bézier contour in local coordinates. */
export function shapeContour(node: ShapeNode): { points: PathPoint[]; closed: boolean } {
  switch (node.type) {
    case "path":
      return { points: node.points, closed: node.closed };
    case "ellipse": {
      const rx = node.width / 2;
      const ry = node.height / 2;
      const kx = rx * KAPPA;
      const ky = ry * KAPPA;
      return {
        closed: true,
        points: [pt(0, -ry, -kx, 0, kx, 0), pt(rx, 0, 0, -ky, 0, ky), pt(0, ry, kx, 0, -kx, 0), pt(-rx, 0, 0, ky, 0, -ky)],
      };
    }
    case "rect": {
      const w = node.width / 2;
      const h = node.height / 2;
      const r = Math.max(0, Math.min(node.cornerRadius, w, h));
      if (r === 0) return { closed: true, points: [pt(-w, -h), pt(w, -h), pt(w, h), pt(-w, h)] };
      const k = r * KAPPA;
      return {
        closed: true,
        points: [
          pt(-w + r, -h, -k, 0, 0, 0),
          pt(w - r, -h, 0, 0, k, 0),
          pt(w, -h + r, 0, -k, 0, 0),
          pt(w, h - r, 0, 0, 0, k),
          pt(w - r, h, k, 0, 0, 0),
          pt(-w + r, h, 0, 0, -k, 0),
          pt(-w, h - r, 0, k, 0, 0),
          pt(-w, -h + r, 0, 0, 0, -k),
        ],
      };
    }
    case "polygon": {
      const n = Math.max(3, Math.round(node.sides));
      return {
        closed: true,
        points: Array.from({ length: n }, (_, i) => {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
          return pt(Math.cos(a) * node.radius, Math.sin(a) * node.radius);
        }),
      };
    }
    case "star": {
      const n = Math.max(2, Math.round(node.points));
      return {
        closed: true,
        points: Array.from({ length: n * 2 }, (_, i) => {
          const a = -Math.PI / 2 + (i * Math.PI) / n;
          const r = i % 2 === 0 ? node.radius : node.innerRadius;
          return pt(Math.cos(a) * r, Math.sin(a) * r);
        }),
      };
    }
  }
}

export interface TextMetrics {
  width: number;
  lines: { text: string; width: number }[];
}

/** Text measuring depends on the environment (browser canvas, Skia); renderers install a real one. */
let measure: (text: string, font: string, letterSpacing: number) => number = (text, font, ls) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  return text.length * (size * 0.56 + ls);
};
export function setTextMeasurer(fn: (text: string, font: string, letterSpacing: number) => number): void {
  measure = fn;
}

export function textFont(n: TextNode): string {
  return `${n.fontWeight} ${n.fontSize}px ${/[\s,]/.test(n.fontFamily) && !n.fontFamily.includes(",") ? `"${n.fontFamily}"` : n.fontFamily}`;
}

/** Lines and block size of a text node, in local coordinates. */
export function textLayout(n: TextNode): { lines: { text: string; width: number; x: number; y: number }[]; width: number; height: number } {
  const font = textFont(n);
  const raw = n.text.split("\n");
  const lh = n.fontSize * n.lineHeight;
  const widths = raw.map((t) => measure(t, font, n.letterSpacing));
  const width = Math.max(0, ...widths);
  const height = raw.length * lh;
  return {
    width,
    height,
    lines: raw.map((text, i) => ({
      text,
      width: widths[i]!,
      x: n.align === "left" ? -width / 2 : n.align === "right" ? width / 2 : 0,
      y: -height / 2 + lh * (i + 0.5),
    })),
  };
}

function rectContour(w: number, h: number): Contour {
  return { closed: true, points: [pt(-w / 2, -h / 2), pt(w / 2, -h / 2), pt(w / 2, h / 2), pt(-w / 2, h / 2)] };
}

/** Every contour of a node in local coordinates. Text and images give their box; groups give none. */
export function nodeContours(node: AnimaNode): Contour[] {
  if (node.type === "group") return [];
  if (node.type === "image") return [rectContour(node.width, node.height)];
  if (node.type === "text") {
    const l = textLayout(node);
    return [rectContour(l.width, l.height)];
  }
  const main = shapeContour(node);
  return node.type === "path" ? [main, ...(node.subpaths ?? [])] : [main];
}

/** Iterate contour segments as cubic Béziers (p0, c1, c2, p1) in absolute coordinates. */
export function forEachSegment(
  points: PathPoint[],
  closed: boolean,
  fn: (p0: PathPoint, c1x: number, c1y: number, c2x: number, c2y: number, p1: PathPoint) => void,
): void {
  const n = points.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    fn(a, a.x + a.outX, a.y + a.outY, b.x + b.inX, b.y + b.inY, b);
  }
}

export function contourToSvgPath(points: PathPoint[], closed: boolean): string {
  if (points.length === 0) return "";
  const f = (v: number) => +v.toFixed(3);
  let d = `M${f(points[0]!.x)} ${f(points[0]!.y)}`;
  forEachSegment(points, closed, (_p0, c1x, c1y, c2x, c2y, p1) => {
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p1.x)} ${f(p1.y)}`;
  });
  return closed ? d + "Z" : d;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** World-space bounding box of a node (groups: union of children). Null for empty nodes. */
export function nodeBounds(doc: AnimaDocument, id: string): Bounds | null {
  const node = doc.nodes[id];
  if (!node) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  if (node.type === "group") {
    for (const c of node.children) {
      const b = nodeBounds(doc, c);
      if (b) {
        add(b.x, b.y);
        add(b.x + b.width, b.y + b.height);
      }
    }
  } else {
    const m = worldMatrix(doc, id);
    for (const { points, closed } of nodeContours(node)) {
      if (points.length === 1) add(apply(m, points[0]!.x, points[0]!.y).x, apply(m, points[0]!.x, points[0]!.y).y);
      forEachSegment(points, closed, (p0, c1x, c1y, c2x, c2y, p1) => {
        for (let s = 0; s <= 8; s++) {
          const t = s / 8;
          const w = apply(m, cubicAt(p0.x, c1x, c2x, p1.x, t), cubicAt(p0.y, c1y, c2y, p1.y, t));
          add(w.x, w.y);
        }
      });
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------- trim paths ----------

export interface Cubic {
  x0: number; y0: number; c1x: number; c1y: number; c2x: number; c2y: number; x1: number; y1: number;
}

function toCubics(c: Contour): Cubic[] {
  const out: Cubic[] = [];
  forEachSegment(c.points, c.closed, (a, c1x, c1y, c2x, c2y, b) => out.push({ x0: a.x, y0: a.y, c1x, c1y, c2x, c2y, x1: b.x, y1: b.y }));
  return out;
}

const SAMPLES = 24;

function cubicLengthTable(q: Cubic): number[] {
  const t: number[] = [0];
  let px = q.x0, py = q.y0, len = 0;
  for (let i = 1; i <= SAMPLES; i++) {
    const s = i / SAMPLES;
    const x = cubicAt(q.x0, q.c1x, q.c2x, q.x1, s), y = cubicAt(q.y0, q.c1y, q.c2y, q.y1, s);
    len += Math.hypot(x - px, y - py);
    t.push(len);
    px = x;
    py = y;
  }
  return t;
}

/** Parameter t at which the cubic has travelled `d` along its (sampled) length. */
function tAt(table: number[], d: number): number {
  const total = table[table.length - 1]!;
  if (d <= 0 || total === 0) return 0;
  if (d >= total) return 1;
  let i = 1;
  while (table[i]! < d) i++;
  const a = table[i - 1]!, b = table[i]!;
  return (i - 1 + (d - a) / (b - a || 1)) / SAMPLES;
}

/** Sub-curve of a cubic between t0 and t1 (de Casteljau). */
export function splitCubic(q: Cubic, t0: number, t1: number): Cubic {
  const at = (t: number) => {
    const u = 1 - t;
    const ax = u * q.x0 + t * q.c1x, ay = u * q.y0 + t * q.c1y;
    const bx = u * q.c1x + t * q.c2x, by = u * q.c1y + t * q.c2y;
    const cx = u * q.c2x + t * q.x1, cy = u * q.c2y + t * q.y1;
    const dx = u * ax + t * bx, dy = u * ay + t * by;
    const ex = u * bx + t * cx, ey = u * by + t * cy;
    return { ax, ay, cx, cy, dx, dy, ex, ey, x: u * dx + t * ex, y: u * dy + t * ey };
  };
  // Right part from t0, then left part of that up to the remapped t1.
  const s = at(t0);
  const r: Cubic = { x0: s.x, y0: s.y, c1x: s.ex, c1y: s.ey, c2x: s.cx, c2y: s.cy, x1: q.x1, y1: q.y1 };
  const tt = t0 >= 1 ? 0 : (t1 - t0) / (1 - t0);
  const u = 1 - tt;
  const ax = u * r.x0 + tt * r.c1x, ay = u * r.y0 + tt * r.c1y;
  const bx = u * r.c1x + tt * r.c2x, by = u * r.c1y + tt * r.c2y;
  const cx = u * r.c2x + tt * r.x1, cy = u * r.c2y + tt * r.y1;
  const dx = u * ax + tt * bx, dy = u * ay + tt * by;
  const ex = u * bx + tt * cx, ey = u * by + tt * cy;
  return { x0: r.x0, y0: r.y0, c1x: ax, c1y: ay, c2x: dx, c2y: dy, x1: u * dx + tt * ex, y1: u * dy + tt * ey };
}

/**
 * Trim each contour to the window [start, end] (fractions of its length), shifted by offset and
 * wrapping around. Returns runs of connected cubics; each run is drawn as an open sub-path.
 */
export function trimContours(contours: Contour[], start: number, end: number, offset: number): Cubic[][] {
  const runs: Cubic[][] = [];
  let s = Math.min(start, end), e = Math.max(start, end);
  if (e - s >= 1 - 1e-9 && offset % 1 === 0) return contours.map(toCubics);
  if (e - s <= 1e-9) return [];
  s += offset;
  e += offset;
  const shift = Math.floor(s);
  s -= shift;
  e -= shift;
  const windows: [number, number][] = e <= 1 ? [[s, e]] : [[s, 1], [0, e - 1]];
  for (const c of contours) {
    const cubics = toCubics(c);
    const tables = cubics.map(cubicLengthTable);
    const lens = tables.map((t) => t[t.length - 1]!);
    const total = lens.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    for (const [w0, w1] of windows) {
      const d0 = w0 * total, d1 = w1 * total;
      const run: Cubic[] = [];
      let acc = 0;
      cubics.forEach((q, i) => {
        const a = acc, b = acc + lens[i]!;
        acc = b;
        if (b <= d0 || a >= d1) return;
        const t0 = tAt(tables[i]!, Math.max(0, d0 - a));
        const t1 = tAt(tables[i]!, Math.min(lens[i]!, d1 - a));
        run.push(t0 <= 0 && t1 >= 1 ? q : splitCubic(q, t0, t1));
      });
      if (run.length) runs.push(run);
    }
  }
  // A wrapped window on a closed contour reads as one stroke: join [s,1] + [0,e-1].
  return runs;
}
