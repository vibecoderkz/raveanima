import { nodeBounds, type AnimaDocument, type Bounds } from "@raveanima/core";

export interface Guide {
  axis: "x" | "y";
  at: number; // world coordinate of the line
}

export interface SnapTargets {
  xs: number[];
  ys: number[];
}

/** Edges and centres of the artboard and of every visible top-level node not being moved. */
export function snapTargets(doc: AnimaDocument, exclude: string[]): SnapTargets {
  const xs = [0, doc.width / 2, doc.width];
  const ys = [0, doc.height / 2, doc.height];
  const skip = new Set(exclude);
  for (const id of doc.root) {
    const n = doc.nodes[id];
    if (!n || !n.visible || skip.has(id)) continue;
    const b = nodeBounds(doc, id);
    if (!b) continue;
    xs.push(b.x, b.x + b.width / 2, b.x + b.width);
    ys.push(b.y, b.y + b.height / 2, b.y + b.height);
  }
  return { xs, ys };
}

/** Best correction (dx, dy) that lands the moving box on a target within `tol` world units. */
export function snapBox(box: Bounds, t: SnapTargets, tol: number): { dx: number; dy: number; guides: Guide[] } {
  const pick = (vals: number[], targets: number[]) => {
    let best: { d: number; at: number } | null = null;
    for (const v of vals)
      for (const at of targets) {
        const d = at - v;
        if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at };
      }
    return best;
  };
  const bx = pick([box.x, box.x + box.width / 2, box.x + box.width], t.xs);
  const by = pick([box.y, box.y + box.height / 2, box.y + box.height], t.ys);
  const guides: Guide[] = [];
  if (bx) guides.push({ axis: "x", at: bx.at });
  if (by) guides.push({ axis: "y", at: by.at });
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, guides };
}
