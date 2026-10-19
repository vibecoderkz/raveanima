import type { AnimaDocument, AnimaNode, Animation, GroupNode, NodeType, Paint, Stroke, Transform } from "./types.js";

export function createDocument(opts: Partial<Pick<AnimaDocument, "name" | "width" | "height" | "background" | "fps">> = {}): AnimaDocument {
  return {
    format: "anima",
    version: 1,
    name: opts.name ?? "Untitled",
    width: opts.width ?? 1080,
    height: opts.height ?? 1080,
    background: opts.background ?? "#ffffff",
    fps: opts.fps ?? 60,
    seq: 0,
    nodes: {},
    root: [],
    animations: [],
    activeAnimation: null,
    stateMachines: [],
  };
}

export function defaultTransform(t: Partial<Transform> = {}): Transform {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, originX: 0, originY: 0, ...t };
}

export function solid(color: string): Paint {
  return { type: "solid", color };
}

export function defaultStroke(s: Partial<Stroke> = {}): Stroke {
  return { paint: solid("#0a0a0b"), width: 2, join: "round", cap: "round", ...s };
}

export function nextId(doc: AnimaDocument, prefix: "n" | "a" | "s" | "st" | "t" | "l"): string {
  doc.seq += 1;
  return `${prefix}${doc.seq}`;
}

const TRIM = { trimStart: 0, trimEnd: 1, trimOffset: 0 };

/** Type-specific fields with their defaults. Also used to migrate older documents. */
export const TYPE_DEFAULTS: Record<NodeType, Record<string, unknown>> = {
  group: { children: [], clip: false },
  rect: { width: 200, height: 200, cornerRadius: 0, ...TRIM },
  ellipse: { width: 200, height: 200, ...TRIM },
  polygon: { radius: 100, sides: 6, ...TRIM },
  star: { radius: 100, innerRadius: 50, points: 5, ...TRIM },
  path: { points: [], closed: true, subpaths: [], fillRule: "nonzero", ...TRIM },
  text: { text: "Text", fontFamily: "SF Pro Display", fontSize: 64, fontWeight: 600, lineHeight: 1.2, letterSpacing: 0, align: "center" },
  image: { src: "", width: 400, height: 300 },
};

const BASE_DEFAULTS = { visible: true, locked: false, opacity: 1, blur: 0, shadow: null };

/** Build a node with every field filled in. `props` may override anything except id/type. */
export function makeNode(doc: AnimaDocument, type: NodeType, props: Record<string, unknown> = {}): AnimaNode {
  const id = nextId(doc, "n");
  const { transform, ...rest } = props as { transform?: Partial<Transform> };
  const base = {
    id,
    name: `${type[0]!.toUpperCase()}${type.slice(1)} ${doc.seq}`,
    parent: null,
    ...BASE_DEFAULTS,
    transform: defaultTransform(transform),
    fill: type === "group" || type === "path" || type === "image" ? ({ type: "none" } as Paint) : type === "text" ? solid("#0a0a0b") : solid("#FF3B2E"),
    stroke: type === "path" ? defaultStroke() : null,
  };
  return { ...base, type, ...structuredClone(TYPE_DEFAULTS[type]), ...rest, id } as AnimaNode;
}

/** Fill in fields added in later versions so old files open and every prop is animatable. */
export function migrateDocument(doc: AnimaDocument): AnimaDocument {
  doc.stateMachines ??= [];
  for (const n of Object.values(doc.nodes)) {
    const rec = n as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries({ ...BASE_DEFAULTS, ...TYPE_DEFAULTS[n.type] })) if (!(k in rec)) rec[k] = structuredClone(v);
  }
  return doc;
}

export function getNode(doc: AnimaDocument, id: string): AnimaNode {
  const n = doc.nodes[id];
  if (!n) throw new Error(`Node "${id}" not found`);
  return n;
}

/** The id list that holds a node: its parent's children or the document root. */
export function siblingsOf(doc: AnimaDocument, node: AnimaNode): string[] {
  if (node.parent === null) return doc.root;
  return (getNode(doc, node.parent) as GroupNode).children;
}

export function insertNode(doc: AnimaDocument, node: AnimaNode, parent: string | null = null, index?: number): void {
  if (parent !== null) {
    const p = getNode(doc, parent);
    if (p.type !== "group") throw new Error(`Parent "${parent}" is a ${p.type}, only groups can hold children`);
  }
  node.parent = parent;
  doc.nodes[node.id] = node;
  const list = siblingsOf(doc, node);
  list.splice(index ?? list.length, 0, node.id);
}

/** Removes a node, its subtree and every animation track that targets them. */
export function removeNode(doc: AnimaDocument, id: string): void {
  const node = getNode(doc, id);
  const list = siblingsOf(doc, node);
  list.splice(list.indexOf(id), 1);
  const gone = new Set<string>();
  const walk = (nid: string) => {
    gone.add(nid);
    const n = doc.nodes[nid];
    if (n?.type === "group") n.children.forEach(walk);
    delete doc.nodes[nid];
  };
  walk(id);
  for (const a of doc.animations) a.tracks = a.tracks.filter((t) => !gone.has(t.nodeId));
  for (const sm of doc.stateMachines ?? []) sm.listeners = sm.listeners.filter((l) => !gone.has(l.nodeId));
}

export function isAncestor(doc: AnimaDocument, ancestor: string, id: string): boolean {
  let cur = doc.nodes[id]?.parent ?? null;
  while (cur !== null) {
    if (cur === ancestor) return true;
    cur = doc.nodes[cur]?.parent ?? null;
  }
  return false;
}

/** Depth-first, bottom to top: the order the renderer paints in. */
export function walkNodes(doc: AnimaDocument, fn: (node: AnimaNode, depth: number) => void): void {
  const visit = (ids: string[], depth: number) => {
    for (const id of ids) {
      const n = doc.nodes[id];
      if (!n) continue;
      fn(n, depth);
      if (n.type === "group") visit(n.children, depth + 1);
    }
  };
  visit(doc.root, 0);
}

export function getAnimation(doc: AnimaDocument, id?: string | null): Animation {
  const aid = id ?? doc.activeAnimation;
  const a = doc.animations.find((x) => x.id === aid || x.name === aid);
  if (!a) throw new Error(aid ? `Animation "${aid}" not found` : "Document has no active animation, run anim.new first");
  return a;
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}
