import { isColor, lerpColor } from "./color.js";
import type { PathPoint } from "./types.js";

/** Read a dotted property path such as "transform.x" or "fill.stops.0.color". */
export function getProp(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function setProp(obj: unknown, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur = obj as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    const next = cur[key];
    if (next === null || typeof next !== "object") throw new Error(`Property path "${path}" does not exist`);
    cur = next as Record<string, unknown>;
  }
  const last = keys[keys.length - 1]!;
  if (!(last in cur)) throw new Error(`Property path "${path}" does not exist`);
  cur[last] = value;
}

/** Properties the timeline offers in its "add track" menu; any numeric or colour path also works. */
export const ANIMATABLE_PROPS = [
  "transform.x",
  "transform.y",
  "transform.rotation",
  "transform.scaleX",
  "transform.scaleY",
  "transform.originX",
  "transform.originY",
  "opacity",
  "visible",
  "width",
  "height",
  "cornerRadius",
  "radius",
  "innerRadius",
  "points",
  "fill.color",
  "stroke.width",
  "stroke.paint.color",
  "blur",
  "shadow.x",
  "shadow.y",
  "shadow.blur",
  "shadow.color",
  "trimStart",
  "trimEnd",
  "trimOffset",
  "fontSize",
  "letterSpacing",
] as const;

function isPointList(v: unknown): v is PathPoint[] {
  return Array.isArray(v) && v.every((p) => p && typeof p === "object" && "x" in p && "outX" in p);
}

/**
 * Interpolate two keyframe values. Numbers and colours blend; point lists morph when they
 * have the same number of points; anything else (booleans, mismatched paths) holds `a`.
 */
export function interpolate(a: unknown, b: unknown, t: number): unknown {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * t;
  if (isColor(a) && isColor(b)) return lerpColor(a, b, Math.min(1, Math.max(0, t)));
  if (isPointList(a) && isPointList(b) && a.length === b.length) {
    return a.map((p, i) => {
      const q = b[i]!;
      const l = (k: keyof PathPoint) => p[k] + (q[k] - p[k]) * t;
      return { x: l("x"), y: l("y"), inX: l("inX"), inY: l("inY"), outX: l("outX"), outY: l("outY") };
    });
  }
  return t >= 1 ? b : a;
}
