// Anima document model. Plain JSON: easy for humans, the UI and AI agents to read, diff and edit.

export type Color = string; // "#rrggbb" or "#rrggbbaa"

export interface Vec {
  x: number;
  y: number;
}

export interface GradientStop {
  offset: number; // 0..1
  color: Color;
}

export type Paint =
  | { type: "none" }
  | { type: "solid"; color: Color }
  | { type: "linear"; from: Vec; to: Vec; stops: GradientStop[] }
  | { type: "radial"; center: Vec; radius: number; stops: GradientStop[] };

export interface Stroke {
  paint: Paint;
  width: number;
  join: "miter" | "round" | "bevel";
  cap: "butt" | "round" | "square";
}

/** Local -> parent: translate(x, y) · rotate · scale · translate(-originX, -originY). */
export interface Transform {
  x: number;
  y: number;
  rotation: number; // degrees, clockwise
  scaleX: number;
  scaleY: number;
  originX: number; // pivot in local coordinates
  originY: number;
}

/** A cubic Bézier vertex; handles are relative to the point (the Lottie convention). */
export interface PathPoint {
  x: number;
  y: number;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
}

export interface Shadow {
  color: Color;
  x: number;
  y: number;
  blur: number;
}

interface NodeBase {
  id: string;
  name: string;
  parent: string | null;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  transform: Transform;
  fill: Paint;
  stroke: Stroke | null;
  /** Gaussian blur radius in document px (0 = off). */
  blur: number;
  shadow: Shadow | null;
}

/** Trim path: draw only part of the outline (0..1 along its length), like Lottie "tm". */
interface Trimmable {
  trimStart: number;
  trimEnd: number;
  trimOffset: number; // shifts the window along the path, wraps around
}

export interface GroupNode extends NodeBase {
  type: "group";
  children: string[]; // bottom -> top
  /** When true the bottom child is a mask: it is not drawn and clips the other children. */
  clip: boolean;
}

/** Geometry of primitive shapes is centred on the local origin. */
export interface RectNode extends NodeBase, Trimmable {
  type: "rect";
  width: number;
  height: number;
  cornerRadius: number;
}

export interface EllipseNode extends NodeBase, Trimmable {
  type: "ellipse";
  width: number;
  height: number;
}

export interface PolygonNode extends NodeBase, Trimmable {
  type: "polygon";
  radius: number;
  sides: number;
}

export interface StarNode extends NodeBase, Trimmable {
  type: "star";
  radius: number;
  innerRadius: number;
  points: number;
}

export interface PathNode extends NodeBase, Trimmable {
  type: "path";
  points: PathPoint[];
  closed: boolean;
  /** Extra contours drawn as part of the same shape (holes, compound paths). Not morphed. */
  subpaths: Contour[];
  fillRule: "nonzero" | "evenodd";
}

export interface Contour {
  points: PathPoint[];
  closed: boolean;
}

/** Text centred on the local origin. Lines split on "\n". */
export interface TextNode extends NodeBase {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number; // multiple of fontSize
  letterSpacing: number; // px
  align: "left" | "center" | "right";
}

/** Raster image centred on the local origin. src is a data: URL, http(s) URL or file path. */
export interface ImageNode extends NodeBase {
  type: "image";
  src: string;
  width: number;
  height: number;
}

export type ShapeNode = RectNode | EllipseNode | PolygonNode | StarNode | PathNode;
export type AnimaNode = GroupNode | ShapeNode | TextNode | ImageNode;
export type NodeType = AnimaNode["type"];

export type EasePreset =
  | "linear"
  | "hold"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "backIn"
  | "backOut"
  | "backInOut";

/** Preset name or a CSS-style cubic-bezier(x1, y1, x2, y2). */
export type Ease = EasePreset | { cubic: [number, number, number, number] };

export interface Keyframe {
  time: number; // seconds
  value: unknown;
  ease: Ease; // easing from this key to the next one
}

export interface Track {
  nodeId: string;
  prop: string; // e.g. "transform.x", "opacity", "fill.color", "points"
  keys: Keyframe[]; // sorted by time
}

export interface Animation {
  id: string;
  name: string;
  duration: number; // seconds
  loop: "none" | "loop" | "pingpong";
  tracks: Track[];
}

// ---------- state machines (interactivity) ----------

export type SmInputType = "bool" | "number" | "trigger";

export interface SmInput {
  name: string;
  type: SmInputType;
  value: boolean | number; // default; triggers are false
}

export interface SmCondition {
  input: string;
  /** For triggers only "fired" applies. */
  op: "==" | "!=" | ">" | "<" | ">=" | "<=" | "fired";
  value?: boolean | number;
}

export interface SmState {
  id: string;
  name: string;
  /** Animation played in this state, or null for the rest pose. */
  animation: string | null;
  /** Playback speed multiplier. */
  speed: number;
}

export interface SmTransition {
  id: string;
  from: string; // state id or "any"
  to: string;
  /** All must hold. Empty = leave as soon as allowed by exitTime. */
  conditions: SmCondition[];
  /** Crossfade length in seconds. */
  duration: number;
  /** Fraction (0..1) of the source animation that must have played first; null = immediately. */
  exitTime: number | null;
}

export interface SmListener {
  id: string;
  nodeId: string;
  event: "click" | "down" | "up" | "enter" | "leave";
  input: string;
  /** set: write value; toggle: flip a bool; fire: trigger. */
  action: "set" | "toggle" | "fire";
  value?: boolean | number;
}

export interface StateMachine {
  id: string;
  name: string;
  inputs: SmInput[];
  states: SmState[];
  initial: string;
  transitions: SmTransition[];
  listeners: SmListener[];
}

export interface AnimaDocument {
  format: "anima";
  version: 1;
  name: string;
  width: number;
  height: number;
  background: Color;
  fps: number;
  seq: number; // id counter: ids are short and stable ("n1", "a1") for agents
  nodes: Record<string, AnimaNode>;
  root: string[]; // bottom -> top
  animations: Animation[];
  activeAnimation: string | null;
  stateMachines: StateMachine[];
}
