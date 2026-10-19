import { apply, forEachSegment, invert, localMatrix, multiply, nodeContours, worldMatrix, type AnimaDocument, type AnimaNode, type Mat } from "@raveanima/core";

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export const screenMat = (v: View): Mat => [v.zoom, 0, 0, v.zoom, v.panX, v.panY];
export const toWorld = (v: View, x: number, y: number) => ({ x: (x - v.panX) / v.zoom, y: (y - v.panY) / v.zoom });
export const toScreen = (v: View, x: number, y: number) => ({ x: x * v.zoom + v.panX, y: y * v.zoom + v.panY });

export function parentWorld(doc: AnimaDocument, node: AnimaNode): Mat {
  return node.parent ? worldMatrix(doc, node.parent) : [1, 0, 0, 1, 0, 0];
}

/** Turn a world-space delta into the node's parent space (linear part only). */
export function deltaToParent(doc: AnimaDocument, node: AnimaNode, dx: number, dy: number) {
  const inv = invert(parentWorld(doc, node));
  return { x: inv[0] * dx + inv[2] * dy, y: inv[1] * dx + inv[3] * dy };
}

/** Trace a node (groups: all descendants) into ctx in screen space so strokes stay 1px. */
export function traceNode(ctx: CanvasRenderingContext2D, doc: AnimaDocument, id: string, view: Mat) {
  const node = doc.nodes[id];
  if (!node || !node.visible) return;
  if (node.type === "group") {
    for (const c of node.children) traceNode(ctx, doc, c, view);
    return;
  }
  const m = multiply(view, worldMatrix(doc, id));
  for (const { points, closed } of nodeContours(node)) {
    if (points.length === 0) continue;
    const p0 = apply(m, points[0]!.x, points[0]!.y);
    ctx.moveTo(p0.x, p0.y);
    forEachSegment(points, closed, (_a, c1x, c1y, c2x, c2y, b) => {
      const c1 = apply(m, c1x, c1y);
      const c2 = apply(m, c2x, c2y);
      const e = apply(m, b.x, b.y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y);
    });
    if (closed) ctx.closePath();
  }
}

/** Tight local-space bounds of a shape's contour (before its transform). */
export function localBounds(node: AnimaNode) {
  if (node.type === "group") return null;
  const contours = nodeContours(node).filter((c) => c.points.length);
  if (!contours.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const { points, closed } of contours) {
    add(points[0]!.x, points[0]!.y);
    forEachSegment(points, closed, (a, c1x, c1y, c2x, c2y, b) => {
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, u = 1 - t;
        add(u * u * u * a.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * b.x, u * u * u * a.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * b.y);
      }
    });
  }
  // A flat line still needs a box to grab.
  if (maxX - minX < 1) (minX -= 0.5), (maxX += 0.5);
  if (maxY - minY < 1) (minY -= 0.5), (maxY += 0.5);
  return { minX, minY, maxX, maxY };
}

const probe = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d")! : null;

/** Is the world point inside the node's fill (or near its stroke)? */
export function hitNode(doc: AnimaDocument, node: AnimaNode, wx: number, wy: number, tolerance: number): boolean {
  if (!probe || node.type === "group" || !node.visible) return false;
  const inv = invert(worldMatrix(doc, node.id));
  const l = apply(inv, wx, wy);
  const contours = nodeContours(node).filter((c) => c.points.length > 1);
  if (!contours.length) return false;
  const p = new Path2D();
  for (const { points, closed: cl } of contours) {
    p.moveTo(points[0]!.x, points[0]!.y);
    forEachSegment(points, cl, (_a, c1x, c1y, c2x, c2y, b) => p.bezierCurveTo(c1x, c1y, c2x, c2y, b.x, b.y));
    if (cl) p.closePath();
  }
  const closed = contours.some((c) => c.closed);
  // Text and images are hit anywhere inside their box.
  if (node.type === "text" || node.type === "image") return probe.isPointInPath(p, l.x, l.y);
  const rule = node.type === "path" ? node.fillRule : "nonzero";
  if (closed && node.fill.type !== "none" && probe.isPointInPath(p, l.x, l.y, rule)) return true;
  const scale = Math.hypot(inv[0], inv[1]) || 1;
  probe.lineWidth = (node.stroke?.width ?? 0) + tolerance * scale * 2;
  return probe.isPointInStroke(p, l.x, l.y) || (closed && node.fill.type === "none" && !node.stroke && probe.isPointInPath(p, l.x, l.y));
}

/** World position of a normalised point (u, v in 0..1) of the node's local bounds. */
export function anchorWorld(doc: AnimaDocument, node: AnimaNode, u: number, v: number) {
  const b = localBounds(node)!;
  const m = multiply(parentWorld(doc, node), localMatrix(node.transform));
  return apply(m, b.minX + (b.maxX - b.minX) * u, b.minY + (b.maxY - b.minY) * v);
}
