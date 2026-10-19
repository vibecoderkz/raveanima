import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { embedHtml, exportLottie, exportSvg, migrateDocument, type AnimaDocument } from "@raveanima/core";

declare const __PLAYER_JS__: string;
import { renderPng, renderVideo } from "./render.js";

export function readDocument(path: string): AnimaDocument {
  const doc = JSON.parse(readFileSync(path, "utf8")) as AnimaDocument;
  if (doc.format !== "anima") throw new Error(`${path} is not a RaveAnima document`);
  return migrateDocument(doc);
}

export function writeDocument(path: string, doc: AnimaDocument): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
}

export type ExportFormat = "anima" | "lottie" | "svg" | "png" | "mp4" | "webm" | "mov" | "gif" | "html";

export function formatFromPath(path: string): ExportFormat {
  const ext = extname(path).slice(1).toLowerCase();
  if (ext === "json") return "lottie";
  if (["anima", "svg", "png", "mp4", "webm", "mov", "gif", "html"].includes(ext)) return ext as ExportFormat;
  throw new Error(`Cannot tell the format from "${path}". Use .anima, .json (Lottie), .html (interactive web page), .svg, .png, .mp4, .webm, .mov or .gif`);
}

export interface ExportOptions {
  time?: number;
  animation?: string;
  scale?: number;
  fps?: number;
  loops?: number;
}

/** Write the document in the format implied by the file extension. */
export async function exportTo(doc: AnimaDocument, path: string, opts: ExportOptions = {}): Promise<{ path: string; format: ExportFormat; bytes?: number; frames?: number }> {
  const format = formatFromPath(path);
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const write = (data: string | Buffer) => {
    writeFileSync(path, data);
    return { path, format, bytes: Buffer.byteLength(data) };
  };
  switch (format) {
    case "anima":
      writeDocument(path, doc);
      return { path, format };
    case "lottie":
      return write(JSON.stringify(exportLottie(doc, opts.animation)));
    case "svg":
      return write(exportSvg(doc, opts.time ?? 0, opts.animation));
    case "html":
      return write(embedHtml(doc, __PLAYER_JS__));
    case "png":
      return write(await renderPng(doc, { time: opts.time, animation: opts.animation, scale: opts.scale }));
    default: {
      const r = await renderVideo(doc, path, { animation: opts.animation, fps: opts.fps, scale: opts.scale, loops: opts.loops });
      return { path, format, frames: r.frames };
    }
  }
}
