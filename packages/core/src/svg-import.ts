// SVG -> Anima geometry. Self-contained (no DOM): tiny XML tokenizer, CSS subset, path/shape/arc
// conversion to cubic contours, with every transform baked into root viewBox user space.

import type { GradientStop, Paint, PathPoint } from "./types.js";

export interface SvgContour {
  points: PathPoint[];
  closed: boolean;
}

export interface SvgStroke {
  paint: Paint;
  width: number;
  join: "miter" | "round" | "bevel";
  cap: "butt" | "round" | "square";
}

export type SvgNode =
  | { kind: "group"; name: string; opacity: number; children: SvgNode[] }
  | {
      kind: "path";
      name: string;
      opacity: number;
      fill: Paint;
      stroke: SvgStroke | null;
      fillRule: "nonzero" | "evenodd";
      contours: SvgContour[];
    };

export interface SvgImport {
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  nodes: SvgNode[];
  warnings: string[];
}

// ---------------------------------------------------------------- XML

interface XmlEl {
  tag: string;
  attrs: Record<string, string>;
  children: XmlEl[];
  text: string;
  parent: XmlEl | null;
}

const NAME_RE = /[^\s/>=]+/y;

function decodeEntities(s: string, ents: Record<string, string>): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[\w.:-]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return ents[e] ?? all;
  });
}

function parseXml(src: string, warn: (m: string) => void): XmlEl {
  const doc: XmlEl = { tag: "#document", attrs: {}, children: [], text: "", parent: null };
  const ents: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const stack: XmlEl[] = [doc];
  const top = () => stack[stack.length - 1];
  const isWs = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";
  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      top().text += decodeEntities(src.slice(i), ents);
      break;
    }
    if (lt > i) top().text += decodeEntities(src.slice(i, lt), ents);
    if (src.startsWith("<!--", lt)) {
      const e = src.indexOf("-->", lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt + 9);
      top().text += src.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith("<?", lt)) {
      const e = src.indexOf("?>", lt + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (src.startsWith("<!", lt)) {
      // DOCTYPE, possibly with an internal subset declaring entities (Illustrator does this).
      let j = lt + 2;
      let depth = 0;
      while (j < n) {
        const c = src[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
        else if (c === '"' || c === "'") {
          const e = src.indexOf(c, j + 1);
          j = e < 0 ? n : e;
        }
        j++;
      }
      for (const m of src.slice(lt, j).matchAll(/<!ENTITY\s+([^\s%]+)\s+(["'])([\s\S]*?)\2\s*>/g)) ents[m[1]] = m[3];
      i = j + 1;
      continue;
    }
    if (src[lt + 1] === "/") {
      const e = src.indexOf(">", lt);
      const name = src.slice(lt + 2, e < 0 ? n : e).trim();
      i = e < 0 ? n : e + 1;
      let k = stack.length - 1;
      while (k > 0 && stack[k].tag !== name) k--;
      if (k > 0) {
        if (k !== stack.length - 1) warn(`Mismatched closing tag </${name}>`);
        stack.length = k;
      } else warn(`Unexpected closing tag </${name}>`);
      continue;
    }
    NAME_RE.lastIndex = lt + 1;
    const nm = NAME_RE.exec(src);
    if (!nm) {
      top().text += "<";
      i = lt + 1;
      continue;
    }
    const el: XmlEl = { tag: nm[0], attrs: {}, children: [], text: "", parent: top() };
    let j = NAME_RE.lastIndex;
    let selfClose = false;
    while (j < n) {
      while (j < n && isWs(src[j])) j++;
      const c = src[j];
      if (c === ">") {
        j++;
        break;
      }
      if (c === "/") {
        j++;
        if (src[j] === ">") {
          selfClose = true;
          j++;
          break;
        }
        continue;
      }
      NAME_RE.lastIndex = j;
      const an = NAME_RE.exec(src);
      if (!an) {
        j++;
        continue;
      }
      j = NAME_RE.lastIndex;
      while (j < n && isWs(src[j])) j++;
      let value = "";
      if (src[j] === "=") {
        j++;
        while (j < n && isWs(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const e = src.indexOf(q, j + 1);
          value = src.slice(j + 1, e < 0 ? n : e);
          j = e < 0 ? n : e + 1;
        } else {
          const s = j;
          while (j < n && !isWs(src[j]) && src[j] !== ">") j++;
          value = src.slice(s, j);
        }
      }
      el.attrs[an[0]] = decodeEntities(value, ents);
    }
    i = j;
    top().children.push(el);
    if (!selfClose) stack.push(el);
  }
  if (stack.length > 1) warn(`Unclosed element <${top().tag}>`);
  return doc;
}

/** "svg:rect" -> "rect"; other prefixes (inkscape:, sodipodi:) are kept so they never match SVG tags. */
function localName(tag: string): string {
  return tag.startsWith("svg:") ? tag.slice(4) : tag;
}

// ---------------------------------------------------------------- numbers, lengths, matrices

const NUM_G = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const NUM_Y = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

function parseNumbers(s: string): number[] {
  return (s.match(NUM_G) ?? []).map(Number);
}

const UNITS: Record<string, number> = { "": 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 };

function parseLength(s: string | undefined, ref: number): number | null {
  if (s == null) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|ex|%)?\s*$/i.exec(s);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = (m[2] ?? "").toLowerCase();
  return u === "%" ? (v / 100) * ref : v * UNITS[u];
}

function parseOpacity(s: string | undefined, def: number): number {
  if (s == null) return def;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(%)?\s*$/.exec(s);
  if (!m) return def;
  const v = parseFloat(m[1]) / (m[2] ? 100 : 1);
  return Math.min(1, Math.max(0, v));
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m · n (n is applied first). */
function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const det = (m: Matrix) => m[0] * m[3] - m[1] * m[2];
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const apply = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4] || 0, y: m[1] * x + m[3] * y + m[5] || 0 });

/** cos/sin snapped so that multiples of 90 degrees are exact. */
function cosSin(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  const snap = (v: number) => (Math.abs(v) < 1e-12 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-12 ? Math.sign(v) : v);
  return [snap(Math.cos(r)), snap(Math.sin(r))];
}

function parseTransform(s: string, warn: (m: string) => void): Matrix {
  let m = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  for (const t of s.matchAll(re)) {
    const a = parseNumbers(t[2]);
    let x: Matrix | null = null;
    switch (t[1]) {
      case "matrix":
        if (a.length === 6) x = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case "translate":
        if (a.length >= 1) x = translate(a[0], a[1] ?? 0);
        break;
      case "scale":
        if (a.length >= 1) x = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
        break;
      case "rotate":
        if (a.length >= 1) {
          const [c, sn] = cosSin(a[0]);
          x = [c, sn, -sn, c, 0, 0];
          if (a.length >= 3) x = mul(translate(a[1], a[2]), mul(x, translate(-a[1], -a[2])));
        }
        break;
      case "skewX":
        if (a.length >= 1) x = [1, 0, Math.tan((a[0] * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        if (a.length >= 1) x = [1, Math.tan((a[0] * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    if (x) m = mul(m, x);
    else warn(`Invalid transform "${t[0]}" ignored`);
  }
  return m;
}

function parseViewBox(s: string | undefined, warn: (m: string) => void): [number, number, number, number] | null {
  if (s == null) return null;
  const v = parseNumbers(s);
  if (v.length !== 4 || !(v[2] > 0) || !(v[3] > 0)) {
    warn(`Invalid viewBox "${s}" ignored`);
    return null;
  }
  return [v[0], v[1], v[2], v[3]];
}

// ---------------------------------------------------------------- colours

type RGBA = [number, number, number, number];

const NAMED_SRC =
  "aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000," +
  "blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00," +
  "chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b," +
  "darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b," +
  "darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f," +
  "darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493," +
  "deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22," +
  "fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f," +
  "grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa," +
  "lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff," +
  "lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a," +
  "lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de," +
  "lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa," +
  "mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee," +
  "mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa," +
  "mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23," +
  "orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee," +
  "palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6," +
  "purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072," +
  "sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd," +
  "slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8," +
  "tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32";

let named: Map<string, string> | null = null;

function hexToRgba(h: string): RGBA | null {
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const v = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [v(0), v(2), v(4), h.length === 8 ? v(6) / 255 : 1];
}

function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase().replace(/\s*icc-color\([^)]*\)/, "");
  if (s === "transparent") return [0, 0, 0, 0];
  if (s[0] === "#") return hexToRgba(s.slice(1));
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const alpha = parts.length > 3 ? parseOpacity(parts[3], NaN) : 1;
    if (Number.isNaN(alpha)) return null;
    if (fn[1].startsWith("rgb")) {
      const ch = parts.slice(0, 3).map((p) => (p.endsWith("%") ? parseFloat(p) * 2.55 : parseFloat(p)));
      if (ch.some((v) => !Number.isFinite(v))) return null;
      return [ch[0], ch[1], ch[2], alpha];
    }
    const hm = /^([+-]?[\d.]+(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/.exec(parts[0]);
    const sat = parseFloat(parts[1]) / 100;
    const lig = parseFloat(parts[2]) / 100;
    if (!hm || !Number.isFinite(sat) || !Number.isFinite(lig)) return null;
    const unit = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 }[hm[2] ?? "deg"] ?? 1;
    const h = (((parseFloat(hm[1]) * unit) % 360) + 360) % 360;
    const sc = Math.min(1, Math.max(0, sat));
    const l = Math.min(1, Math.max(0, lig));
    const a = sc * Math.min(l, 1 - l);
    const f = (k0: number) => {
      const k = (k0 + h / 30) % 12;
      return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
    };
    return [f(0), f(8), f(4), alpha];
  }
  if (!named) named = new Map(NAMED_SRC.split(",").map((e) => e.split(":") as [string, string]));
  const hx = named.get(s);
  return hx ? hexToRgba(hx) : null;
}

function hex(c: RGBA, alphaMul = 1): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  const ab = Math.round(Math.min(1, Math.max(0, c[3] * alphaMul)) * 255);
  return `#${h(c[0])}${h(c[1])}${h(c[2])}${ab === 255 ? "" : h(ab)}`;
}

// ---------------------------------------------------------------- CSS subset

interface Compound {
  tag: string | null;
  id: string | null;
  classes: string[];
}

interface CssRule {
  parts: Compound[];
  combs: string[]; // combs[i] joins parts[i] and parts[i + 1]: " " or ">"
  spec: number;
  order: number;
  decls: Record<string, string>;
}

function parseDecls(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(";")) {
    const k = part.indexOf(":");
    if (k < 0) continue;
    const name = part.slice(0, k).trim().toLowerCase();
    const v = part.slice(k + 1).replace(/!important\s*$/i, "").trim();
    if (name && v) out[name] = v;
  }
  return out;
}

function parseSelector(s: string): Omit<CssRule, "order" | "decls"> | null {
  const toks = s.trim().replace(/\s*>\s*/g, " > ").split(/\s+/).filter(Boolean);
  const parts: Compound[] = [];
  const combs: string[] = [];
  let spec = 0;
  let pending = " ";
  for (const t of toks) {
    if (t === ">") {
      pending = ">";
      continue;
    }
    const m = /^(\*|[\w-]*\|[\w-]+|[a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(t);
    if (!m || (!m[1] && !m[2])) return null; // attribute/pseudo selectors etc. are unsupported
    if (parts.length) combs.push(pending);
    pending = " ";
    const c: Compound = { tag: m[1] && m[1] !== "*" ? m[1].replace(/^.*\|/, "") : null, id: null, classes: [] };
    if (c.tag) spec += 1;
    for (const x of (m[2] ?? "").matchAll(/([.#])([\w-]+)/g)) {
      if (x[1] === "#") {
        c.id = x[2];
        spec += 10000;
      } else {
        c.classes.push(x[2]);
        spec += 100;
      }
    }
    parts.push(c);
  }
  return parts.length ? { parts, combs, spec } : null;
}

function parseCss(css: string, rules: CssRule[], warn: (m: string) => void): void {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const n = css.length;
  let i = 0;
  while (i < n) {
    const brace = css.indexOf("{", i);
    if (brace < 0) break;
    let prelude = css.slice(i, brace).trim();
    // Drop block-less statements such as @import x; or @charset "utf-8";
    while (prelude.startsWith("@")) {
      const semi = prelude.indexOf(";");
      if (semi < 0) break;
      prelude = prelude.slice(semi + 1).trim();
    }
    let depth = 1;
    let j = brace + 1;
    while (j < n && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(brace + 1, depth ? j : j - 1);
    i = j;
    if (prelude.startsWith("@")) {
      if (/^@media\b/i.test(prelude)) parseCss(body, rules, warn);
      continue;
    }
    const decls = parseDecls(body);
    for (const s of prelude.split(",")) {
      const sel = parseSelector(s);
      if (sel) rules.push({ ...sel, order: rules.length, decls });
      else if (s.trim()) warn(`Unsupported CSS selector "${s.trim()}" ignored`);
    }
  }
}

function matchCompound(c: Compound, el: XmlEl): boolean {
  if (c.tag && c.tag !== localName(el.tag)) return false;
  if (c.id && el.attrs.id !== c.id) return false;
  if (c.classes.length) {
    const cls = (el.attrs.class ?? "").split(/\s+/);
    if (!c.classes.every((x) => cls.includes(x))) return false;
  }
  return true;
}

function matchFrom(r: CssRule, idx: number, el: XmlEl): boolean {
  if (!matchCompound(r.parts[idx], el)) return false;
  if (idx === 0) return true;
  let p = el.parent;
  if (r.combs[idx - 1] === ">") return !!p && p.tag !== "#document" && matchFrom(r, idx - 1, p);
  for (; p && p.tag !== "#document"; p = p.parent) if (matchFrom(r, idx - 1, p)) return true;
  return false;
}

// ---------------------------------------------------------------- geometry

const KAPPA = 0.5522847498;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const pt = (x: number, y: number): PathPoint => ({ x, y, inX: 0, inY: 0, outX: 0, outY: 0 });
const near = (a: PathPoint, b: PathPoint) =>
  Math.abs(a.x - b.x) <= 1e-9 * Math.max(1, Math.abs(a.x)) && Math.abs(a.y - b.y) <= 1e-9 * Math.max(1, Math.abs(a.y));

class Builder {
  contours: SvgContour[] = [];
  cur: SvgContour | null = null;

  moveTo(x: number, y: number): void {
    this.cur = { points: [pt(x, y)], closed: false };
    this.contours.push(this.cur);
  }

  /** Drawing after Z (or without a current subpath) starts a new contour at the current point. */
  ensure(x: number, y: number): void {
    if (!this.cur || this.cur.closed) this.moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this.cur!.points.push(pt(x, y));
  }

  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    const pts = this.cur!.points;
    const last = pts[pts.length - 1];
    last.outX = x1 - last.x;
    last.outY = y1 - last.y;
    pts.push({ x, y, inX: x2 - x, inY: y2 - y, outX: 0, outY: 0 });
  }

  close(): void {
    const c = this.cur;
    if (!c || c.closed) return;
    const pts = c.points;
    if (pts.length > 1 && near(pts[0], pts[pts.length - 1])) {
      const last = pts.pop()!;
      pts[0].inX = last.inX;
      pts[0].inY = last.inY;
    }
    c.closed = true;
  }

  result(): SvgContour[] {
    return this.contours.filter((c) => c.points.length > 1);
  }
}

/** Elliptical arc -> cubics (SVG spec F.6 endpoint-to-centre conversion, pieces of at most 90 degrees). */
function arcTo(b: Builder, x1: number, y1: number, rx: number, ry: number, phiDeg: number, fa: boolean, fs: boolean, x2: number, y2: number): void {
  if (x1 === x2 && y1 === y2) return;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) {
    b.lineTo(x2, y2);
    return;
  }
  const [cos, sin] = cosSin(phiDeg);
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cos * dx2 + sin * dy2;
  const y1p = -sin * dx2 + cos * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const theta1 = ang(1, 0, ux, uy);
  let dTheta = ang(ux, uy, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (fs && dTheta < 0) dTheta += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
  const delta = dTheta / segs;
  const k = (4 / 3) * Math.tan(delta / 4);
  const map = (u: number, v: number): [number, number] => [cx + cos * rx * u - sin * ry * v, cy + sin * rx * u + cos * ry * v];
  for (let s = 0; s < segs; s++) {
    const t1 = theta1 + s * delta;
    const t2 = t1 + delta;
    const c1t = Math.cos(t1);
    const s1t = Math.sin(t1);
    const c2t = Math.cos(t2);
    const s2t = Math.sin(t2);
    const [ax, ay] = map(c1t - k * s1t, s1t + k * c1t);
    const [bx, by] = map(c2t + k * s2t, s2t - k * c2t);
    const [ex, ey] = s === segs - 1 ? [x2, y2] : map(c2t, s2t);
    b.cubicTo(ax, ay, bx, by, ex, ey);
  }
}

const PATH_CMDS = "MmLlHhVvCcSsQqTtAaZz";
const BAD_PATH = { bad: true };

function parsePath(d: string, warn: (m: string) => void): SvgContour[] {
  const b = new Builder();
  const n = d.length;
  let i = 0;
  let cmd = "";
  let prev = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let qx = 0; // last control point, for S/T reflection
  let qy = 0;
  const ws = () => {
    while (i < n) {
      const c = d.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 44) i++;
      else break;
    }
  };
  const num = (): number => {
    ws();
    NUM_Y.lastIndex = i;
    const m = NUM_Y.exec(d);
    if (!m) throw BAD_PATH;
    i = NUM_Y.lastIndex;
    return parseFloat(m[0]);
  };
  const flag = (): boolean => {
    ws();
    const c = d[i];
    if (c !== "0" && c !== "1") throw BAD_PATH;
    i++;
    return c === "1";
  };
  try {
    for (;;) {
      ws();
      if (i >= n) break;
      const c = d[i];
      if (PATH_CMDS.includes(c)) {
        cmd = c;
        i++;
      } else if (!cmd || cmd === "Z" || cmd === "z") throw BAD_PATH;
      if (!prev && cmd !== "M" && cmd !== "m") {
        warn("Path data must begin with a moveto; path ignored");
        break;
      }
      const rel = cmd !== cmd.toUpperCase();
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      const up = cmd.toUpperCase();
      switch (up) {
        case "M": {
          const nx = num() + ox;
          const ny = num() + oy;
          b.moveTo(nx, ny);
          x = sx = nx;
          y = sy = ny;
          cmd = rel ? "l" : "L"; // implicit repeats are linetos
          break;
        }
        case "L": {
          const nx = num() + ox;
          const ny = num() + oy;
          b.ensure(x, y);
          b.lineTo(nx, ny);
          x = nx;
          y = ny;
          break;
        }
        case "H": {
          const nx = num() + ox;
          b.ensure(x, y);
          b.lineTo(nx, y);
          x = nx;
          break;
        }
        case "V": {
          const ny = num() + oy;
          b.ensure(x, y);
          b.lineTo(x, ny);
          y = ny;
          break;
        }
        case "C": {
          const x1 = num() + ox;
          const y1 = num() + oy;
          const x2 = num() + ox;
          const y2 = num() + oy;
          const nx = num() + ox;
          const ny = num() + oy;
          b.ensure(x, y);
          b.cubicTo(x1, y1, x2, y2, nx, ny);
          qx = x2;
          qy = y2;
          x = nx;
          y = ny;
          break;
        }
        case "S": {
          const x2 = num() + ox;
          const y2 = num() + oy;
          const nx = num() + ox;
          const ny = num() + oy;
          const smooth = prev === "C" || prev === "S";
          b.ensure(x, y);
          b.cubicTo(smooth ? 2 * x - qx : x, smooth ? 2 * y - qy : y, x2, y2, nx, ny);
          qx = x2;
          qy = y2;
          x = nx;
          y = ny;
          break;
        }
        case "Q":
        case "T": {
          let x1: number;
          let y1: number;
          if (up === "Q") {
            x1 = num() + ox;
            y1 = num() + oy;
          } else {
            const smooth = prev === "Q" || prev === "T";
            x1 = smooth ? 2 * x - qx : x;
            y1 = smooth ? 2 * y - qy : y;
          }
          const nx = num() + ox;
          const ny = num() + oy;
          b.ensure(x, y);
          b.cubicTo(x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y), nx + (2 / 3) * (x1 - nx), ny + (2 / 3) * (y1 - ny), nx, ny);
          qx = x1;
          qy = y1;
          x = nx;
          y = ny;
          break;
        }
        case "A": {
          const rx = num();
          const ry = num();
          const rot = num();
          const fa = flag();
          const fs = flag();
          const nx = num() + ox;
          const ny = num() + oy;
          b.ensure(x, y);
          arcTo(b, x, y, rx, ry, rot, fa, fs, nx, ny);
          x = nx;
          y = ny;
          break;
        }
        case "Z":
          b.close();
          x = sx;
          y = sy;
          break;
      }
      prev = up;
    }
  } catch (e) {
    if (e !== BAD_PATH) throw e;
    warn("Malformed path data; the remainder of the path was ignored");
  }
  return b.result();
}

/** Merge consecutive coincident points (degenerate rounded-rect sides), keeping in of the first and out of the second. */
function mergeCoincident(pts: PathPoint[]): PathPoint[] {
  const out: PathPoint[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && near(q, p)) {
      q.outX = p.outX;
      q.outY = p.outY;
    } else out.push({ ...p });
  }
  if (out.length > 1 && near(out[0], out[out.length - 1])) {
    const last = out.pop()!;
    out[0].inX = last.inX;
    out[0].inY = last.inY;
  }
  return out;
}

function rectContour(x: number, y: number, w: number, h: number, rx: number, ry: number): SvgContour {
  if (rx <= 0 || ry <= 0) return { points: [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)], closed: true };
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const p = (px: number, py: number, inX: number, inY: number, outX: number, outY: number): PathPoint => ({ x: px, y: py, inX, inY, outX, outY });
  return {
    closed: true,
    points: mergeCoincident([
      p(x + rx, y, -kx, 0, 0, 0),
      p(x + w - rx, y, 0, 0, kx, 0),
      p(x + w, y + ry, 0, -ky, 0, 0),
      p(x + w, y + h - ry, 0, 0, 0, ky),
      p(x + w - rx, y + h, kx, 0, 0, 0),
      p(x + rx, y + h, 0, 0, -kx, 0),
      p(x, y + h - ry, 0, ky, 0, 0),
      p(x, y + ry, 0, 0, 0, -ky),
    ]),
  };
}

function ellipseContour(cx: number, cy: number, rx: number, ry: number): SvgContour {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    closed: true,
    points: [
      { x: cx + rx, y: cy, inX: 0, inY: -ky, outX: 0, outY: ky },
      { x: cx, y: cy + ry, inX: kx, inY: 0, outX: -kx, outY: 0 },
      { x: cx - rx, y: cy, inX: 0, inY: ky, outX: 0, outY: -ky },
      { x: cx, y: cy - ry, inX: -kx, inY: 0, outX: kx, outY: 0 },
    ],
  };
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // Roots of the derivative / 3: a t^2 + b t + c.
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const out: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      out.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

function bounds(cs: SvgContour[]): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  const at = (p: number[], t: number) => {
    const u = 1 - t;
    return u * u * u * p[0] + 3 * u * u * t * p[1] + 3 * u * t * t * p[2] + t * t * t * p[3];
  };
  for (const c of cs) {
    const p = c.points;
    for (const q of p) add(q.x, q.y);
    const segs = c.closed ? p.length : p.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const xs = [a.x, a.x + a.outX, b.x + b.inX, b.x];
      const ys = [a.y, a.y + a.outY, b.y + b.inY, b.y];
      for (const t of [...cubicExtrema(xs[0], xs[1], xs[2], xs[3]), ...cubicExtrema(ys[0], ys[1], ys[2], ys[3])]) add(at(xs, t), at(ys, t));
    }
  }
  return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function mapContour(c: SvgContour, m: Matrix): SvgContour {
  return {
    closed: c.closed,
    points: c.points.map((p) => ({
      x: m[0] * p.x + m[2] * p.y + m[4] || 0,
      y: m[1] * p.x + m[3] * p.y + m[5] || 0,
      inX: m[0] * p.inX + m[2] * p.inY || 0,
      inY: m[1] * p.inX + m[3] * p.inY || 0,
      outX: m[0] * p.outX + m[2] * p.outY || 0,
      outY: m[1] * p.outX + m[3] * p.outY || 0,
    })),
  };
}

// ---------------------------------------------------------------- styling & painting

interface Style {
  fill: string;
  stroke: string;
  strokeWidth: number;
  join: SvgStroke["join"];
  cap: SvgStroke["cap"];
  fillRule: "nonzero" | "evenodd";
  fillOpacity: number;
  strokeOpacity: number;
  color: string;
  hidden: boolean;
}

const DEFAULT_STYLE: Style = {
  fill: "black",
  stroke: "none",
  strokeWidth: 1,
  join: "miter",
  cap: "butt",
  fillRule: "nonzero",
  fillOpacity: 1,
  strokeOpacity: 1,
  color: "black",
  hidden: false,
};

const PRESENTATION = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linejoin",
  "stroke-linecap",
  "fill-rule",
  "fill-opacity",
  "stroke-opacity",
  "opacity",
  "display",
  "visibility",
  "color",
  "stop-color",
  "stop-opacity",
];

interface State {
  ids: Map<string, XmlEl>;
  rules: CssRule[];
  warn: (m: string) => void;
  vw: number;
  vh: number;
  useStack: Set<XmlEl>;
}

const diag = (st: State) => Math.sqrt((st.vw * st.vw + st.vh * st.vh) / 2);
const NONE: Paint = { type: "none" };

/** Specified properties: presentation attributes < stylesheet rules (by specificity, then order) < style="". */
function declared(st: State, el: XmlEl): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PRESENTATION) {
    const v = el.attrs[p];
    if (v !== undefined) out[p] = v.trim();
  }
  for (const r of st.rules) if (matchFrom(r, r.parts.length - 1, el)) Object.assign(out, r.decls);
  if (el.attrs.style) Object.assign(out, parseDecls(el.attrs.style));
  return out;
}

function computeStyle(st: State, parent: Style, d: Record<string, string>): Style {
  const s: Style = { ...parent };
  const get = (k: string) => {
    const v = d[k];
    return v === undefined || v === "" || v === "inherit" ? undefined : v;
  };
  let v: string | undefined;
  if ((v = get("color")) && v.toLowerCase() !== "currentcolor") s.color = v;
  if ((v = get("fill"))) s.fill = v;
  if ((v = get("stroke"))) s.stroke = v;
  if ((v = get("stroke-width"))) {
    const w = parseLength(v, diag(st));
    if (w !== null && w >= 0) s.strokeWidth = w;
    else st.warn(`Invalid stroke-width "${v}" ignored`);
  }
  if ((v = get("stroke-linejoin"))) s.join = v === "round" ? "round" : v === "bevel" ? "bevel" : "miter";
  if ((v = get("stroke-linecap"))) s.cap = v === "round" ? "round" : v === "square" ? "square" : "butt";
  if ((v = get("fill-rule"))) s.fillRule = v === "evenodd" ? "evenodd" : "nonzero";
  if ((v = get("fill-opacity"))) s.fillOpacity = parseOpacity(v, s.fillOpacity);
  if ((v = get("stroke-opacity"))) s.strokeOpacity = parseOpacity(v, s.strokeOpacity);
  if ((v = get("visibility"))) s.hidden = v === "hidden" || v === "collapse";
  return s;
}

function readStops(st: State, el: XmlEl, opacity: number): GradientStop[] {
  const out: GradientStop[] = [];
  let last = 0;
  for (const s of el.children) {
    if (localName(s.tag) !== "stop") continue;
    const d = declared(st, s);
    const off = Math.max(last, parseOpacity(s.attrs.offset ?? "0", 0));
    last = off;
    let cs = d["stop-color"];
    if (!cs || cs === "inherit") cs = "black";
    if (cs.toLowerCase() === "currentcolor") cs = d.color ?? "black";
    let c = parseColor(cs);
    if (!c) {
      st.warn(`Invalid stop-color "${cs}"; using black`);
      c = [0, 0, 0, 1];
    }
    out.push({ offset: off, color: hex(c, parseOpacity(d["stop-opacity"], 1) * opacity) });
  }
  return out;
}

function gradientPaint(st: State, el: XmlEl, opacity: number, bbox: () => Box | null, m: Matrix): Paint {
  const chain: XmlEl[] = [];
  for (let g: XmlEl | undefined = el; g && !chain.includes(g) && chain.length < 16; ) {
    chain.push(g);
    const h = (g.attrs.href ?? g.attrs["xlink:href"] ?? "").trim();
    const next: XmlEl | undefined = h.startsWith("#") ? st.ids.get(h.slice(1)) : undefined;
    g = next && /Gradient$/.test(localName(next.tag)) ? next : undefined;
  }
  const kind = localName(el.tag);
  const attr = (k: string, sameKind = false): string | undefined => {
    for (const g of chain) if ((!sameKind || localName(g.tag) === kind) && g.attrs[k] !== undefined) return g.attrs[k];
    return undefined;
  };
  const stopsEl = chain.find((g) => g.children.some((c) => localName(c.tag) === "stop"));
  const stops = stopsEl ? readStops(st, stopsEl, opacity) : [];
  if (!stops.length) return NONE;
  if (stops.length === 1) return { type: "solid", color: stops[0].color };
  const userSpace = attr("gradientUnits")?.trim() === "userSpaceOnUse";
  let base = IDENTITY;
  if (!userSpace) {
    const b = bbox();
    if (!b || b.w <= 0 || b.h <= 0) {
      st.warn("objectBoundingBox gradient on a zero-width/height element; using its first stop");
      return { type: "solid", color: stops[0].color };
    }
    base = [b.w, 0, 0, b.h, b.x, b.y];
  }
  const gt = attr("gradientTransform");
  const M = mul(m, mul(base, gt ? parseTransform(gt, st.warn) : IDENTITY));
  const coord = (k: string, def: string, ref: number): number => {
    const r = userSpace ? ref : 1;
    return parseLength(attr(k, true), r) ?? parseLength(def, r)!;
  };
  if (kind === "linearGradient") {
    const from = apply(M, coord("x1", "0%", st.vw), coord("y1", "0%", st.vh));
    const to = apply(M, coord("x2", "100%", st.vw), coord("y2", "0%", st.vh));
    return { type: "linear", from, to, stops };
  }
  const cx = coord("cx", "50%", st.vw);
  const cy = coord("cy", "50%", st.vh);
  const r = coord("r", "50%", diag(st));
  if ((attr("fx", true) !== undefined && coord("fx", "50%", st.vw) !== cx) || (attr("fy", true) !== undefined && coord("fy", "50%", st.vh) !== cy)) {
    st.warn("Radial gradient focal point (fx/fy) is not supported and was ignored");
  }
  const ax = Math.hypot(M[0], M[1]);
  const ay = Math.hypot(M[2], M[3]);
  if (Math.abs(ax - ay) > 1e-6 * Math.max(ax, ay)) st.warn("Non-uniformly scaled radial gradient approximated by a circle");
  return { type: "radial", center: apply(M, cx, cy), radius: r * Math.sqrt(Math.abs(det(M))), stops };
}

function resolvePaint(st: State, raw: string, opacity: number, color: string, bbox: () => Box | null, m: Matrix): Paint {
  const s = raw.trim();
  if (s === "none" || s === "") return NONE;
  const black: Paint = { type: "solid", color: hex([0, 0, 0, 1], opacity) };
  if (/^url\(/i.test(s)) {
    const url = /^url\(\s*['"]?\s*#([^'")\s]+)\s*['"]?\s*\)\s*(.*)$/i.exec(s);
    if (!url) {
      st.warn(`External paint reference "${s}" is not supported; using black`);
      return black;
    }
    const ref = st.ids.get(url[1]);
    const tag = ref ? localName(ref.tag) : "";
    if (ref && (tag === "linearGradient" || tag === "radialGradient")) return gradientPaint(st, ref, opacity, bbox, m);
    const fallback = url[2].trim();
    if (fallback) return resolvePaint(st, fallback, opacity, color, bbox, m);
    st.warn(ref ? `Paint server <${tag}> "#${url[1]}" is not supported; using black` : `Paint reference "#${url[1]}" not found; using black`);
    return black;
  }
  const c = parseColor(s.toLowerCase() === "currentcolor" ? color : s);
  if (!c) {
    st.warn(`Invalid colour "${s}"; using black`);
    return black;
  }
  return { type: "solid", color: hex(c, opacity) };
}

// ---------------------------------------------------------------- tree walk

const NOT_RENDERED = new Set([
  "defs", "symbol", "clipPath", "mask", "title", "desc", "metadata", "style", "script", "linearGradient", "radialGradient",
  "pattern", "marker", "filter", "foreignObject", "font", "font-face", "cursor", "view", "stop",
  "animate", "animateTransform", "animateMotion", "animateColor", "set",
]);

interface Ctx {
  m: Matrix;
  style: Style;
}

function shapeContours(st: State, el: XmlEl, tag: string): SvgContour[] {
  const a = el.attrs;
  const L = (k: string, ref: number) => parseLength(a[k], ref) ?? 0;
  switch (tag) {
    case "path":
      return parsePath(a.d ?? "", st.warn);
    case "rect": {
      const w = L("width", st.vw);
      const h = L("height", st.vh);
      if (w <= 0 || h <= 0) return [];
      let rx = parseLength(a.rx, st.vw);
      let ry = parseLength(a.ry, st.vh);
      if (rx === null || rx < 0) rx = ry !== null && ry >= 0 ? ry : 0;
      if (ry === null || ry < 0) ry = rx;
      return [rectContour(L("x", st.vw), L("y", st.vh), w, h, Math.min(rx, w / 2), Math.min(ry, h / 2))];
    }
    case "circle": {
      const r = L("r", diag(st));
      return r > 0 ? [ellipseContour(L("cx", st.vw), L("cy", st.vh), r, r)] : [];
    }
    case "ellipse": {
      let rx = parseLength(a.rx, st.vw);
      let ry = parseLength(a.ry, st.vh);
      rx ??= ry;
      ry ??= rx;
      return rx && ry && rx > 0 && ry > 0 ? [ellipseContour(L("cx", st.vw), L("cy", st.vh), rx, ry)] : [];
    }
    case "line":
      return [{ points: [pt(L("x1", st.vw), L("y1", st.vh)), pt(L("x2", st.vw), L("y2", st.vh))], closed: false }];
    case "polyline":
    case "polygon": {
      const v = parseNumbers(a.points ?? "");
      if (v.length % 2) st.warn(`<${tag}> has an odd number of coordinates; the last one was ignored`);
      const pts: PathPoint[] = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push(pt(v[i], v[i + 1]));
      const closed = tag === "polygon";
      if (closed && pts.length > 2 && near(pts[0], pts[pts.length - 1])) pts.pop();
      return pts.length > 1 ? [{ points: pts, closed }] : [];
    }
  }
  return [];
}

function pathNode(st: State, name: string, opacity: number, style: Style, local: SvgContour[], m: Matrix): SvgNode | null {
  if (!local.length) return null;
  let box: Box | null | undefined;
  const bbox = () => (box === undefined ? (box = bounds(local)) : box);
  const fill = resolvePaint(st, style.fill, style.fillOpacity, style.color, bbox, m);
  let stroke: SvgStroke | null = null;
  const width = style.strokeWidth * Math.sqrt(Math.abs(det(m)));
  if (width > 0) {
    const paint = resolvePaint(st, style.stroke, style.strokeOpacity, style.color, bbox, m);
    if (paint.type !== "none") stroke = { paint, width, join: style.join, cap: style.cap };
  }
  return { kind: "path", name, opacity, fill, stroke, fillRule: style.fillRule, contours: local.map((c) => mapContour(c, m)) };
}

function walkChildren(st: State, el: XmlEl, ctx: Ctx): SvgNode[] {
  const out: SvgNode[] = [];
  for (const c of el.children) {
    const n = walk(st, c, ctx);
    if (n) out.push(n);
  }
  return out;
}

function walk(st: State, el: XmlEl, ctx: Ctx, viaUse = false): SvgNode | null {
  const tag = localName(el.tag);
  if (tag.includes(":")) return null; // editor-private elements (sodipodi:namedview, ...)
  if (NOT_RENDERED.has(tag) && !(viaUse && tag === "symbol")) return null;
  const d = declared(st, el);
  if (d.display === "none") return null;
  const style = computeStyle(st, ctx.style, d);
  let m = el.attrs.transform ? mul(ctx.m, parseTransform(el.attrs.transform, st.warn)) : ctx.m;
  const opacity = parseOpacity(d.opacity, 1);
  const name = el.attrs.id || el.attrs["inkscape:label"] || tag;
  const group = (children: SvgNode[]): SvgNode | null => (children.length ? { kind: "group", name, opacity, children } : null);

  switch (tag) {
    case "g":
    case "a":
    case "switch":
    case "symbol":
      return group(walkChildren(st, el, { m, style }));
    case "svg": {
      m = mul(m, translate(parseLength(el.attrs.x, st.vw) ?? 0, parseLength(el.attrs.y, st.vh) ?? 0));
      const vb = parseViewBox(el.attrs.viewBox, st.warn);
      const w = parseLength(el.attrs.width, st.vw);
      const h = parseLength(el.attrs.height, st.vh);
      if (vb && w && h && w > 0 && h > 0) {
        const par = (el.attrs.preserveAspectRatio ?? "").trim();
        let sx = w / vb[2];
        let sy = h / vb[3];
        let tx = 0;
        let ty = 0;
        if (!par.startsWith("none")) {
          const s = /slice/.test(par) ? Math.max(sx, sy) : Math.min(sx, sy);
          const ax = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5;
          const ay = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5;
          tx = (w - vb[2] * s) * ax;
          ty = (h - vb[3] * s) * ay;
          sx = sy = s;
        }
        m = mul(m, [sx, 0, 0, sy, tx - vb[0] * sx, ty - vb[1] * sy]);
      }
      return group(walkChildren(st, el, { m, style }));
    }
    case "use": {
      const href = (el.attrs.href ?? el.attrs["xlink:href"] ?? "").trim();
      const ref = href.startsWith("#") ? st.ids.get(href.slice(1)) : undefined;
      if (!ref) {
        st.warn(`<use> reference "${href}" not found`);
        return null;
      }
      if (st.useStack.has(ref) || st.useStack.size > 32) {
        st.warn(`Circular <use> reference "${href}" ignored`);
        return null;
      }
      m = mul(m, translate(parseLength(el.attrs.x, st.vw) ?? 0, parseLength(el.attrs.y, st.vh) ?? 0));
      st.useStack.add(ref);
      const child = walk(st, ref, { m, style }, true);
      st.useStack.delete(ref);
      return group(child ? [child] : []);
    }
    case "path":
    case "rect":
    case "circle":
    case "ellipse":
    case "line":
    case "polyline":
    case "polygon":
      if (style.hidden) return null;
      return pathNode(st, name, opacity, style, shapeContours(st, el, tag), m);
    default:
      st.warn(`Unsupported element <${tag}> skipped`);
      return null;
  }
}

// ---------------------------------------------------------------- entry point

export function parseSvg(svg: string): SvgImport {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const warn = (msg: string) => {
    if (!seen.has(msg)) {
      seen.add(msg);
      warnings.push(msg);
    }
  };
  const doc = parseXml(String(svg ?? ""), warn);

  const found: { root: XmlEl | null } = { root: null };
  const ids = new Map<string, XmlEl>();
  const rules: CssRule[] = [];
  const visit = (el: XmlEl) => {
    for (const c of el.children) {
      const tag = localName(c.tag);
      if (!found.root && tag === "svg") found.root = c;
      if (c.attrs.id && !ids.has(c.attrs.id)) ids.set(c.attrs.id, c);
      if (tag === "style" && (!c.attrs.type || /css/i.test(c.attrs.type))) parseCss(c.text, rules, warn);
      visit(c);
    }
  };
  visit(doc);
  const r = found.root;
  if (!r) throw new Error("Not an SVG document");
  rules.sort((a, b) => a.spec - b.spec || a.order - b.order);

  const pct = (s: string | undefined) => (s && s.includes("%") ? undefined : s);
  const vb = parseViewBox(r.attrs.viewBox, warn);
  const w = parseLength(pct(r.attrs.width), 0);
  const h = parseLength(pct(r.attrs.height), 0);
  const width = w !== null && w > 0 ? w : vb ? vb[2] : 300;
  const height = h !== null && h > 0 ? h : vb ? vb[3] : 150;
  const viewBox: [number, number, number, number] = vb ?? [0, 0, width, height];

  const st: State = { ids, rules, warn, vw: viewBox[2], vh: viewBox[3], useStack: new Set() };
  const d = declared(st, r);
  let nodes: SvgNode[] = [];
  if (d.display !== "none") {
    const m = r.attrs.transform ? parseTransform(r.attrs.transform, warn) : IDENTITY;
    nodes = walkChildren(st, r, { m, style: computeStyle(st, DEFAULT_STYLE, d) });
    const opacity = parseOpacity(d.opacity, 1);
    if (opacity < 1 && nodes.length) nodes = [{ kind: "group", name: r.attrs.id || "svg", opacity, children: nodes }];
  }
  return { width, height, viewBox, nodes, warnings };
}
