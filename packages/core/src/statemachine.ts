import { localTime, sampleTrack } from "./animation.js";
import { clone } from "./doc.js";
import { getProp, interpolate, setProp } from "./props.js";
import type { AnimaDocument, Animation, SmCondition, SmListener, SmState, SmTransition, StateMachine } from "./types.js";

export function findStateMachine(doc: AnimaDocument, ref?: string | null): StateMachine {
  const sm = ref ? doc.stateMachines.find((s) => s.id === ref || s.name === ref) : doc.stateMachines[0];
  if (!sm) throw new Error(ref ? `State machine "${ref}" not found` : "Document has no state machine, run sm.new first");
  return sm;
}

export function findState(sm: StateMachine, ref: string): SmState {
  const st = sm.states.find((s) => s.id === ref || s.name === ref);
  if (!st) throw new Error(`State "${ref}" not found in "${sm.name}" (states: ${sm.states.map((s) => s.name).join(", ")})`);
  return st;
}

/** Apply an animation's tracks at time t onto `out`, blended towards the current values by `weight`. */
export function applyAnimation(out: AnimaDocument, anim: Animation, t: number, weight = 1): void {
  for (const track of anim.tracks) {
    const node = out.nodes[track.nodeId];
    if (!node) continue;
    const v = sampleTrack(track.keys, t);
    if (v === undefined) continue;
    try {
      setProp(node, track.prop, weight >= 1 ? clone(v) : interpolate(getProp(node, track.prop), v, weight));
    } catch {
      /* the property no longer exists on this node */
    }
  }
}

interface Playing {
  state: SmState;
  time: number; // seconds of the state's animation, already scaled by speed
}

/**
 * Runs a state machine: inputs drive transitions between states, each playing an animation.
 * Pure logic plus evaluate(); the player and the editor's preview mode drive it with real time
 * and pointer events, agents can drive it with sm.simulate.
 */
export class StateMachineRuntime {
  readonly sm: StateMachine;
  inputs = new Map<string, boolean | number>();
  private fired = new Set<string>();
  current: Playing;
  previous: Playing | null = null;
  private mixTime = 0;
  private mixDuration = 0;
  /** Names of states entered, oldest first (for agents and tests). */
  readonly history: string[] = [];

  constructor(
    readonly doc: AnimaDocument,
    ref?: string | null,
  ) {
    this.sm = findStateMachine(doc, ref);
    for (const i of this.sm.inputs) this.inputs.set(i.name, i.type === "trigger" ? false : i.value);
    const first = this.sm.states.find((s) => s.id === this.sm.initial) ?? this.sm.states[0];
    if (!first) throw new Error(`State machine "${this.sm.name}" has no states`);
    this.current = { state: first, time: 0 };
    this.history.push(first.name);
    this.settle();
  }

  private input(name: string) {
    const def = this.sm.inputs.find((i) => i.name === name);
    if (!def) throw new Error(`Unknown input "${name}" (inputs: ${this.sm.inputs.map((i) => i.name).join(", ") || "none"})`);
    return def;
  }

  setInput(name: string, value: boolean | number): void {
    const def = this.input(name);
    if (def.type === "trigger") return this.fire(name);
    this.inputs.set(name, def.type === "bool" ? Boolean(value) : Number(value));
    this.settle();
  }

  fire(name: string): void {
    const def = this.input(name);
    if (def.type !== "trigger") throw new Error(`"${name}" is a ${def.type} input; use setInput`);
    this.fired.add(name);
    this.settle();
  }

  private anim(state: SmState): Animation | null {
    return state.animation ? (this.doc.animations.find((a) => a.id === state.animation) ?? null) : null;
  }

  private progress(p: Playing): number {
    const a = this.anim(p.state);
    if (!a || a.duration <= 0) return 1;
    return p.time / a.duration;
  }

  private holds(c: SmCondition): boolean {
    const v = this.inputs.get(c.input);
    if (c.op === "fired") return this.fired.has(c.input);
    const want = c.value ?? true;
    switch (c.op) {
      case "==": return v === want;
      case "!=": return v !== want;
      case ">": return Number(v) > Number(want);
      case "<": return Number(v) < Number(want);
      case ">=": return Number(v) >= Number(want);
      case "<=": return Number(v) <= Number(want);
    }
  }

  private pick(): SmTransition | null {
    const cur = this.current.state.id;
    for (const t of this.sm.transitions) {
      if (t.from !== cur && !(t.from === "any" && t.to !== cur)) continue;
      if (t.exitTime !== null && this.progress(this.current) < t.exitTime) continue;
      // A transition with no conditions and no exit time would fire forever; require one of them.
      if (!t.conditions.length && t.exitTime === null) continue;
      if (t.conditions.every((c) => this.holds(c))) return t;
    }
    return null;
  }

  /** Take every transition that is ready now (bounded to avoid cycles), then consume triggers. */
  private settle(): void {
    for (let i = 0; i < 8; i++) {
      const t = this.pick();
      if (!t) break;
      const to = this.sm.states.find((s) => s.id === t.to);
      if (!to) break;
      this.previous = t.duration > 0 ? this.current : null;
      this.mixDuration = t.duration;
      this.mixTime = 0;
      this.current = { state: to, time: 0 };
      this.history.push(to.name);
    }
    this.fired.clear();
  }

  /** Advance by dt seconds. Returns true while something is still moving. */
  advance(dt: number): boolean {
    const step = (p: Playing) => (p.time += dt * (p.state.speed || 1));
    step(this.current);
    if (this.previous) {
      step(this.previous);
      this.mixTime += dt;
      if (this.mixTime >= this.mixDuration) this.previous = null;
    }
    this.settle();
    return !this.isSettled();
  }

  /** Nothing animates until an input changes: rest state, or a one-shot animation that has ended. */
  isSettled(): boolean {
    if (this.previous) return false;
    const a = this.anim(this.current.state);
    if (!a || !a.tracks.length) return true;
    return a.loop === "none" && this.current.time >= a.duration;
  }

  /** The document as it looks right now. */
  evaluate(): AnimaDocument {
    const pose = (p: Playing) => {
      const out = clone(this.doc);
      const a = this.anim(p.state);
      if (a) applyAnimation(out, a, localTime(a, p.time));
      return { out, a };
    };
    const cur = pose(this.current);
    if (!this.previous) return cur.out;
    // Crossfade: both poses start from the rest pose, so a state without animation blends back to it.
    const prev = pose(this.previous);
    const w = Math.min(1, this.mixTime / (this.mixDuration || 1));
    const touched = new Set([...(prev.a?.tracks ?? []), ...(cur.a?.tracks ?? [])].map((t) => `${t.nodeId}\u0000${t.prop}`));
    for (const key of touched) {
      const [nodeId, prop] = key.split("\u0000") as [string, string];
      const a = prev.out.nodes[nodeId], b = cur.out.nodes[nodeId];
      if (!a || !b) continue;
      try {
        setProp(b, prop, interpolate(getProp(a, prop), getProp(b, prop), w));
      } catch {
        /* property missing */
      }
    }
    return cur.out;
  }

  /** Feed a pointer event for a node (and its ancestors, so listeners on groups fire too). */
  pointer(event: SmListener["event"], nodeId: string | null): boolean {
    if (!nodeId) return false;
    const chain = new Set<string>();
    let cur: string | null = nodeId;
    while (cur) {
      chain.add(cur);
      cur = this.doc.nodes[cur]?.parent ?? null;
    }
    let hit = false;
    for (const l of this.sm.listeners) {
      if (l.event !== event || !chain.has(l.nodeId)) continue;
      hit = true;
      const def = this.sm.inputs.find((i) => i.name === l.input);
      if (!def) continue;
      if (l.action === "fire" || def.type === "trigger") this.fired.add(l.input);
      else if (l.action === "toggle") this.inputs.set(l.input, !this.inputs.get(l.input));
      else this.inputs.set(l.input, def.type === "bool" ? Boolean(l.value) : Number(l.value ?? 0));
    }
    if (hit) this.settle();
    return hit;
  }

  /** Node ids that have listeners (the player shows a pointer cursor over them). */
  interactiveNodes(): Set<string> {
    return new Set(this.sm.listeners.map((l) => l.nodeId));
  }
}
