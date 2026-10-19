import type { Color } from "./types.js";

export interface RGBA {
  r: number; // 0..255
  g: number;
  b: number;
  a: number; // 0..1
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isColor(v: unknown): v is Color {
  return typeof v === "string" && HEX.test(v);
}

export function parseColor(c: Color): RGBA {
  if (!isColor(c)) throw new Error(`Invalid colour "${c}", expected #rrggbb or #rrggbbaa`);
  let h = c.slice(1);
  if (h.length <= 4) h = [...h].map((ch) => ch + ch).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

export function formatColor({ r, g, b, a }: RGBA): Color {
  const hx = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}${a >= 1 ? "" : hx(a * 255)}`;
}

export function lerpColor(a: Color, b: Color, t: number): Color {
  const x = parseColor(a);
  const y = parseColor(b);
  return formatColor({
    r: x.r + (y.r - x.r) * t,
    g: x.g + (y.g - x.g) * t,
    b: x.b + (y.b - x.b) * t,
    a: x.a + (y.a - x.a) * t,
  });
}

export function toCss(c: Color): string {
  const { r, g, b, a } = parseColor(c);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
