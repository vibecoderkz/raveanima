import type { Ease, EasePreset } from "./types.js";

export const EASE_PRESETS: Record<Exclude<EasePreset, "linear" | "hold">, [number, number, number, number]> = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  backIn: [0.36, 0, 0.66, -0.56],
  backOut: [0.34, 1.56, 0.64, 1],
  backInOut: [0.68, -0.6, 0.32, 1.6],
};

export const EASE_NAMES = ["linear", "hold", ...Object.keys(EASE_PRESETS)] as EasePreset[];

/** cubic-bezier control points of an ease, or null for hold. Linear is [0,0,1,1]. */
export function easeToCubic(e: Ease): [number, number, number, number] | null {
  if (e === "hold") return null;
  if (e === "linear") return [0, 0, 1, 1];
  if (typeof e === "string") return EASE_PRESETS[e];
  return e.cubic;
}

function bezier(p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function bezierSlope(p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/** Solve x(t) = x for a CSS cubic-bezier and return y(t). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = bezier(x1, x2, t) - x;
    if (Math.abs(err) < 1e-6) return bezier(y1, y2, t);
    const d = bezierSlope(x1, x2, t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 40; i++) {
    const v = bezier(x1, x2, t);
    if (Math.abs(v - x) < 1e-7) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return bezier(y1, y2, t);
}

/** Eased progress 0..1 (can overshoot for back eases). Hold returns 0 until the next key. */
export function applyEase(e: Ease, p: number): number {
  const c = easeToCubic(e);
  if (!c) return p >= 1 ? 1 : 0;
  if (e === "linear") return p;
  return cubicBezier(c[0], c[1], c[2], c[3], p);
}

export function isEase(v: unknown): v is Ease {
  if (typeof v === "string") return (EASE_NAMES as string[]).includes(v);
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as { cubic?: unknown }).cubic) &&
    (v as { cubic: unknown[] }).cubic.length === 4 &&
    (v as { cubic: unknown[] }).cubic.every((n) => typeof n === "number")
  );
}
