import { useSyncExternalStore } from "react";
import { createEditor, evaluate, getProp, loadImages, setTextMeasurer, StateMachineRuntime, type AnimaDocument, type NodePatchInput } from "@raveanima/core";

export type Tool = "select" | "rect" | "ellipse" | "polygon" | "star" | "pen" | "text";
export type Mode = "design" | "animate";

export interface SelectedKey {
  nodeId: string;
  prop: string;
  time: number;
}

export interface UiState {
  tool: Tool;
  mode: Mode;
  playing: boolean;
  zoom: number;
  panX: number;
  panY: number;
  filePath: string | null;
  selectedKey: SelectedKey | null;
  /** Path being edited point by point (double-click a path). */
  editPath: string | null;
  collapsed: Record<string, boolean>;
  bottomTab: "timeline" | "sm";
  activeSm: string | null;
  /** Interactive preview of the state machine on the canvas. */
  smPreview: boolean;
  toast: { text: string; error?: boolean; id: number } | null;
  agent: { connected: boolean; busy: boolean; last: string | null };
  exportOpen: boolean;
  aboutOpen: boolean;
}

export const editor = createEditor();

// Real glyph metrics for text bounds and selection boxes.
const measureCtx = document.createElement("canvas").getContext("2d")!;
setTextMeasurer((text, font, letterSpacing) => {
  measureCtx.font = font;
  return measureCtx.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
});

/** Decoded images by src; the canvas redraws once each image arrives. */
export const images = new Map<string, unknown>();
const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
let loadingImages = false;
function syncImages() {
  if (loadingImages) return;
  const missing = Object.values(editor.doc.nodes).some((n) => n.type === "image" && n.src && !images.has(n.src));
  if (!missing) return;
  loadingImages = true;
  loadImages(editor.doc, loadImage, images).finally(() => {
    loadingImages = false;
    bump();
  });
}

let ui: UiState = {
  tool: "select",
  mode: "design",
  playing: false,
  zoom: 1,
  panX: 0,
  panY: 0,
  filePath: null,
  selectedKey: null,
  editPath: null,
  collapsed: {},
  bottomTab: "timeline",
  activeSm: null,
  smPreview: false,
  toast: null,
  agent: { connected: false, busy: false, last: null },
  exportOpen: false,
  aboutOpen: false,
};

let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  for (const l of listeners) l();
};
editor.subscribe(() => {
  syncImages();
  if (ui.editPath && editor.doc.nodes[ui.editPath]?.type !== "path") ui = { ...ui, editPath: null };
  bump();
});

export function setUi(patch: Partial<UiState>) {
  const wasPreview = ui.smPreview;
  ui = { ...ui, ...patch };
  if (ui.smPreview && !wasPreview) startPreview();
  if (!ui.smPreview) smRuntime = null;
  bump();
}

/** The running state machine while previewing (null otherwise). */
export let smRuntime: StateMachineRuntime | null = null;

function startPreview() {
  try {
    smRuntime = new StateMachineRuntime(editor.doc, ui.activeSm ?? undefined);
  } catch (e) {
    ui = { ...ui, smPreview: false };
    toast((e as Error).message, true);
    return;
  }
  let last = performance.now();
  const loop = (now: number) => {
    if (!ui.smPreview || !smRuntime) return;
    smRuntime.advance(Math.min(0.1, (now - last) / 1000));
    last = now;
    bump();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** Nudge React after the preview runtime changed inputs. */
export function refresh() {
  bump();
}
export const getUi = () => ui;

/** Re-render on any editor or UI change. Returns the version so components can memo on it. */
export function useStore(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, error = false) {
  setUi({ toast: { text, error, id: Date.now() } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setUi({ toast: null }), error ? 4200 : 2200);
}

/** Run a command and surface errors as a toast instead of throwing into React. */
export function run<R = unknown>(command: string, params: unknown = {}, historyKey?: string): R | undefined {
  try {
    return editor.execute<R>(command, params, historyKey ? { historyKey } : {});
  } catch (e) {
    toast((e as Error).message, true);
    return undefined;
  }
}

/** The document as it should look right now: animated in animate mode, rest pose in design mode. */
let viewCache: { v: number; doc: AnimaDocument } | null = null;
export function viewDoc(): AnimaDocument {
  if (viewCache && viewCache.v === version) return viewCache.doc;
  const d = editor.doc;
  const doc = ui.smPreview && smRuntime ? smRuntime.evaluate() : ui.mode === "animate" && d.activeAnimation ? evaluate(d, editor.state.time) : d;
  viewCache = { v: version, doc };
  return doc;
}

/** Build a node.update patch from a property path ("transform.x", "fill.color", "stroke.width"...). */
export function patchFor(nodeId: string, prop: string, value: unknown): NodePatchInput {
  const node = editor.doc.nodes[nodeId]!;
  const [head, ...rest] = prop.split(".");
  if (head === "transform") return { transform: { [rest[0]!]: value } };
  if (head === "fill") {
    if (rest[0] === "color") return { fill: value as string };
    return { fill: { ...(node.fill as object), [rest[0]!]: value } as never };
  }
  if (head === "stroke") {
    if (rest.join(".") === "paint.color") return { stroke: { paint: value as string } };
    return { stroke: { [rest[0]!]: value } as never };
  }
  return { [head!]: value } as NodePatchInput;
}

/**
 * The single entry point for property edits from the inspector and canvas.
 * Design mode edits the rest pose; animate mode writes a keyframe at the playhead
 * (adding a 0s key with the rest value first so the motion starts from the design).
 */
export function editProp(nodeId: string, prop: string, value: unknown, historyKey?: string) {
  if (ui.mode === "animate" && editor.doc.activeAnimation) {
    const t = +editor.state.time.toFixed(4);
    const anim = editor.doc.animations.find((a) => a.id === editor.doc.activeAnimation)!;
    const hasTrack = anim.tracks.some((tr) => tr.nodeId === nodeId && tr.prop === prop);
    const key = historyKey ?? `key-${nodeId}-${prop}-${Date.now()}`;
    if (!hasTrack && t > 0) run("keyframe.set", { nodeId, prop, time: 0 }, key);
    run("keyframe.set", { nodeId, prop, time: t, value }, key);
    return;
  }
  run("node.update", { id: nodeId, props: patchFor(nodeId, prop, value) }, historyKey);
}

export function editProps(nodeId: string, values: Record<string, unknown>, historyKey: string) {
  for (const [prop, v] of Object.entries(values)) editProp(nodeId, prop, v, historyKey);
}

export function trackInfo(nodeId: string, prop: string): { hasTrack: boolean; keyHere: boolean } {
  const d = editor.doc;
  const anim = d.animations.find((a) => a.id === d.activeAnimation);
  const track = anim?.tracks.find((t) => t.nodeId === nodeId && t.prop === prop);
  return { hasTrack: !!track, keyHere: !!track?.keys.some((k) => Math.abs(k.time - editor.state.time) < 1e-3) };
}

export function currentValue(nodeId: string, prop: string): unknown {
  return getProp(viewDoc().nodes[nodeId], prop);
}

export function setTime(t: number) {
  const d = editor.doc;
  const anim = d.animations.find((a) => a.id === d.activeAnimation);
  const max = anim?.duration ?? 0;
  editor.state.time = Math.max(0, Math.min(max, t));
  bump();
}

// ---------- autosave ----------
const AUTOSAVE_KEY = "anima.autosave";
setInterval(() => {
  if (!editor.dirty) return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ at: Date.now(), path: ui.filePath, doc: editor.doc }));
  } catch {
    /* storage full or unavailable */
  }
}, 5000);

export function readAutosave(): { at: number; path: string | null; doc: AnimaDocument } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- clipboard ----------
let clipboard: unknown = null;
export async function copySelection(cut = false) {
  const ids = editor.state.selection;
  if (!ids.length) return;
  const r = run<{ fragment: unknown }>("node.copy", { ids });
  if (!r) return;
  clipboard = r.fragment;
  try {
    await navigator.clipboard.writeText(JSON.stringify(r.fragment));
  } catch {
    /* system clipboard may be blocked; the in-app copy still works */
  }
  if (cut) run("node.delete", { ids });
  toast(cut ? `Cut ${ids.length} layer${ids.length > 1 ? "s" : ""}` : `Copied ${ids.length} layer${ids.length > 1 ? "s" : ""}`);
}

export async function pasteClipboard() {
  let text: string | null = null;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    /* fall back to the in-app clipboard */
  }
  if (text?.includes("<svg")) {
    run("import.svg", { svg: text, name: "Pasted SVG" });
    return;
  }
  let frag = clipboard;
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.format === "anima-fragment") frag = parsed;
    } catch {
      /* not ours */
    }
  }
  if (frag) run("node.paste", { fragment: frag, offsetX: 20, offsetY: 20 });
}
