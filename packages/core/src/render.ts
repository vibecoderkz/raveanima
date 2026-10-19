import { evaluate } from "./animation.js";
import { parseColor, toCss } from "./color.js";
import { contourToSvgPath, forEachSegment, localMatrix, nodeContours, textFont, textLayout, trimContours, type Cubic } from "./geometry.js";
import type { AnimaDocument, AnimaNode, Contour, Paint } from "./types.js";

/**
 * The subset of CanvasRenderingContext2D the renderer uses. Browser canvases (the desktop app)
 * and @napi-rs/canvas (headless rendering for agents and the CLI) both satisfy it.
 */
export interface Ctx2D {
  save(): void;
  restore(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  getTransform?(): { a: number; b: number; c: number; d: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void;
  fill(rule?: "nonzero" | "evenodd"): void;
  stroke(): void;
  clip(rule?: "nonzero" | "evenodd"): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  drawImage(img: unknown, x: number, y: number, w: number, h: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradientLike;
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: string;
  lineCap: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  letterSpacing?: string;
  filter?: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface RenderOptions {
  /** Output scale (pixel ratio, zoom). Default 1. */
  scale?: number;
  /** Extra view transform applied after scale (pan in the editor). */
  offsetX?: number;
  offsetY?: number;
  /** Paint the document background. Default true. */
  background?: boolean;
  /** Decoded images by src (see loadImages). Missing ones draw as a placeholder. */
  images?: Map<string, unknown>;
}

function makeStyle(ctx: Ctx2D, paint: Paint): unknown | null {
  switch (paint.type) {
    case "none":
      return null;
    case "solid":
      return toCss(paint.color);
    case "linear": {
      const g = ctx.createLinearGradient(paint.from.x, paint.from.y, paint.to.x, paint.to.y);
      for (const s of paint.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), toCss(s.color));
      return g;
    }
    case "radial": {
      const g = ctx.createRadialGradient(paint.center.x, paint.center.y, 0, paint.center.x, paint.center.y, Math.max(0.0001, paint.radius));
      for (const s of paint.stops) g.addColorStop(Math.min(1, Math.max(0, s.offset)), toCss(s.color));
      return g;
    }
  }
}

/** Device pixels per local unit at the current transform. */
function pixelScale(ctx: Ctx2D, fallback: number): number {
  const m = ctx.getTransform?.();
  return m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || fallback : fallback;
}

function traceContours(ctx: Ctx2D, contours: Contour[]) {
  for (const { points, closed } of contours) {
    if (!points.length) continue;
    ctx.moveTo(points[0]!.x, points[0]!.y);
    forEachSegment(points, closed, (_a, c1x, c1y, c2x, c2y, b) => ctx.bezierCurveTo(c1x, c1y, c2x, c2y, b.x, b.y));
    if (closed) ctx.closePath();
  }
}

function traceRuns(ctx: Ctx2D, runs: Cubic[][]) {
  for (const run of runs) {
    ctx.moveTo(run[0]!.x0, run[0]!.y0);
    for (const q of run) ctx.bezierCurveTo(q.c1x, q.c1y, q.c2x, q.c2y, q.x1, q.y1);
  }
}

function isTrimmed(node: AnimaNode): node is Extract<AnimaNode, { trimStart: number }> {
  return "trimStart" in node && (node.trimStart > 0 || node.trimEnd < 1 || (node.trimOffset ?? 0) % 1 !== 0);
}

function applyEffects(ctx: Ctx2D, node: AnimaNode, px: number) {
  if (node.blur > 0 && "filter" in ctx) ctx.filter = `blur(${node.blur * px}px)`;
  if (node.shadow) {
    ctx.shadowColor = toCss(node.shadow.color);
    ctx.shadowBlur = node.shadow.blur * px;
    ctx.shadowOffsetX = node.shadow.x * px;
    ctx.shadowOffsetY = node.shadow.y * px;
  }
}

function clearEffects(ctx: Ctx2D) {
  if ("filter" in ctx) ctx.filter = "none";
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function drawNode(ctx: Ctx2D, doc: AnimaDocument, node: AnimaNode, alpha: number, opts: RenderOptions): void {
  if (!node.visible || node.opacity <= 0) return;
  ctx.save();
  ctx.transform(...localMatrix(node.transform));
  const px = pixelScale(ctx, opts.scale ?? 1);
  // Group opacity and effects multiply down the tree (no offscreen compositing yet).
  const a = alpha * Math.min(1, Math.max(0, node.opacity));
  if (node.type === "group") {
    let kids = node.children;
    if (node.clip && kids.length > 1) {
      const mask = doc.nodes[kids[0]!];
      if (mask && mask.type !== "group") {
        ctx.save();
        ctx.transform(...localMatrix(mask.transform));
        ctx.beginPath();
        traceContours(ctx, nodeContours(mask));
        ctx.restore();
        ctx.clip(mask.type === "path" ? mask.fillRule : "nonzero");
      }
      kids = kids.slice(1);
    }
    const inherited = node.blur > 0 || node.shadow;
    for (const id of kids) {
      const c = doc.nodes[id];
      if (!c) continue;
      if (inherited) {
        ctx.save();
        applyEffects(ctx, node, px);
        drawNode(ctx, doc, c, a, opts);
        ctx.restore();
      } else drawNode(ctx, doc, c, a, opts);
    }
    ctx.restore();
    return;
  }
  ctx.globalAlpha = a;
  applyEffects(ctx, node, px);
  if (node.type === "image") {
    const img = opts.images?.get(node.src);
    if (img) ctx.drawImage(img, -node.width / 2, -node.height / 2, node.width, node.height);
    else {
      ctx.fillStyle = "rgba(10,10,11,0.06)";
      ctx.fillRect(-node.width / 2, -node.height / 2, node.width, node.height);
    }
  } else if (node.type === "text") {
    const layout = textLayout(node);
    ctx.font = textFont(node);
    ctx.textAlign = node.align;
    ctx.textBaseline = "middle";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${node.letterSpacing}px`;
    const fill = makeStyle(ctx, node.fill);
    const stroke = node.stroke && node.stroke.width > 0 ? makeStyle(ctx, node.stroke.paint) : null;
    for (const l of layout.lines) {
      if (fill !== null) {
        ctx.fillStyle = fill;
        ctx.fillText(l.text, l.x, l.y);
      }
      if (stroke !== null && node.stroke) {
        clearEffects(ctx);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = node.stroke.width;
        ctx.lineJoin = node.stroke.join;
        ctx.strokeText(l.text, l.x, l.y);
      }
    }
  } else {
    const contours = nodeContours(node);
    const trimmed = isTrimmed(node);
    const closed = contours.some((c) => c.closed);
    ctx.beginPath();
    if (trimmed) traceRuns(ctx, trimContours(contours, node.trimStart, node.trimEnd, node.trimOffset));
    else traceContours(ctx, contours);
    const fill = makeStyle(ctx, node.fill);
    if (fill !== null && closed) {
      ctx.fillStyle = fill;
      ctx.fill(node.type === "path" ? node.fillRule : "nonzero");
      // The shadow belongs to the silhouette; don't cast it a second time from the stroke.
      if (node.shadow) {
        clearEffects(ctx);
        if (node.blur > 0 && "filter" in ctx) ctx.filter = `blur(${node.blur * px}px)`;
      }
    }
    if (node.stroke && node.stroke.width > 0) {
      const s = makeStyle(ctx, node.stroke.paint);
      if (s !== null) {
        ctx.strokeStyle = s;
        ctx.lineWidth = node.stroke.width;
        ctx.lineJoin = node.stroke.join;
        ctx.lineCap = node.stroke.cap;
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** Draw an already evaluated document (no animation applied here). */
export function renderDocument(ctx: Ctx2D, doc: AnimaDocument, opts: RenderOptions = {}): void {
  const s = opts.scale ?? 1;
  ctx.save();
  ctx.setTransform(s, 0, 0, s, opts.offsetX ?? 0, opts.offsetY ?? 0);
  ctx.globalAlpha = 1;
  clearEffects(ctx);
  if (opts.background !== false) {
    ctx.fillStyle = toCss(doc.background);
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  for (const id of doc.root) {
    const n = doc.nodes[id];
    if (n) drawNode(ctx, doc, n, 1, opts);
  }
  ctx.restore();
}

/** Evaluate the active (or given) animation at `time` seconds and draw it. */
export function renderFrame(ctx: Ctx2D, doc: AnimaDocument, time: number, opts: RenderOptions & { animation?: string } = {}): void {
  renderDocument(ctx, evaluate(doc, time, opts.animation), opts);
}

/** Every image src used by the document. */
export function imageSources(doc: AnimaDocument): string[] {
  return [...new Set(Object.values(doc.nodes).flatMap((n) => (n.type === "image" && n.src ? [n.src] : [])))];
}

/** Decode every image of the document with an environment loader; failures are skipped. */
export async function loadImages(doc: AnimaDocument, load: (src: string) => Promise<unknown>, cache = new Map<string, unknown>()): Promise<Map<string, unknown>> {
  await Promise.all(
    imageSources(doc)
      .filter((src) => !cache.has(src))
      .map(async (src) => {
        try {
          cache.set(src, await load(src));
        } catch {
          /* missing image: drawn as a placeholder */
        }
      }),
  );
  return cache;
}

// ---------- SVG ----------

function svgColor(c: string): string {
  const { r, g, b, a } = parseColor(c);
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+a.toFixed(3)})`;
}

function svgPaint(paint: Paint, defs: string[], id: string): string {
  const stops = (p: Extract<Paint, { stops: unknown }>) => p.stops.map((s) => `<stop offset="${s.offset}" stop-color="${svgColor(s.color)}"/>`).join("");
  switch (paint.type) {
    case "none":
      return "none";
    case "solid":
      return svgColor(paint.color);
    case "linear":
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${paint.from.x}" y1="${paint.from.y}" x2="${paint.to.x}" y2="${paint.to.y}">${stops(paint)}</linearGradient>`);
      return `url(#${id})`;
    case "radial":
      defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${paint.center.x}" cy="${paint.center.y}" r="${paint.radius}">${stops(paint)}</radialGradient>`);
      return `url(#${id})`;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const f3 = (v: number) => +v.toFixed(3);

function runsToSvg(runs: Cubic[][]): string {
  return runs.map((r) => `M${f3(r[0]!.x0)} ${f3(r[0]!.y0)}` + r.map((q) => `C${f3(q.c1x)} ${f3(q.c1y)} ${f3(q.c2x)} ${f3(q.c2y)} ${f3(q.x1)} ${f3(q.y1)}`).join("")).join("");
}

/** Static SVG of the document at `time` seconds. */
export function exportSvg(doc: AnimaDocument, time = 0, animation?: string): string {
  const d = evaluate(doc, time, animation);
  const defs: string[] = [];
  const filterFor = (n: AnimaNode): string => {
    if (!(n.blur > 0) && !n.shadow) return "";
    const parts: string[] = [];
    if (n.shadow) parts.push(`<feDropShadow dx="${n.shadow.x}" dy="${n.shadow.y}" stdDeviation="${n.shadow.blur / 2}" flood-color="${svgColor(n.shadow.color)}"/>`);
    if (n.blur > 0) parts.push(`<feGaussianBlur stdDeviation="${n.blur / 2}"/>`);
    defs.push(`<filter id="${n.id}-fx" x="-50%" y="-50%" width="200%" height="200%">${parts.join("")}</filter>`);
    return ` filter="url(#${n.id}-fx)"`;
  };
  const emit = (id: string): string => {
    const n = d.nodes[id];
    if (!n || !n.visible) return "";
    const m = localMatrix(n.transform).map((v) => +v.toFixed(5)).join(" ");
    const attrs = `transform="matrix(${m})" opacity="${n.opacity}" data-name="${esc(n.name)}"${filterFor(n)}`;
    if (n.type === "group") {
      let kids = n.children;
      let clip = "";
      if (n.clip && kids.length > 1) {
        const mask = d.nodes[kids[0]!];
        if (mask && mask.type !== "group") {
          const mm = localMatrix(mask.transform).map((v) => +v.toFixed(5)).join(" ");
          defs.push(`<clipPath id="${n.id}-clip"><path transform="matrix(${mm})" d="${nodeContours(mask).map((c) => contourToSvgPath(c.points, c.closed)).join("")}"/></clipPath>`);
          clip = ` clip-path="url(#${n.id}-clip)"`;
        }
        kids = kids.slice(1);
      }
      return `<g ${attrs}><g${clip}>${kids.map(emit).join("")}</g></g>`;
    }
    if (n.type === "image") return `<image ${attrs} x="${-n.width / 2}" y="${-n.height / 2}" width="${n.width}" height="${n.height}" href="${esc(n.src)}" preserveAspectRatio="none"/>`;
    const stroke = n.stroke
      ? ` stroke="${svgPaint(n.stroke.paint, defs, `${n.id}-stroke`)}" stroke-width="${n.stroke.width}" stroke-linejoin="${n.stroke.join}" stroke-linecap="${n.stroke.cap}"`
      : "";
    if (n.type === "text") {
      const l = textLayout(n);
      const anchor = n.align === "left" ? "start" : n.align === "right" ? "end" : "middle";
      const fam = n.fontFamily.includes(",") ? n.fontFamily : `'${n.fontFamily}', sans-serif`;
      return `<text ${attrs} font-family="${esc(fam)}" font-size="${n.fontSize}" font-weight="${n.fontWeight}" letter-spacing="${n.letterSpacing}" text-anchor="${anchor}" dominant-baseline="central" fill="${svgPaint(n.fill, defs, `${n.id}-fill`)}"${stroke}>${l.lines.map((ln) => `<tspan x="${f3(ln.x)}" y="${f3(ln.y)}">${esc(ln.text)}</tspan>`).join("")}</text>`;
    }
    const contours = nodeContours(n);
    const closed = contours.some((c) => c.closed);
    const dAttr = isTrimmed(n) ? runsToSvg(trimContours(contours, n.trimStart, n.trimEnd, n.trimOffset)) : contours.map((c) => contourToSvgPath(c.points, c.closed)).join("");
    const fill = closed ? svgPaint(n.fill, defs, `${n.id}-fill`) : "none";
    const rule = n.type === "path" && n.fillRule === "evenodd" ? ` fill-rule="evenodd"` : "";
    return `<path ${attrs} d="${dAttr}" fill="${fill}"${rule}${stroke}/>`;
  };
  const body = d.root.map(emit).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width}" height="${d.height}" viewBox="0 0 ${d.width} ${d.height}">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    `<rect width="100%" height="100%" fill="${svgColor(d.background)}"/>${body}</svg>`
  );
}
