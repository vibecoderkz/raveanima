import { clone, getAnimation } from "./doc.js";
import { applyEase } from "./easing.js";
import { interpolate, setProp } from "./props.js";
import type { AnimaDocument, Animation, Keyframe, Track } from "./types.js";

/** Map wall time to animation-local time according to the loop mode. */
export function localTime(anim: Animation, t: number): number {
  const d = anim.duration;
  if (d <= 0) return 0;
  if (anim.loop === "none") return Math.min(Math.max(t, 0), d);
  // Inside the first cycle return t untouched: modulo arithmetic drifts (0.7 -> 0.7000000000000002).
  if (t >= 0 && t < d) return t;
  if (anim.loop === "loop") return ((t % d) + d) % d;
  const cycle = ((t % (2 * d)) + 2 * d) % (2 * d);
  return cycle <= d ? cycle : 2 * d - cycle;
}

export function sampleTrack(keys: Keyframe[], t: number): unknown {
  if (keys.length === 0) return undefined;
  const first = keys[0]!;
  if (t <= first.time) return first.value;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t < b.time) {
      const span = b.time - a.time;
      const p = span <= 0 ? 1 : (t - a.time) / span;
      return interpolate(a.value, b.value, applyEase(a.ease, p));
    }
  }
  return keys[keys.length - 1]!.value;
}

/**
 * A copy of the document with every track of the animation applied at time `t` (seconds).
 * The source document is never mutated, so the editor keeps the authored "rest pose".
 */
export function evaluate(doc: AnimaDocument, t: number, animId?: string | null): AnimaDocument {
  const out = clone(doc);
  if (doc.animations.length === 0 || (animId === undefined && !doc.activeAnimation)) return out;
  const anim = getAnimation(doc, animId);
  const lt = localTime(anim, t);
  for (const track of anim.tracks) applyTrack(out, track, lt);
  return out;
}

function applyTrack(doc: AnimaDocument, track: Track, t: number): void {
  const node = doc.nodes[track.nodeId];
  if (!node) return;
  const v = sampleTrack(track.keys, t);
  if (v === undefined) return;
  try {
    setProp(node, track.prop, clone(v));
  } catch {
    // A track can outlive the property it targets (e.g. fill switched from solid to none): skip it.
  }
}

export function upsertKey(track: Track, key: Keyframe): void {
  const i = track.keys.findIndex((k) => Math.abs(k.time - key.time) < 1e-6);
  if (i >= 0) track.keys[i] = key;
  else {
    track.keys.push(key);
    track.keys.sort((a, b) => a.time - b.time);
  }
}
