import { embedHtml, exportLottie, exportSvg, getAnimation, renderDocument, evaluate, type AnimaDocument, type Ctx2D } from "@raveanima/core";
import playerJs from "../../../packages/player/dist/anima-player.iife.js?raw";
import { clearAutosave, editor, getUi, images, setUi, toast } from "./store";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauri() {
  const [{ invoke }, dialog, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/plugin-dialog"), import("@tauri-apps/api/event")]);
  return { invoke, dialog, listen };
}

const baseName = (p: string) => p.replace(/^.*[\\/]/, "");

function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function openDocument() {
  if (editor.dirty && !confirm("Discard unsaved changes?")) return;
  if (isDesktop) {
    const { invoke, dialog } = await tauri();
    const path = await dialog.open({ filters: [{ name: "RaveAnima", extensions: ["anima"] }] });
    if (typeof path !== "string") return;
    const text = await invoke<string>("read_text_file", { path });
    loadText(text, path);
  } else {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".anima,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) loadText(await f.text(), f.name);
    };
    input.click();
  }
}

function loadText(text: string, path: string) {
  try {
    const doc = JSON.parse(text) as AnimaDocument;
    editor.execute("doc.load", { document: doc });
    setUi({ filePath: path, selectedKey: null });
    toast(`Opened ${baseName(path)}`);
  } catch (e) {
    toast(`Could not open: ${(e as Error).message}`, true);
  }
}

export async function saveDocument(saveAs = false) {
  const text = JSON.stringify(editor.doc, null, 2) + "\n";
  let path = getUi().filePath;
  if (isDesktop) {
    const { invoke, dialog } = await tauri();
    if (!path || saveAs || !path.endsWith(".anima")) {
      const p = await dialog.save({ defaultPath: `${editor.doc.name}.anima`, filters: [{ name: "RaveAnima", extensions: ["anima"] }] });
      if (!p) return;
      path = p;
    }
    await invoke("write_text_file", { path, contents: text });
  } else {
    path = `${editor.doc.name}.anima`;
    download(path, text, "application/json");
  }
  editor.dirty = false;
  clearAutosave();
  setUi({ filePath: path });
  toast(`Saved ${baseName(path)}`);
}

export function newDocument() {
  if (editor.dirty && !confirm("Discard unsaved changes?")) return;
  editor.execute("doc.new", { name: "Untitled", width: 1080, height: 1080, background: "#ffffff" });
  clearAutosave();
  setUi({ filePath: null, selectedKey: null, mode: "design" });
}

export type ExportKind = "lottie" | "html" | "svg" | "png" | "mp4" | "gif" | "webm";
const EXT: Record<ExportKind, string> = { lottie: "json", html: "html", svg: "svg", png: "png", mp4: "mp4", gif: "gif", webm: "webm" };

function frameCanvas(doc: AnimaDocument, scale = 1) {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round((doc.width * scale) / 2) * 2);
  c.height = Math.max(2, Math.round((doc.height * scale) / 2) * 2);
  return c;
}

export async function exportAs(kind: ExportKind) {
  const doc = editor.doc;
  const name = `${doc.name}.${EXT[kind]}`;
  let path: string | null = null;
  if (isDesktop) {
    const { dialog } = await tauri();
    path = await dialog.save({ defaultPath: name, filters: [{ name: kind.toUpperCase(), extensions: [EXT[kind]] }] });
    if (!path) return;
  }
  try {
    if (kind === "lottie" || kind === "svg" || kind === "html") {
      const warnings: string[] = [];
      const text = kind === "lottie" ? JSON.stringify(exportLottie(doc, undefined, warnings)) : kind === "html" ? embedHtml(doc, playerJs) : exportSvg(doc, editor.state.time);
      if (path) await (await tauri()).invoke("write_text_file", { path, contents: text });
      else download(name, text, kind === "svg" ? "image/svg+xml" : kind === "html" ? "text/html" : "application/json");
      if (warnings.length) {
        toast(`Exported with ${new Set(warnings).size} note(s): ${[...new Set(warnings)][0]}`, true);
        return;
      }
    } else if (kind === "png") {
      const c = frameCanvas(doc, 2);
      renderDocument(c.getContext("2d") as unknown as Ctx2D, evaluate(doc, editor.state.time), { scale: c.width / doc.width, images });
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
      if (path) await writeBinary(path, new Uint8Array(await blob.arrayBuffer()));
      else download(name, blob, "image/png");
    } else {
      if (!path) return toast("Video export needs the desktop app (uses ffmpeg)", true);
      await exportVideo(doc, path, kind);
    }
    toast(`Exported ${path ? baseName(path) : name}`);
  } catch (e) {
    toast(`Export failed: ${(e as Error).message ?? e}`, true);
  }
}

async function writeBinary(path: string, bytes: Uint8Array) {
  const { invoke } = await tauri();
  await invoke("write_binary_file", bytes, { headers: { path: encodeURIComponent(path) } });
}

async function exportVideo(doc: AnimaDocument, path: string, kind: ExportKind) {
  const { invoke } = await tauri();
  const anim = doc.activeAnimation ? getAnimation(doc) : null;
  const fps = doc.fps;
  const frames = Math.max(1, Math.round((anim?.duration ?? 1) * fps));
  const c = frameCanvas(doc);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  await invoke("video_start", { path, width: c.width, height: c.height, fps, format: kind });
  for (let f = 0; f < frames; f++) {
    ctx.clearRect(0, 0, c.width, c.height);
    renderDocument(ctx as unknown as Ctx2D, evaluate(doc, f / fps), { scale: c.width / doc.width, images });
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    await invoke("video_frame", new Uint8Array(data.buffer));
    if (f % 10 === 0) setUi({ toast: { text: `Rendering ${Math.round((f / frames) * 100)}%`, id: 1 } });
  }
  await invoke("video_finish");
}

/**
 * Live bridge: the Rust side listens on 127.0.0.1 and forwards agent requests here; we run them
 * on the same editor the human is using, so every agent step is visible and undoable.
 */
export async function startBridge() {
  if (!isDesktop) return;
  const { invoke, listen } = await tauri();
  let idle: ReturnType<typeof setTimeout> | undefined;
  await listen<{ id: string; method: string; params: { command?: string; params?: unknown; steps?: { command: string; params?: unknown }[] } }>("bridge-request", async (ev) => {
    const { id, method, params } = ev.payload;
    let reply: { ok: boolean; result?: unknown; error?: string };
    try {
      const label = method === "batch" ? `batch x${params.steps?.length ?? 0}` : params.command ?? method;
      setUi({ agent: { connected: true, busy: true, last: label } });
      let result: unknown;
      if (method === "execute") result = editor.execute(params.command!, params.params ?? {});
      else if (method === "batch") result = editor.batch(params.steps ?? []);
      else if (method === "ping") result = { app: "anima" };
      else throw new Error(`Unknown bridge method "${method}"`);
      reply = { ok: true, result: result ?? null };
    } catch (e) {
      reply = { ok: false, error: (e as Error).message };
    }
    await invoke("bridge_reply", { id, reply: JSON.stringify(reply) });
    clearTimeout(idle);
    idle = setTimeout(() => setUi({ agent: { ...getUi().agent, busy: false } }), 600);
  });
  try {
    const info = await invoke<{ port: number }>("bridge_info");
    setUi({ agent: { connected: true, busy: false, last: null } });
    console.info(`RaveAnima bridge on 127.0.0.1:${info.port}`);
  } catch {
    setUi({ agent: { connected: false, busy: false, last: null } });
  }
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 400, h: 300 });
    img.src = src;
  });
}

/** Import an SVG (as editable paths) or a raster image (embedded) at a document position. */
export async function importFile(file: File, at?: { x: number; y: number }) {
  const doc = editor.doc;
  if (file.name.toLowerCase().endsWith(".svg") || file.type === "image/svg+xml") {
    const svg = await file.text();
    const r = editor.execute<{ id: string; warnings: string[] }>("import.svg", { svg, name: file.name.replace(/\.svg$/i, "") });
    if (at) editor.execute("node.align", { ids: [r.id], align: "center", to: "artboard" });
    toast(r.warnings.length ? `Imported ${file.name} (${r.warnings.length} warnings)` : `Imported ${file.name}`);
    return;
  }
  if (IMAGE_EXT.test(file.name) || file.type.startsWith("image/")) {
    const src = await fileToDataUrl(file);
    const { w, h } = await imageSize(src);
    const fit = Math.min(1, (doc.width * 0.8) / w, (doc.height * 0.8) / h);
    editor.execute("node.add", { type: "image", props: { name: file.name, src, width: Math.round(w * fit), height: Math.round(h * fit), transform: { x: at?.x ?? doc.width / 2, y: at?.y ?? doc.height / 2 } } });
    toast(`Placed ${file.name}`);
    return;
  }
  if (file.name.endsWith(".anima")) return loadText(await file.text(), file.name);
  toast(`Can't import ${file.name}: use .svg, .png, .jpg, .webp or .anima`, true);
}

export function pickAndImport() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".svg,image/*";
  input.multiple = true;
  input.onchange = async () => {
    for (const f of Array.from(input.files ?? [])) {
      try {
        await importFile(f);
      } catch (e) {
        toast(`Import failed: ${(e as Error).message}`, true);
      }
    }
  };
  input.click();
}
