import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { evaluate, getAnimation, loadImages, renderDocument, setTextMeasurer, type AnimaDocument, type Ctx2D } from "@raveanima/core";

// Skia only sees system font dirs; add the user's own fonts (e.g. ~/.fonts/sf-pro) so text renders as designed.
// loadFontsFromDir is not recursive, so walk subfolders too (following symlinks: ~/.fonts/x is often a link).
function loadFontTree(dir: string, depth = 0) {
  if (!existsSync(dir) || depth > 4) return;
  GlobalFonts.loadFontsFromDir(dir);
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    try {
      if (statSync(p).isDirectory()) loadFontTree(p, depth + 1);
    } catch {
      /* broken link */
    }
  }
}
for (const dir of [join(homedir(), ".fonts"), join(homedir(), ".local", "share", "fonts")]) loadFontTree(dir);

// Real text metrics from Skia, so selection bounds and alignment match the rendered glyphs.
const measureCtx = createCanvas(4, 4).getContext("2d");
setTextMeasurer((text, font, letterSpacing) => {
  measureCtx.font = font;
  return measureCtx.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
});

const imageCache = new Map<string, unknown>();
/** Decode the document's images (data URLs, files, http) before drawing. */
export async function prepare(doc: AnimaDocument): Promise<Map<string, unknown>> {
  return loadImages(doc, (src) => loadImage(src), imageCache);
}

export interface PngOptions {
  time?: number;
  animation?: string;
  /** Pixel scale; default 1. Ignored when maxSize is set and smaller. */
  scale?: number;
  /** Fit the longest side into this many pixels. */
  maxSize?: number;
}

function fitScale(doc: AnimaDocument, scale = 1, maxSize?: number): number {
  if (!maxSize) return scale;
  return Math.min(scale, maxSize / Math.max(doc.width, doc.height));
}

function drawTo(ctx: SKRSContext2D, doc: AnimaDocument, time: number, scale: number, animation?: string, ox = 0, oy = 0) {
  renderDocument(ctx as unknown as Ctx2D, evaluate(doc, time, animation), { scale, offsetX: ox, offsetY: oy, images: imageCache });
}

export async function renderPng(doc: AnimaDocument, opts: PngOptions = {}): Promise<Buffer> {
  await prepare(doc);
  const s = fitScale(doc, opts.scale, opts.maxSize);
  const w = Math.max(1, Math.round(doc.width * s));
  const h = Math.max(1, Math.round(doc.height * s));
  const canvas = createCanvas(w, h);
  drawTo(canvas.getContext("2d"), doc, opts.time ?? 0, s, opts.animation);
  return canvas.toBuffer("image/png");
}

function animDuration(doc: AnimaDocument, animation?: string): number {
  if (doc.animations.length === 0) return 0;
  return getAnimation(doc, animation ?? doc.activeAnimation).duration;
}

/**
 * One image with `frames` evenly spaced frames of the animation, labelled with their time.
 * Lets an agent "see" motion in a single look instead of many renders.
 */
export async function renderContactSheet(doc: AnimaDocument, opts: { frames?: number; animation?: string; cell?: number; mode?: "even" | "keys" } = {}): Promise<Buffer> {
  await prepare(doc);
  const dur = animDuration(doc, opts.animation);
  const times = sheetTimes(doc, dur, Math.max(1, Math.min(36, opts.frames ?? 8)), opts.mode ?? "even", opts.animation);
  const n = times.length;
  const cell = opts.cell ?? 320;
  const s = cell / Math.max(doc.width, doc.height);
  const cw = Math.round(doc.width * s);
  const ch = Math.round(doc.height * s);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const pad = 12;
  const label = 22;
  const canvas = createCanvas(cols * (cw + pad) + pad, rows * (ch + pad + label) + pad);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f6f6f4";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < n; i++) {
    const t = times[i]!;
    const x = pad + (i % cols) * (cw + pad);
    const y = pad + Math.floor(i / cols) * (ch + pad + label);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y + label, cw, ch);
    ctx.clip();
    drawTo(ctx, doc, t, s, opts.animation, x, y + label);
    ctx.restore();
    ctx.strokeStyle = "#ececec";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + label + 0.5, cw - 1, ch - 1);
    ctx.fillStyle = "#6c6c74";
    ctx.font = "13px sans-serif";
    ctx.fillText(`${t.toFixed(2)}s`, x, y + 15);
  }
  return canvas.toBuffer("image/png");
}

/**
 * Frame times for a contact sheet. "keys" samples every distinct keyframe time plus the midpoints
 * between them, so short events (a 0.2 s blink) are never skipped; it falls back to even spacing.
 */
function sheetTimes(doc: AnimaDocument, dur: number, n: number, mode: "even" | "keys", animation?: string): number[] {
  const even = Array.from({ length: n }, (_, i) => (n === 1 ? 0 : (dur * i) / (n - 1)));
  if (mode === "even" || !doc.animations.length) return even;
  const anim = getAnimation(doc, animation ?? doc.activeAnimation);
  const keys = [...new Set(anim.tracks.flatMap((t) => t.keys.map((k) => +k.time.toFixed(3))))].sort((a, b) => a - b);
  const all = [...new Set(keys.flatMap((k, i) => (i ? [+((keys[i - 1]! + k) / 2).toFixed(3), k] : [k])))].sort((a, b) => a - b);
  if (all.length <= n) return all;
  // Too many: keep evenly spread picks from the key list.
  return Array.from({ length: n }, (_, i) => all[Math.round((i * (all.length - 1)) / (n - 1))]!);
}

export interface VideoOptions {
  animation?: string;
  fps?: number;
  scale?: number;
  /** Seconds; defaults to the animation duration (min 1 frame). */
  duration?: number;
  /** Repeat the clip this many times (for short loops). */
  loops?: number;
}

/** Render every frame and pipe raw RGBA into ffmpeg. Format follows the output extension (.mp4, .webm, .gif, .mov). */
export async function renderVideo(doc: AnimaDocument, out: string, opts: VideoOptions = {}): Promise<{ frames: number; path: string }> {
  const fps = opts.fps ?? doc.fps;
  const scale = opts.scale ?? 1;
  // Even dimensions keep yuv420p encoders happy.
  const w = Math.max(2, Math.round((doc.width * scale) / 2) * 2);
  const h = Math.max(2, Math.round((doc.height * scale) / 2) * 2);
  const dur = (opts.duration ?? (animDuration(doc, opts.animation) || 1)) * (opts.loops ?? 1);
  const frames = Math.max(1, Math.round(dur * fps));
  await prepare(doc);
  const ext = out.split(".").pop()!.toLowerCase();
  const enc: Record<string, string[]> = {
    mp4: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart"],
    webm: ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30"],
    mov: ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le"],
    gif: ["-vf", "split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=sierra2_4a"],
  };
  if (!enc[ext]) throw new Error(`Unsupported video format ".${ext}" (use .mp4, .webm, .mov or .gif)`);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${w}x${h}`, "-r", String(fps), "-i", "-", ...enc[ext]!, out], {
    stdio: ["pipe", "ignore", "pipe"],
  });
  let stderr = "";
  ff.stderr.on("data", (d) => (stderr += d));
  const done = new Promise<void>((resolve, reject) => {
    ff.on("error", (e) => reject(new Error(`ffmpeg not available: ${e.message}`)));
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`))));
  });
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  for (let f = 0; f < frames; f++) {
    ctx.clearRect(0, 0, w, h);
    drawTo(ctx, doc, f / fps, w / doc.width, opts.animation);
    const data = ctx.getImageData(0, 0, w, h).data;
    if (!ff.stdin.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await done;
  return { frames, path: out };
}
