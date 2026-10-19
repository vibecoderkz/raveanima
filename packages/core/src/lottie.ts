import { sampleTrack } from "./animation.js";
import { parseColor } from "./color.js";
import { getAnimation } from "./doc.js";
import { apply, localMatrix, multiply, nodeContours } from "./geometry.js";
import { easeToCubic } from "./easing.js";
import type { AnimaDocument, AnimaNode, Animation, Paint, PathPoint, Track } from "./types.js";

/*
 * Anima -> Lottie (Bodymovin 5.x). Every root node becomes a shape layer; groups become nested
 * "gr" items. Lottie's transform (translate p, rotate r, scale s, translate -a) is exactly Anima's.
 * Keyframes keep their bezier easing when all dimensions of a property share key times;
 * otherwise the property is baked per frame.
 */

type Json = Record<string, unknown>;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function colorVec(c: string): number[] {
  const { r, g, b, a } = parseColor(c);
  return [r3(r / 255), r3(g / 255), r3(b / 255), r3(a)];
}

interface Ctx {
  anim: Animation | null;
  fps: number;
  frames: number;
  warnings: string[];
}

function trackFor(ctx: Ctx, nodeId: string, prop: string): Track | undefined {
  const t = ctx.anim?.tracks.find((x) => x.nodeId === nodeId && x.prop === prop);
  return t && t.keys.length > 0 ? t : undefined;
}

/**
 * Build a Lottie animatable value from per-dimension tracks.
 * `dims` gives, per output dimension, its track (or undefined) and the static value.
 */
function prop(ctx: Ctx, dims: { track?: Track; value: number }[], map: (v: number[]) => number[] | number): Json {
  const tracks = dims.map((d) => d.track).filter((t): t is Track => !!t);
  const wrap = (v: number[] | number) => (Array.isArray(v) ? v.map(r3) : r3(v));
  const at = (time: number) => dims.map((d) => (d.track ? (sampleTrack(d.track.keys, time) as number) : d.value));
  if (tracks.length === 0) return { a: 0, k: wrap(map(dims.map((d) => d.value))) };

  const times = tracks[0]!.keys.map((k) => k.time);
  const aligned = tracks.every((t) => t.keys.length === times.length && t.keys.every((k, i) => Math.abs(k.time - times[i]!) < 1e-6));
  const keys: Json[] = [];
  if (aligned) {
    times.forEach((time, i) => {
      const v = wrap(map(at(time)));
      const k: Json = { t: r3(time * ctx.fps), s: Array.isArray(v) ? v : [v] };
      if (i < times.length - 1) {
        const eases = dims.map((d) => (d.track ? easeToCubic(d.track.keys[i]!.ease) : [0, 0, 1, 1]));
        if (eases.some((e) => e === null)) k.h = 1;
        else {
          const e = eases as [number, number, number, number][];
          k.o = { x: e.map((c) => r3(c[0])), y: e.map((c) => r3(c[1])) };
          k.i = { x: e.map((c) => r3(c[2])), y: e.map((c) => r3(c[3])) };
        }
      }
      keys.push(k);
    });
  } else {
    for (let f = 0; f <= ctx.frames; f++) {
      const v = wrap(map(at(f / ctx.fps)));
      const k: Json = { t: f, s: Array.isArray(v) ? v : [v] };
      if (f < ctx.frames) {
        k.o = { x: [0], y: [0] };
        k.i = { x: [1], y: [1] };
      }
      keys.push(k);
    }
  }
  return { a: 1, k: keys };
}

function colorProp(ctx: Ctx, track: Track | undefined, value: string): Json {
  if (!track) return { a: 0, k: colorVec(value) };
  return {
    a: 1,
    k: track.keys.map((key, i) => {
      const k: Json = { t: r3(key.time * ctx.fps), s: colorVec(key.value as string) };
      if (i < track.keys.length - 1) {
        const e = easeToCubic(key.ease);
        if (!e) k.h = 1;
        else {
          k.o = { x: [e[0]], y: [e[1]] };
          k.i = { x: [e[2]], y: [e[3]] };
        }
      }
      return k;
    }),
  };
}

function shapeData(points: PathPoint[], closed: boolean): Json {
  return {
    i: points.map((p) => [r3(p.inX), r3(p.inY)]),
    o: points.map((p) => [r3(p.outX), r3(p.outY)]),
    v: points.map((p) => [r3(p.x), r3(p.y)]),
    c: closed,
  };
}

const LINE_CAP = { butt: 1, round: 2, square: 3 } as const;
const LINE_JOIN = { miter: 1, round: 2, bevel: 3 } as const;

function gradient(p: Extract<Paint, { type: "linear" | "radial" }>): Json {
  const stops = [...p.stops].sort((a, b) => a.offset - b.offset);
  const k: number[] = [];
  for (const s of stops) {
    const [r, g, b] = colorVec(s.color);
    k.push(r3(s.offset), r!, g!, b!);
  }
  const alphas = stops.map((s) => colorVec(s.color)[3]!);
  if (alphas.some((a) => a < 1)) stops.forEach((s, i) => k.push(r3(s.offset), alphas[i]!));
  const geo =
    p.type === "linear"
      ? { t: 1, s: { a: 0, k: [p.from.x, p.from.y] }, e: { a: 0, k: [p.to.x, p.to.y] } }
      : { t: 2, s: { a: 0, k: [p.center.x, p.center.y] }, e: { a: 0, k: [p.center.x + p.radius, p.center.y] }, h: { a: 0, k: 0 }, a: { a: 0, k: 0 } };
  return { ...geo, g: { p: stops.length, k: { a: 0, k } } };
}

function paintItems(ctx: Ctx, node: AnimaNode): Json[] {
  const items: Json[] = [];
  const s = node.stroke;
  if (s && s.width > 0 && s.paint.type !== "none") {
    const base = { o: { a: 0, k: 100 }, w: prop(ctx, [{ track: trackFor(ctx, node.id, "stroke.width"), value: s.width }], (v) => v[0]!), lc: LINE_CAP[s.cap], lj: LINE_JOIN[s.join], ml: 4 };
    if (s.paint.type === "solid") items.push({ ty: "st", nm: "Stroke", ...base, c: colorProp(ctx, trackFor(ctx, node.id, "stroke.paint.color"), s.paint.color) });
    else items.push({ ty: "gs", nm: "Stroke", ...base, ...gradient(s.paint as Extract<Paint, { type: "linear" | "radial" }>) });
  }
  const isClosed = node.type !== "path" || node.closed || node.subpaths.some((c) => c.closed);
  const r = node.type === "path" && node.fillRule === "evenodd" ? 2 : 1;
  if (isClosed && node.fill.type === "solid") items.push({ ty: "fl", nm: "Fill", o: { a: 0, k: 100 }, r, c: colorProp(ctx, trackFor(ctx, node.id, "fill.color"), node.fill.color) });
  else if (isClosed && (node.fill.type === "linear" || node.fill.type === "radial")) items.push({ ty: "gf", nm: "Fill", o: { a: 0, k: 100 }, r, ...gradient(node.fill) });
  return items;
}

function trimItem(ctx: Ctx, node: AnimaNode): Json | null {
  if (!("trimStart" in node)) return null;
  const tr = (p: string, value: number) => ({ track: trackFor(ctx, node.id, p), value });
  const animated = ["trimStart", "trimEnd", "trimOffset"].some((p) => trackFor(ctx, node.id, p));
  if (!animated && node.trimStart <= 0 && node.trimEnd >= 1 && node.trimOffset % 1 === 0) return null;
  return {
    ty: "tm",
    nm: "Trim",
    s: prop(ctx, [tr("trimStart", node.trimStart)], (v) => v[0]! * 100),
    e: prop(ctx, [tr("trimEnd", node.trimEnd)], (v) => v[0]! * 100),
    o: prop(ctx, [tr("trimOffset", node.trimOffset)], (v) => v[0]! * 360),
    m: 1,
  };
}

function geometryItems(ctx: Ctx, node: AnimaNode): Json[] {
  const main = geometryItem(ctx, node);
  if (!main) return [];
  if (node.type !== "path") return [main];
  return [main, ...node.subpaths.filter((c) => c.points.length > 1).map((c, i) => ({ ty: "sh", nm: `Path ${i + 2}`, d: 1, ks: { a: 0, k: shapeData(c.points, c.closed) } }))];
}

function geometryItem(ctx: Ctx, node: AnimaNode): Json | null {
  const tr = (prop2: string, value: number) => ({ track: trackFor(ctx, node.id, prop2), value });
  const center = { a: 0, k: [0, 0] };
  switch (node.type) {
    case "rect":
      return { ty: "rc", nm: "Rect", d: 1, p: center, s: prop(ctx, [tr("width", node.width), tr("height", node.height)], (v) => v), r: prop(ctx, [tr("cornerRadius", node.cornerRadius)], (v) => v[0]!) };
    case "ellipse":
      return { ty: "el", nm: "Ellipse", d: 1, p: center, s: prop(ctx, [tr("width", node.width), tr("height", node.height)], (v) => v) };
    case "polygon":
      return { ty: "sr", nm: "Polygon", sy: 2, d: 1, p: center, r: { a: 0, k: 0 }, pt: { a: 0, k: node.sides }, or: prop(ctx, [tr("radius", node.radius)], (v) => v[0]!), os: { a: 0, k: 0 } };
    case "star":
      return {
        ty: "sr",
        nm: "Star",
        sy: 1,
        d: 1,
        p: center,
        r: { a: 0, k: 0 },
        pt: { a: 0, k: node.points },
        or: prop(ctx, [tr("radius", node.radius)], (v) => v[0]!),
        ir: prop(ctx, [tr("innerRadius", node.innerRadius)], (v) => v[0]!),
        os: { a: 0, k: 0 },
        is: { a: 0, k: 0 },
      };
    case "path": {
      if (node.points.length < 2) return null;
      const t = trackFor(ctx, node.id, "points");
      const ks: Json = t
        ? {
            a: 1,
            k: t.keys.map((key, i) => {
              const pts = key.value as PathPoint[];
              const k: Json = { t: r3(key.time * ctx.fps), s: [shapeData(pts.length === node.points.length ? pts : node.points, node.closed)] };
              if (i < t.keys.length - 1) {
                const e = easeToCubic(key.ease);
                if (!e) k.h = 1;
                else {
                  k.o = { x: [e[0]], y: [e[1]] };
                  k.i = { x: [e[2]], y: [e[3]] };
                }
              }
              return k;
            }),
          }
        : { a: 0, k: shapeData(node.points, node.closed) };
      return { ty: "sh", nm: "Path", d: 1, ks };
    }
    default:
      return null;
  }
}

function transformItem(ctx: Ctx, node: AnimaNode): Json {
  const t = node.transform;
  const tr = (p: string, value: number) => ({ track: trackFor(ctx, node.id, p), value });
  return {
    ty: "tr",
    nm: "Transform",
    p: prop(ctx, [tr("transform.x", t.x), tr("transform.y", t.y)], (v) => v),
    a: prop(ctx, [tr("transform.originX", t.originX), tr("transform.originY", t.originY)], (v) => v),
    s: prop(ctx, [tr("transform.scaleX", t.scaleX), tr("transform.scaleY", t.scaleY)], (v) => [v[0]! * 100, v[1]! * 100]),
    r: prop(ctx, [tr("transform.rotation", t.rotation)], (v) => v[0]!),
    o: prop(ctx, [tr("opacity", node.opacity)], (v) => v[0]! * 100),
    sk: { a: 0, k: 0 },
    sa: { a: 0, k: 0 },
  };
}

function groupItem(ctx: Ctx, doc: AnimaDocument, node: AnimaNode, root = false): Json | null {
  if (!node.visible) return null;
  if (!root && (node.blur > 0 || node.shadow)) ctx.warnings.push(`"${node.name}": blur and shadow are exported only on top-level layers in Lottie`);
  if (node.type === "text") {
    ctx.warnings.push(`"${node.name}": text is not exported to Lottie yet (convert it to paths)`);
    return null;
  }
  if (node.type === "image") {
    if (!root) ctx.warnings.push(`"${node.name}": images are exported to Lottie only at the top level`);
    return null;
  }
  const it: Json[] = [];
  if (node.type === "group") {
    let kids = node.children;
    if (node.clip && kids.length > 1) {
      if (!root) ctx.warnings.push(`"${node.name}": clipping is exported to Lottie only for top-level groups`);
      kids = kids.slice(1);
    }
    // Lottie draws the first item on top; Anima lists children bottom -> top.
    for (const id of [...kids].reverse()) {
      const c = doc.nodes[id];
      const g = c && groupItem(ctx, doc, c);
      if (g) it.push(g);
    }
  } else {
    const geo = geometryItems(ctx, node);
    if (!geo.length) return null;
    const trim = trimItem(ctx, node);
    it.push(...geo, ...(trim ? [trim] : []), ...paintItems(ctx, node));
  }
  it.push(transformItem(ctx, node));
  return { ty: "gr", nm: node.name, np: it.length, it };
}

function layerEffects(node: AnimaNode): Json[] | undefined {
  const ef: Json[] = [];
  if (node.blur > 0)
    ef.push({ ty: 29, nm: "Gaussian Blur", np: 5, en: 1, ef: [{ ty: 0, nm: "Blurriness", v: { a: 0, k: node.blur * 2 } }, { ty: 7, nm: "Blur Dimensions", v: { a: 0, k: 1 } }, { ty: 7, nm: "Repeat Edge Pixels", v: { a: 0, k: 0 } }] });
  if (node.shadow) {
    const [r, g, b, a] = colorVec(node.shadow.color);
    const angle = (Math.atan2(node.shadow.x, -node.shadow.y) * 180) / Math.PI;
    ef.push({
      ty: 25,
      nm: "Drop Shadow",
      np: 8,
      en: 1,
      ef: [
        { ty: 2, nm: "Shadow Color", v: { a: 0, k: [r, g, b, 1] } },
        { ty: 0, nm: "Opacity", v: { a: 0, k: r3(a! * 255) } },
        { ty: 1, nm: "Direction", v: { a: 0, k: r3(angle) } },
        { ty: 0, nm: "Distance", v: { a: 0, k: r3(Math.hypot(node.shadow.x, node.shadow.y)) } },
        { ty: 0, nm: "Softness", v: { a: 0, k: node.shadow.blur } },
        { ty: 7, nm: "Shadow Only", v: { a: 0, k: 0 } },
      ],
    });
  }
  return ef.length ? ef : undefined;
}

/** A top-level clipping group becomes a layer mask (static: animated mask transforms are not followed). */
function layerMask(ctx: Ctx, doc: AnimaDocument, node: AnimaNode): Json[] | undefined {
  if (node.type !== "group" || !node.clip || node.children.length < 2) return undefined;
  const mask = doc.nodes[node.children[0]!];
  if (!mask || mask.type === "group") return undefined;
  if (["transform.x", "transform.y", "transform.rotation", "transform.scaleX", "transform.scaleY"].some((p) => trackFor(ctx, node.id, p) || trackFor(ctx, mask.id, p)))
    ctx.warnings.push(`"${node.name}": the clip mask is exported at its rest position`);
  const m = multiply(localMatrix(node.transform), localMatrix(mask.transform));
  return nodeContours(mask).map((c) => ({
    inv: false,
    mode: "a",
    o: { a: 0, k: 100 },
    x: { a: 0, k: 0 },
    nm: mask.name,
    pt: {
      a: 0,
      k: shapeData(
        c.points.map((p) => {
          const q = apply(m, p.x, p.y);
          return { x: q.x, y: q.y, inX: m[0] * p.inX + m[2] * p.inY, inY: m[1] * p.inX + m[3] * p.inY, outX: m[0] * p.outX + m[2] * p.outY, outY: m[1] * p.outX + m[3] * p.outY };
        }),
        c.closed,
      ),
    },
  }));
}

const IDENTITY_KS = { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } };

export function exportLottie(doc: AnimaDocument, animId?: string | null, warnings: string[] = []): Json {
  const anim = doc.animations.length && (animId || doc.activeAnimation) ? getAnimation(doc, animId) : null;
  const duration = anim?.duration ?? 1;
  const frames = Math.max(1, Math.round(duration * doc.fps));
  const ctx: Ctx = { anim, fps: doc.fps, frames, warnings };
  const layers: Json[] = [];
  const assets: Json[] = [];
  doc.root.forEach((id, index) => {
    const node = doc.nodes[id];
    if (!node || !node.visible) return;
    const base = { ddd: 0, ind: doc.root.length - index, nm: node.name, sr: 1, ao: 0, ip: 0, op: frames, st: 0, bm: 0, ef: layerEffects(node) };
    if (node.type === "image") {
      if (!node.src) return;
      const refId = `img_${node.id}`;
      const isData = node.src.startsWith("data:");
      assets.push({ id: refId, w: node.width, h: node.height, u: "", p: node.src, e: isData ? 1 : 0 });
      const t = node.transform;
      const tr = (p: string, value: number) => ({ track: trackFor(ctx, node.id, p), value });
      layers.unshift({
        ...base,
        ty: 2,
        refId,
        ks: {
          o: prop(ctx, [tr("opacity", node.opacity)], (v) => v[0]! * 100),
          r: prop(ctx, [tr("transform.rotation", t.rotation)], (v) => v[0]!),
          p: prop(ctx, [tr("transform.x", t.x), tr("transform.y", t.y)], (v) => [v[0]!, v[1]!, 0]),
          a: prop(ctx, [tr("transform.originX", t.originX), tr("transform.originY", t.originY)], (v) => [v[0]! + node.width / 2, v[1]! + node.height / 2, 0]),
          s: prop(ctx, [tr("transform.scaleX", t.scaleX), tr("transform.scaleY", t.scaleY)], (v) => [v[0]! * 100, v[1]! * 100, 100]),
        },
      });
      return;
    }
    const g = groupItem(ctx, doc, node, true);
    if (!g) return;
    const masks = layerMask(ctx, doc, node);
    layers.unshift({ ...base, ty: 4, ks: IDENTITY_KS, shapes: [g], ...(masks ? { hasMask: true, masksProperties: masks } : {}) });
  });
  // Background as the bottom layer so players show the artboard colour.
  layers.push({
    ddd: 0,
    ind: doc.root.length + 1,
    ty: 4,
    nm: "Background",
    sr: 1,
    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
    ao: 0,
    shapes: [
      {
        ty: "gr",
        nm: "Background",
        np: 3,
        it: [
          { ty: "rc", d: 1, p: { a: 0, k: [doc.width / 2, doc.height / 2] }, s: { a: 0, k: [doc.width, doc.height] }, r: { a: 0, k: 0 } },
          { ty: "fl", o: { a: 0, k: 100 }, r: 1, c: { a: 0, k: colorVec(doc.background) } },
          { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } },
        ],
      },
    ],
    ip: 0,
    op: frames,
    st: 0,
    bm: 0,
  });
  return { v: "5.7.4", fr: doc.fps, ip: 0, op: frames, w: doc.width, h: doc.height, nm: anim ? `${doc.name} - ${anim.name}` : doc.name, ddd: 0, assets, layers, meta: { g: "RaveAnima" } };
}
