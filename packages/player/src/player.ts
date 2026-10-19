// <anima-player>: plays .anima documents on any web page, with state machines and pointer interaction.
// Imports only the rendering half of core (no zod, no commands), so the bundle stays small.
import { evaluate } from "../../core/src/animation.js";
import { migrateDocument } from "../../core/src/doc.js";
import { apply, forEachSegment, invert, nodeContours, setTextMeasurer, worldMatrix } from "../../core/src/geometry.js";
import { loadImages, renderDocument, type Ctx2D } from "../../core/src/render.js";
import { StateMachineRuntime } from "../../core/src/statemachine.js";
import type { AnimaDocument, AnimaNode } from "../../core/src/types.js";

export const PLAYER_VERSION = "0.2.0";

const measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
if (measureCtx)
  setTextMeasurer((text, font, ls) => {
    measureCtx.font = font;
    return measureCtx.measureText(text).width + Math.max(0, text.length - 1) * ls;
  });

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const hitCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;

/** Topmost visible node under a document-space point. */
function hitTest(doc: AnimaDocument, x: number, y: number): string | null {
  if (!hitCtx) return null;
  let hit: string | null = null;
  const visit = (ids: string[], visible: boolean) => {
    for (const id of ids) {
      const n = doc.nodes[id];
      if (!n) continue;
      const vis = visible && n.visible && n.opacity > 0;
      if (n.type === "group") {
        visit(n.clip ? n.children.slice(1) : n.children, vis);
        continue;
      }
      if (vis && inside(doc, n, x, y)) hit = id;
    }
  };
  visit(doc.root, true);
  return hit;
}

function inside(doc: AnimaDocument, n: AnimaNode, x: number, y: number): boolean {
  const l = apply(invert(worldMatrix(doc, n.id)), x, y);
  const p = new Path2D();
  const contours = nodeContours(n);
  for (const c of contours) {
    if (!c.points.length) continue;
    p.moveTo(c.points[0]!.x, c.points[0]!.y);
    forEachSegment(c.points, c.closed, (_a, c1x, c1y, c2x, c2y, b) => p.bezierCurveTo(c1x, c1y, c2x, c2y, b.x, b.y));
    if (c.closed) p.closePath();
  }
  if (contours.some((c) => c.closed) && hitCtx!.isPointInPath(p, l.x, l.y)) return true;
  hitCtx!.lineWidth = Math.max(8, (n.stroke?.width ?? 0) + 6);
  return hitCtx!.isPointInStroke(p, l.x, l.y);
}

export class AnimaPlayer extends HTMLElement {
  static observedAttributes = ["src", "state-machine", "animation", "fit", "paused"];
  doc: AnimaDocument | null = null;
  machine: StateMachineRuntime | null = null;
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private images = new Map<string, unknown>();
  private raf = 0;
  private last = 0;
  private time = 0;
  private hover: string | null = null;
  private view = { s: 1, x: 0, y: 0 };
  private visible = true;
  private dirty = true;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>:host{display:block;position:relative;contain:content}canvas{display:block;width:100%;height:100%;touch-action:manipulation}</style>`;
    root.appendChild(this.canvas);
    this.canvas.addEventListener("pointermove", (e) => this.onPointer(e, "move"));
    this.canvas.addEventListener("pointerdown", (e) => this.onPointer(e, "down"));
    this.canvas.addEventListener("pointerup", (e) => this.onPointer(e, "up"));
    this.canvas.addEventListener("pointerleave", () => this.leave());
    new ResizeObserver(() => (this.dirty = true)).observe(this);
    new IntersectionObserver(([e]) => (this.visible = !!e?.isIntersecting)).observe(this);
  }

  connectedCallback() {
    if (!this.style.aspectRatio && this.doc) this.style.aspectRatio = `${this.doc.width} / ${this.doc.height}`;
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
    const inline = this.querySelector('script[type="application/anima+json"]');
    if (inline && !this.doc) this.load(JSON.parse(inline.textContent || "{}"));
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.raf);
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === "src" && value) fetch(value).then((r) => r.json()).then((d) => this.load(d), (e) => console.error("anima-player:", e));
    if ((name === "state-machine" || name === "animation") && this.doc) this.reset();
    this.dirty = true;
  }

  /** Load a document object (what an .anima file contains). */
  load(doc: AnimaDocument) {
    this.doc = migrateDocument(doc);
    if (!this.style.aspectRatio) this.style.aspectRatio = `${doc.width} / ${doc.height}`;
    loadImages(this.doc, loadImage, this.images).then(() => (this.dirty = true));
    this.reset();
    this.dispatchEvent(new CustomEvent("load", { detail: { name: doc.name } }));
  }

  private reset() {
    const doc = this.doc!;
    const smName = this.getAttribute("state-machine");
    this.machine = doc.stateMachines?.length && smName !== "none" ? new StateMachineRuntime(doc, smName || undefined) : null;
    this.time = 0;
    this.dirty = true;
  }

  /** Set a bool or number input of the running state machine. */
  setInput(name: string, value: boolean | number) {
    this.machine?.setInput(name, value);
    this.dirty = true;
  }

  /** Fire a trigger input. */
  fire(name: string) {
    this.machine?.fire(name);
    this.dirty = true;
  }

  get state(): string | null {
    return this.machine?.current.state.name ?? null;
  }

  private layout() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.clientWidth, h = this.clientHeight || (this.clientWidth * this.doc!.height) / this.doc!.width;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const fit = this.getAttribute("fit") === "cover" ? Math.max : Math.min;
    const s = fit(w / this.doc!.width, h / this.doc!.height);
    this.view = { s, x: (w - this.doc!.width * s) / 2, y: (h - this.doc!.height * s) / 2 };
    return dpr;
  }

  private frame(): AnimaDocument {
    const doc = this.doc!;
    if (this.machine) return this.machine.evaluate();
    const anim = this.getAttribute("animation");
    return doc.animations.length ? evaluate(doc, this.time, anim || undefined) : doc;
  }

  private tick(now: number) {
    this.raf = requestAnimationFrame(this.tick);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.doc || !this.visible) return;
    const paused = this.hasAttribute("paused");
    let moving = false;
    if (!paused) {
      if (this.machine) moving = this.machine.advance(dt);
      else if (this.doc.animations.length) {
        this.time += dt;
        moving = true;
      }
    }
    // Idle state machines cost nothing: draw only when something changed.
    if (!moving && !this.dirty) return;
    this.dirty = false;
    const dpr = this.layout();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    renderDocument(ctx as unknown as Ctx2D, this.frame(), { scale: this.view.s * dpr, offsetX: this.view.x * dpr, offsetY: this.view.y * dpr, images: this.images, background: !this.hasAttribute("transparent") });
  }

  private toDoc(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.view.x) / this.view.s, y: (e.clientY - r.top - this.view.y) / this.view.s };
  }

  private onPointer(e: PointerEvent, kind: "move" | "down" | "up") {
    if (!this.machine || !this.doc) return;
    const p = this.toDoc(e);
    const current = this.machine.evaluate();
    const hit = hitTest(current, p.x, p.y);
    const interactive = this.machine.interactiveNodes();
    const chainHit = (id: string | null) => {
      let cur = id;
      while (cur) {
        if (interactive.has(cur)) return true;
        cur = current.nodes[cur]?.parent ?? null;
      }
      return false;
    };
    if (kind === "move") {
      if (hit !== this.hover) {
        if (this.hover) this.machine.pointer("leave", this.hover);
        if (hit) this.machine.pointer("enter", hit);
        this.hover = hit;
        this.dirty = true;
      }
      this.canvas.style.cursor = chainHit(hit) ? "pointer" : "";
      return;
    }
    if (!hit) return;
    this.machine.pointer(kind, hit);
    if (kind === "up") this.machine.pointer("click", hit);
    this.dirty = true;
    this.dispatchEvent(new CustomEvent("statechange", { detail: { state: this.state } }));
  }

  private leave() {
    if (this.machine && this.hover) this.machine.pointer("leave", this.hover);
    this.hover = null;
    this.dirty = true;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("anima-player")) customElements.define("anima-player", AnimaPlayer);
