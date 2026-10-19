import { z } from "zod";
import { evaluate, upsertKey } from "./animation.js";
import { clone, createDocument, defaultStroke, getAnimation, migrateDocument, getNode, insertNode, isAncestor, makeNode, nextId, removeNode, siblingsOf, walkNodes } from "./doc.js";
import { defineCommand, type CommandDef } from "./editor.js";
import { apply, invert, localMatrix, multiply, nodeBounds, worldMatrix, type Mat } from "./geometry.js";
import { exportLottie } from "./lottie.js";
import { ANIMATABLE_PROPS, getProp } from "./props.js";
import { exportSvg } from "./render.js";
import { ColorSchema, EaseSchema, NODE_TYPES, NodePatch, PathPointSchema } from "./schema.js";
import type { AnimaDocument, AnimaNode, GroupNode, Stroke } from "./types.js";

const Id = z.string().min(1);
const Time = z.number().finite().min(0);

const TRIM_FIELDS = ["trimStart", "trimEnd", "trimOffset"];
export const TYPE_FIELDS: Record<string, string[]> = {
  group: ["clip"],
  rect: ["width", "height", "cornerRadius", ...TRIM_FIELDS],
  ellipse: ["width", "height", ...TRIM_FIELDS],
  polygon: ["radius", "sides", ...TRIM_FIELDS],
  star: ["radius", "innerRadius", "points", ...TRIM_FIELDS],
  path: ["points", "closed", "subpaths", "fillRule", ...TRIM_FIELDS],
  text: ["text", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "align"],
  image: ["src", "width", "height"],
};

/** Apply a validated patch to a node, merging nested objects the way an agent expects. */
export function applyPatch(node: AnimaNode, patch: z.output<typeof NodePatch>): void {
  const allowed = new Set(["name", "visible", "locked", "opacity", "transform", "fill", "stroke", "blur", "shadow", ...TYPE_FIELDS[node.type]!]);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!allowed.has(key)) throw new Error(`"${key}" does not apply to a ${node.type} node (allowed: ${[...allowed].join(", ")})`);
    const n = node as unknown as Record<string, unknown>;
    if (key === "transform") Object.assign(node.transform, value);
    else if (key === "stroke") {
      if (value === null) node.stroke = null;
      else if (typeof value === "string") node.stroke = { ...(node.stroke ?? defaultStroke()), paint: { type: "solid", color: value } };
      else node.stroke = { ...(node.stroke ?? defaultStroke()), ...(value as Partial<Stroke>) };
    } else if (key === "shadow") {
      node.shadow = value === null ? null : { ...(node.shadow ?? { color: "#0a0a0b40", x: 0, y: 12, blur: 24 }), ...(value as object) };
    } else if (key === "points") {
      if (node.type === "star" && typeof value !== "number") throw new Error("star.points is the number of tips");
      if (node.type === "path" && !Array.isArray(value)) throw new Error("path.points is an array of {x,y,inX,inY,outX,outY}");
      n[key] = value;
    } else n[key] = value;
  }
}

function summary(doc: AnimaDocument) {
  const tree: unknown[] = [];
  walkNodes(doc, (n, depth) => {
    const b = nodeBounds(doc, n.id);
    tree.push({
      id: n.id,
      type: n.type,
      name: n.name,
      depth,
      parent: n.parent,
      visible: n.visible,
      bounds: b && { x: +b.x.toFixed(1), y: +b.y.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) },
    });
  });
  return {
    name: doc.name,
    width: doc.width,
    height: doc.height,
    fps: doc.fps,
    background: doc.background,
    nodes: tree,
    animations: doc.animations.map((a) => ({
      id: a.id,
      name: a.name,
      duration: a.duration,
      loop: a.loop,
      active: a.id === doc.activeAnimation,
      tracks: a.tracks.map((t) => ({ nodeId: t.nodeId, prop: t.prop, keys: t.keys.length, times: t.keys.map((k) => k.time) })),
    })),
  };
}

function reorderIn(list: string[], id: string, to: number): void {
  const from = list.indexOf(id);
  list.splice(from, 1);
  list.splice(Math.max(0, Math.min(to, list.length)), 0, id);
}

/** Deep-copy a subtree with fresh ids. Returns the old -> new id map. */
function copySubtree(doc: AnimaDocument, id: string, parent: string | null, index?: number): Map<string, string> {
  const map = new Map<string, string>();
  const copy = (srcId: string, par: string | null, idx?: number) => {
    const src = getNode(doc, srcId);
    const n = clone(src);
    n.id = nextId(doc, "n");
    map.set(srcId, n.id);
    if (n.type === "group") n.children = [];
    insertNode(doc, n, par, idx);
    if (src.type === "group") for (const c of src.children) copy(c, n.id);
  };
  copy(id, parent, index);
  for (const a of doc.animations) {
    const extra = a.tracks.filter((t) => map.has(t.nodeId)).map((t) => ({ ...clone(t), nodeId: map.get(t.nodeId)! }));
    a.tracks.push(...extra);
  }
  return map;
}

const DocProps = z.strictObject({
  name: z.string().optional(),
  width: z.number().int().min(1).max(16384).optional(),
  height: z.number().int().min(1).max(16384).optional(),
  background: ColorSchema.optional(),
  fps: z.number().int().min(1).max(240).optional(),
});

export const coreCommands: CommandDef[] = [
  // ---------- document ----------
  defineCommand({
    id: "doc.new",
    title: "New document",
    description: "Replace the current document with an empty one. Clears undo history.",
    params: DocProps,
    mutates: false,
    run: ({ editor }, p) => {
      editor.load(createDocument(p));
      return summary(editor.doc);
    },
  }),
  defineCommand({
    id: "doc.load",
    title: "Load document",
    description: "Replace the current document with a full RaveAnima JSON document (as returned by doc.json).",
    params: z.object({ document: z.record(z.string(), z.unknown()) }),
    mutates: false,
    run: ({ editor }, p) => {
      const d = p.document as unknown as AnimaDocument;
      if (d.format !== "anima" || d.version !== 1) throw new Error('Not a RaveAnima v1 document (expected format:"anima", version:1)');
      editor.load(migrateDocument(clone(d)));
      return summary(editor.doc);
    },
  }),
  defineCommand({
    id: "doc.setProps",
    title: "Document settings",
    description: "Change document name, artboard size, background colour or frame rate.",
    params: DocProps,
    mutates: true,
    run: ({ doc }, p) => {
      Object.assign(doc, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
      return summary(doc);
    },
  }),
  defineCommand({
    id: "doc.inspect",
    title: "Inspect document",
    description: "Compact overview: artboard, node tree with world bounds, animations and their tracks.",
    params: z.object({}),
    mutates: false,
    run: ({ doc }) => summary(doc),
  }),
  defineCommand({
    id: "doc.json",
    title: "Document JSON",
    description: "The full document as RaveAnima JSON (what .anima files contain).",
    params: z.object({}),
    mutates: false,
    run: ({ doc }) => clone(doc),
  }),

  // ---------- nodes ----------
  defineCommand({
    id: "node.add",
    title: "Add shape",
    description:
      'Add a node: group, rect, ellipse, polygon, star or path. Shapes are centred on transform.x/y. props example: {"width":200,"height":120,"cornerRadius":16,"fill":"#FF3B2E","transform":{"x":540,"y":540}}. Path props: {"points":[{"x":0,"y":0,"outX":40,"outY":0},...],"closed":false,"stroke":{"width":4}}.',
    params: z.object({
      type: z.enum(NODE_TYPES),
      props: NodePatch.default({}),
      parent: Id.nullable().optional(),
      index: z.number().int().min(0).optional(),
      select: z.boolean().default(true),
    }),
    mutates: true,
    run: ({ doc, editor }, p) => {
      const node = makeNode(doc, p.type);
      applyPatch(node, p.props);
      insertNode(doc, node, p.parent ?? null, p.index);
      if (p.select) editor.state.selection = [node.id];
      return { id: node.id, node };
    },
  }),
  defineCommand({
    id: "node.update",
    title: "Edit node",
    description:
      'Change node properties; nested objects merge (transform, stroke). fill accepts a colour string, a paint object or null. Example: {"id":"n3","props":{"opacity":0.5,"transform":{"rotation":45}}}. Edits the rest pose; use keyframe.set to animate.',
    params: z.object({ id: Id, props: NodePatch }),
    mutates: true,
    run: ({ doc }, p) => {
      const n = getNode(doc, p.id);
      applyPatch(n, p.props);
      return { id: n.id, node: n };
    },
  }),
  defineCommand({
    id: "node.updateMany",
    title: "Edit nodes",
    description: "Apply the same property patch to several nodes in one undo step.",
    params: z.object({ ids: z.array(Id).min(1), props: NodePatch }),
    mutates: true,
    run: ({ doc }, p) => {
      for (const id of p.ids) applyPatch(getNode(doc, id), p.props);
      return { ids: p.ids };
    },
  }),
  defineCommand({
    id: "node.get",
    title: "Get node",
    description: "Full node JSON plus its world bounds and world matrix.",
    params: z.object({ id: Id }),
    mutates: false,
    run: ({ doc }, p) => ({ node: getNode(doc, p.id), bounds: nodeBounds(doc, p.id), worldMatrix: worldMatrix(doc, p.id) }),
  }),
  defineCommand({
    id: "node.delete",
    title: "Delete",
    description: "Delete nodes (with their children and animation tracks).",
    params: z.object({ ids: z.array(Id).min(1) }),
    mutates: true,
    run: ({ doc }, p) => {
      for (const id of p.ids) if (doc.nodes[id]) removeNode(doc, id);
      return { deleted: p.ids };
    },
  }),
  defineCommand({
    id: "node.duplicate",
    title: "Duplicate",
    description: "Copy nodes (and their animation tracks) right above the originals, optionally offset.",
    params: z.object({ ids: z.array(Id).min(1), offsetX: z.number().default(20), offsetY: z.number().default(20) }),
    mutates: true,
    run: ({ doc, editor }, p) => {
      const created: string[] = [];
      for (const id of p.ids) {
        const src = getNode(doc, id);
        const list = siblingsOf(doc, src);
        const newId = copySubtree(doc, id, src.parent, list.indexOf(id) + 1).get(id)!;
        const n = getNode(doc, newId);
        n.transform.x += p.offsetX;
        n.transform.y += p.offsetY;
        n.name = `${src.name} copy`;
        created.push(newId);
      }
      editor.state.selection = created;
      return { ids: created };
    },
  }),
  defineCommand({
    id: "node.reorder",
    title: "Arrange",
    description: "Move a node in its stacking order: up, down, top, bottom, or an explicit index (0 = bottom).",
    params: z.object({ id: Id, to: z.union([z.enum(["up", "down", "top", "bottom"]), z.number().int().min(0)]) }),
    mutates: true,
    run: ({ doc }, p) => {
      const list = siblingsOf(doc, getNode(doc, p.id));
      const i = list.indexOf(p.id);
      const to = p.to === "up" ? i + 1 : p.to === "down" ? i - 1 : p.to === "top" ? list.length - 1 : p.to === "bottom" ? 0 : p.to;
      reorderIn(list, p.id, to);
      return { index: list.indexOf(p.id) };
    },
  }),
  defineCommand({
    id: "node.reparent",
    title: "Move into group",
    description: "Move a node into a group (or to the root with parent null), keeping its position on screen.",
    params: z.object({ id: Id, parent: Id.nullable(), index: z.number().int().min(0).optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const n = getNode(doc, p.id);
      if (p.parent === p.id || (p.parent && isAncestor(doc, p.id, p.parent))) throw new Error("Cannot move a node into itself");
      const world = worldMatrix(doc, p.id);
      const list = siblingsOf(doc, n);
      list.splice(list.indexOf(p.id), 1);
      insertNode(doc, n, p.parent, p.index);
      keepWorld(doc, n, world);
      return { id: n.id, parent: n.parent };
    },
  }),
  defineCommand({
    id: "node.group",
    title: "Group",
    description: "Wrap nodes (siblings or not) in a new group placed where the topmost one was.",
    params: z.object({ ids: z.array(Id).min(1), name: z.string().optional() }),
    mutates: true,
    run: ({ doc, editor }, p) => {
      const first = getNode(doc, p.ids[p.ids.length - 1]!);
      const list = siblingsOf(doc, first);
      const g = makeNode(doc, "group", p.name ? { name: p.name } : {}) as GroupNode;
      insertNode(doc, g, first.parent, list.indexOf(first.id) + 1);
      const ordered: string[] = [];
      walkNodes(doc, (n) => p.ids.includes(n.id) && ordered.push(n.id));
      for (const id of ordered) {
        const n = getNode(doc, id);
        const world = worldMatrix(doc, id);
        const sib = siblingsOf(doc, n);
        sib.splice(sib.indexOf(id), 1);
        insertNode(doc, n, g.id);
        keepWorld(doc, n, world);
      }
      editor.state.selection = [g.id];
      return { id: g.id };
    },
  }),
  defineCommand({
    id: "node.ungroup",
    title: "Ungroup",
    description: "Dissolve a group, keeping its children where they are on screen.",
    params: z.object({ id: Id }),
    mutates: true,
    run: ({ doc, editor }, p) => {
      const g = getNode(doc, p.id);
      if (g.type !== "group") throw new Error(`"${p.id}" is not a group`);
      const list = siblingsOf(doc, g);
      let at = list.indexOf(g.id);
      const kids = [...g.children];
      for (const id of kids) {
        const n = getNode(doc, id);
        const world = worldMatrix(doc, id);
        g.children.splice(g.children.indexOf(id), 1);
        insertNode(doc, n, g.parent, ++at);
        keepWorld(doc, n, world);
        n.opacity *= g.opacity;
      }
      removeNode(doc, g.id);
      editor.state.selection = kids;
      return { ids: kids };
    },
  }),

  // ---------- selection & playhead (view state, no undo) ----------
  defineCommand({
    id: "select.set",
    title: "Select",
    description: "Set the selection to these node ids (empty array clears it).",
    params: z.object({ ids: z.array(Id) }),
    mutates: false,
    run: ({ doc, editor }, p) => {
      editor.state.selection = p.ids.filter((id) => id in doc.nodes);
      return { selection: editor.state.selection };
    },
  }),
  defineCommand({
    id: "time.set",
    title: "Move playhead",
    description: "Move the timeline playhead (seconds).",
    params: z.object({ time: Time }),
    mutates: false,
    run: ({ editor }, p) => {
      editor.state.time = p.time;
      return { time: p.time };
    },
  }),

  // ---------- animations ----------
  defineCommand({
    id: "anim.new",
    title: "New animation",
    description: "Create a timeline (animation clip) and make it active. loop: none, loop or pingpong.",
    params: z.object({ name: z.string().default("Animation"), duration: z.number().positive().default(2), loop: z.enum(["none", "loop", "pingpong"]).default("loop") }),
    mutates: true,
    run: ({ doc }, p) => {
      const a = { id: nextId(doc, "a"), name: p.name, duration: p.duration, loop: p.loop, tracks: [] };
      doc.animations.push(a);
      doc.activeAnimation = a.id;
      return { id: a.id };
    },
  }),
  defineCommand({
    id: "anim.update",
    title: "Animation settings",
    description: "Rename an animation or change its duration / loop mode.",
    params: z.object({ id: Id.optional(), name: z.string().optional(), duration: z.number().positive().optional(), loop: z.enum(["none", "loop", "pingpong"]).optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const a = getAnimation(doc, p.id);
      if (p.name !== undefined) a.name = p.name;
      if (p.duration !== undefined) a.duration = p.duration;
      if (p.loop !== undefined) a.loop = p.loop;
      return { id: a.id };
    },
  }),
  defineCommand({
    id: "anim.delete",
    title: "Delete animation",
    description: "Delete an animation clip.",
    params: z.object({ id: Id }),
    mutates: true,
    run: ({ doc }, p) => {
      const a = getAnimation(doc, p.id);
      doc.animations = doc.animations.filter((x) => x !== a);
      for (const sm of doc.stateMachines) for (const st of sm.states) if (st.animation === a.id) st.animation = null;
      if (doc.activeAnimation === a.id) doc.activeAnimation = doc.animations[0]?.id ?? null;
      return { deleted: a.id };
    },
  }),
  defineCommand({
    id: "anim.select",
    title: "Switch animation",
    description: "Make an animation the active one (by id or name).",
    params: z.object({ id: Id }),
    mutates: true,
    run: ({ doc }, p) => {
      doc.activeAnimation = getAnimation(doc, p.id).id;
      return { active: doc.activeAnimation };
    },
  }),
  defineCommand({
    id: "keyframe.set",
    title: "Set keyframe",
    description: `Add or replace a keyframe. value defaults to the node's current rest value. Common props: ${ANIMATABLE_PROPS.join(", ")}; any numeric or colour path works (e.g. fill.stops.0.color). ease controls the curve to the next key. Example: {"nodeId":"n1","prop":"transform.x","time":1,"value":800,"ease":"easeInOut"}.`,
    params: z.object({ nodeId: Id, prop: z.string().min(1), time: Time, value: z.unknown().optional(), ease: EaseSchema.default("easeInOut"), animation: Id.optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const node = getNode(doc, p.nodeId);
      const anim = getAnimation(doc, p.animation);
      const current = getProp(node, p.prop);
      if (current === undefined) throw new Error(`${node.type} node has no property "${p.prop}"`);
      let value = p.value === undefined ? clone(current) : p.value;
      if (typeof current === "number" && typeof value !== "number") throw new Error(`"${p.prop}" needs a number`);
      if (typeof current === "string" && typeof value !== "string") throw new Error(`"${p.prop}" needs a colour string`);
      if (p.prop === "points" && node.type === "path") value = z.array(PathPointSchema).parse(value);
      let track = anim.tracks.find((t) => t.nodeId === p.nodeId && t.prop === p.prop);
      if (!track) {
        track = { nodeId: p.nodeId, prop: p.prop, keys: [] };
        anim.tracks.push(track);
      }
      upsertKey(track, { time: p.time, value, ease: p.ease });
      if (p.time > anim.duration) anim.duration = p.time;
      return { animation: anim.id, keys: track.keys.length };
    },
  }),
  defineCommand({
    id: "keyframe.delete",
    title: "Delete keyframe",
    description: "Remove the keyframe at this time (removes the track when it becomes empty).",
    params: z.object({ nodeId: Id, prop: z.string(), time: Time, animation: Id.optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const anim = getAnimation(doc, p.animation);
      const track = anim.tracks.find((t) => t.nodeId === p.nodeId && t.prop === p.prop);
      if (!track) throw new Error(`No track ${p.nodeId}.${p.prop}`);
      const before = track.keys.length;
      track.keys = track.keys.filter((k) => Math.abs(k.time - p.time) > 1e-6);
      if (track.keys.length === before) throw new Error(`No keyframe at ${p.time}s on ${p.nodeId}.${p.prop}`);
      if (track.keys.length === 0) anim.tracks = anim.tracks.filter((t) => t !== track);
      return { keys: track.keys.length };
    },
  }),
  defineCommand({
    id: "keyframe.setEase",
    title: "Set easing",
    description: "Change the easing of a keyframe (curve towards the next key).",
    params: z.object({ nodeId: Id, prop: z.string(), time: Time, ease: EaseSchema, animation: Id.optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const track = getAnimation(doc, p.animation).tracks.find((t) => t.nodeId === p.nodeId && t.prop === p.prop);
      const key = track?.keys.find((k) => Math.abs(k.time - p.time) < 1e-6);
      if (!key) throw new Error(`No keyframe at ${p.time}s on ${p.nodeId}.${p.prop}`);
      key.ease = p.ease;
      return { ok: true };
    },
  }),
  defineCommand({
    id: "keyframe.move",
    title: "Move keyframe",
    description: "Move a keyframe to another time.",
    params: z.object({ nodeId: Id, prop: z.string(), time: Time, to: Time, animation: Id.optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const anim = getAnimation(doc, p.animation);
      const track = anim.tracks.find((t) => t.nodeId === p.nodeId && t.prop === p.prop);
      const key = track?.keys.find((k) => Math.abs(k.time - p.time) < 1e-6);
      if (!track || !key) throw new Error(`No keyframe at ${p.time}s on ${p.nodeId}.${p.prop}`);
      track.keys = track.keys.filter((k) => k !== key);
      upsertKey(track, { ...key, time: p.to });
      if (p.to > anim.duration) anim.duration = p.to;
      return { ok: true };
    },
  }),
  defineCommand({
    id: "track.delete",
    title: "Delete track",
    description: "Remove all keyframes of one property.",
    params: z.object({ nodeId: Id, prop: z.string(), animation: Id.optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const anim = getAnimation(doc, p.animation);
      anim.tracks = anim.tracks.filter((t) => !(t.nodeId === p.nodeId && t.prop === p.prop));
      return { ok: true };
    },
  }),
  defineCommand({
    id: "anim.evaluate",
    title: "Evaluate animation",
    description: "Animated property values at a time: one node (nodeId) or every animated track.",
    params: z.object({ time: z.number().finite(), nodeId: Id.optional(), animation: Id.optional() }),
    mutates: false,
    run: ({ doc }, p) => {
      const d = evaluate(doc, p.time, p.animation);
      if (p.nodeId) return { node: getNode(d, p.nodeId), bounds: nodeBounds(d, p.nodeId) };
      const anim = getAnimation(doc, p.animation);
      return {
        time: p.time,
        values: anim.tracks.map((t) => ({ nodeId: t.nodeId, prop: t.prop, value: getProp(d.nodes[t.nodeId], t.prop) })),
      };
    },
  }),

  // ---------- history ----------
  defineCommand({
    id: "history.undo",
    title: "Undo",
    description: "Undo the last change.",
    params: z.object({}),
    mutates: false,
    run: ({ editor }) => ({ undone: editor.undo(), history: editor.history() }),
  }),
  defineCommand({
    id: "history.redo",
    title: "Redo",
    description: "Redo the last undone change.",
    params: z.object({}),
    mutates: false,
    run: ({ editor }) => ({ redone: editor.redo(), history: editor.history() }),
  }),
  defineCommand({
    id: "history.list",
    title: "History",
    description: "Labels of the undo and redo stacks.",
    params: z.object({}),
    mutates: false,
    run: ({ editor }) => editor.history(),
  }),

  // ---------- export (pure, returns data) ----------
  defineCommand({
    id: "export.svg",
    title: "Export SVG",
    description: "Static SVG markup of the frame at `time` seconds.",
    params: z.object({ time: z.number().finite().default(0), animation: Id.optional() }),
    mutates: false,
    run: ({ doc }, p) => ({ svg: exportSvg(doc, p.time, p.animation) }),
  }),
  defineCommand({
    id: "export.lottie",
    title: "Export Lottie",
    description: "Lottie (Bodymovin) JSON of an animation, playable by lottie-web, lottie-ios, lottie-android and Skottie.",
    params: z.object({ animation: Id.optional() }),
    mutates: false,
    run: ({ doc }, p) => {
      const warnings: string[] = [];
      const lottie = exportLottie(doc, p.animation, warnings);
      return { lottie, warnings: [...new Set(warnings)] };
    },
  }),
];

/** After reparenting, rewrite a node's local transform so its world placement is unchanged. */
function keepWorld(doc: AnimaDocument, node: AnimaNode, world: Mat): void {
  const parentWorld: Mat = node.parent ? worldMatrix(doc, node.parent) : [1, 0, 0, 1, 0, 0];
  const local = multiply(invert(parentWorld), world);
  const t = node.transform;
  const sx = Math.hypot(local[0], local[1]);
  const det = local[0] * local[3] - local[1] * local[2];
  const sy = det / (sx || 1);
  const rotation = (Math.atan2(local[1], local[0]) * 180) / Math.PI;
  // Solve the translation so that origin stays the pivot.
  const probe = localMatrix({ ...t, x: 0, y: 0, rotation, scaleX: sx, scaleY: sy });
  const o = apply(local, 0, 0);
  t.rotation = +rotation.toFixed(6);
  t.scaleX = +sx.toFixed(6);
  t.scaleY = +sy.toFixed(6);
  t.x = o.x - probe[4];
  t.y = o.y - probe[5];
}
