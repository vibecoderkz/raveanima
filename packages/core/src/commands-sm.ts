import { z } from "zod";
import { getAnimation, getNode, nextId } from "./doc.js";
import { defineCommand, type CommandDef } from "./editor.js";
import { findState, findStateMachine, StateMachineRuntime } from "./statemachine.js";
import type { StateMachine } from "./types.js";

const Ref = z.string().min(1);
const Value = z.union([z.boolean(), z.number()]);
const Condition = z.object({
  input: z.string(),
  op: z.enum(["==", "!=", ">", "<", ">=", "<=", "fired"]).default("=="),
  value: Value.optional(),
});
const EVENTS = ["click", "down", "up", "enter", "leave"] as const;

function summary(sm: StateMachine) {
  const name = (id: string) => (id === "any" ? "any" : (sm.states.find((s) => s.id === id)?.name ?? id));
  return {
    id: sm.id,
    name: sm.name,
    inputs: sm.inputs,
    initial: name(sm.initial),
    states: sm.states.map((s) => ({ id: s.id, name: s.name, animation: s.animation, speed: s.speed })),
    transitions: sm.transitions.map((t) => ({ id: t.id, from: name(t.from), to: name(t.to), conditions: t.conditions, duration: t.duration, exitTime: t.exitTime })),
    listeners: sm.listeners,
  };
}

function checkInput(sm: StateMachine, input: string) {
  if (!sm.inputs.some((i) => i.name === input)) throw new Error(`No input "${input}" (inputs: ${sm.inputs.map((i) => i.name).join(", ") || "none"}); run sm.addInput first`);
}

export const smCommands: CommandDef[] = [
  defineCommand({
    id: "sm.new",
    title: "New state machine",
    description: "Create a state machine (interactivity) with one 'Idle' state. Optionally give the Idle state an animation (id or name).",
    params: z.object({ name: z.string().default("State Machine"), idleAnimation: Ref.optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const idle = { id: nextId(doc, "st"), name: "Idle", animation: p.idleAnimation ? getAnimation(doc, p.idleAnimation).id : null, speed: 1 };
      const sm: StateMachine = { id: nextId(doc, "s"), name: p.name, inputs: [], states: [idle], initial: idle.id, transitions: [], listeners: [] };
      doc.stateMachines.push(sm);
      return summary(sm);
    },
  }),
  defineCommand({
    id: "sm.inspect",
    title: "Inspect state machine",
    description: "Inputs, states, transitions and listeners with state names resolved.",
    params: z.object({ sm: Ref.optional() }),
    mutates: false,
    run: ({ doc }, p) => summary(findStateMachine(doc, p.sm)),
  }),
  defineCommand({
    id: "sm.addInput",
    title: "Add input",
    description: "Add an input: bool (hover, toggled), number (progress, level) or trigger (one-shot like click).",
    params: z.object({ sm: Ref.optional(), name: z.string().min(1), type: z.enum(["bool", "number", "trigger"]), value: Value.optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const sm = findStateMachine(doc, p.sm);
      if (sm.inputs.some((i) => i.name === p.name)) throw new Error(`Input "${p.name}" already exists`);
      sm.inputs.push({ name: p.name, type: p.type, value: p.type === "trigger" ? false : p.type === "bool" ? Boolean(p.value ?? false) : Number(p.value ?? 0) });
      return summary(sm);
    },
  }),
  defineCommand({
    id: "sm.addState",
    title: "Add state",
    description: "Add a state that plays an animation (id or name; omit for the rest pose). speed scales playback.",
    params: z.object({ sm: Ref.optional(), name: z.string().min(1), animation: Ref.nullable().optional(), speed: z.number().positive().default(1), initial: z.boolean().default(false) }),
    mutates: true,
    run: ({ doc }, p) => {
      const sm = findStateMachine(doc, p.sm);
      if (sm.states.some((s) => s.name === p.name)) throw new Error(`State "${p.name}" already exists`);
      const st = { id: nextId(doc, "st"), name: p.name, animation: p.animation ? getAnimation(doc, p.animation).id : null, speed: p.speed };
      sm.states.push(st);
      if (p.initial) sm.initial = st.id;
      return { id: st.id };
    },
  }),
  defineCommand({
    id: "sm.addTransition",
    title: "Add transition",
    description:
      'Add a transition between states (ids or names; from may be "any"). conditions: [{input, op, value}], op ==, !=, >, <, >=, <= or "fired" for triggers. duration = crossfade seconds. exitTime (0..1) waits for that much of the source animation; with no conditions it makes an automatic "then" transition.',
    params: z.object({ sm: Ref.optional(), from: Ref, to: Ref, conditions: z.array(Condition).default([]), duration: z.number().min(0).default(0.2), exitTime: z.number().min(0).max(1).nullable().default(null) }),
    mutates: true,
    run: ({ doc }, p) => {
      const sm = findStateMachine(doc, p.sm);
      const from = p.from === "any" ? "any" : findState(sm, p.from).id;
      const to = findState(sm, p.to).id;
      for (const c of p.conditions) {
        checkInput(sm, c.input);
        const def = sm.inputs.find((i) => i.name === c.input)!;
        if ((def.type === "trigger") !== (c.op === "fired")) throw new Error(def.type === "trigger" ? `"${c.input}" is a trigger: use op "fired"` : `op "fired" only works with trigger inputs`);
      }
      if (!p.conditions.length && p.exitTime === null) throw new Error("Give the transition conditions, an exitTime, or both");
      const t = { id: nextId(doc, "t"), from, to, conditions: p.conditions, duration: p.duration, exitTime: p.exitTime };
      sm.transitions.push(t);
      return { id: t.id };
    },
  }),
  defineCommand({
    id: "sm.addListener",
    title: "Add listener",
    description: "Wire a pointer event on a node (click, down, up, enter, leave) to an input: action set (value), toggle (bool) or fire (trigger). Listeners on a group react to all its children.",
    params: z.object({ sm: Ref.optional(), nodeId: Ref, event: z.enum(EVENTS), input: z.string(), action: z.enum(["set", "toggle", "fire"]).optional(), value: Value.optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const sm = findStateMachine(doc, p.sm);
      getNode(doc, p.nodeId);
      checkInput(sm, p.input);
      const def = sm.inputs.find((i) => i.name === p.input)!;
      const action = p.action ?? (def.type === "trigger" ? "fire" : def.type === "bool" ? "toggle" : "set");
      if (action === "set" && p.value === undefined) throw new Error('action "set" needs a value');
      const l = { id: nextId(doc, "l"), nodeId: p.nodeId, event: p.event, input: p.input, action, value: p.value };
      sm.listeners.push(l);
      return { id: l.id };
    },
  }),
  defineCommand({
    id: "sm.update",
    title: "Edit state machine",
    description: "Rename a state machine or set its initial state.",
    params: z.object({ sm: Ref.optional(), name: z.string().optional(), initial: Ref.optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const sm = findStateMachine(doc, p.sm);
      if (p.name) sm.name = p.name;
      if (p.initial) sm.initial = findState(sm, p.initial).id;
      return summary(sm);
    },
  }),
  defineCommand({
    id: "sm.updateState",
    title: "Edit state",
    description: "Change a state's name, animation (null for rest pose) or speed.",
    params: z.object({ sm: Ref.optional(), state: Ref, name: z.string().optional(), animation: Ref.nullable().optional(), speed: z.number().positive().optional() }),
    mutates: true,
    run: ({ doc }, p) => {
      const st = findState(findStateMachine(doc, p.sm), p.state);
      if (p.name) st.name = p.name;
      if (p.animation !== undefined) st.animation = p.animation === null ? null : getAnimation(doc, p.animation).id;
      if (p.speed) st.speed = p.speed;
      return { id: st.id };
    },
  }),
  defineCommand({
    id: "sm.remove",
    title: "Remove from state machine",
    description: "Remove an input (by name), a state, transition or listener (by id or name). Removing a state also removes its transitions.",
    params: z.object({ sm: Ref.optional(), kind: z.enum(["input", "state", "transition", "listener"]), ref: Ref }),
    mutates: true,
    run: ({ doc }, p) => {
      const sm = findStateMachine(doc, p.sm);
      if (p.kind === "input") {
        sm.inputs = sm.inputs.filter((i) => i.name !== p.ref);
        sm.listeners = sm.listeners.filter((l) => l.input !== p.ref);
        for (const t of sm.transitions) t.conditions = t.conditions.filter((c) => c.input !== p.ref);
      } else if (p.kind === "state") {
        const st = findState(sm, p.ref);
        if (sm.states.length === 1) throw new Error("A state machine needs at least one state");
        sm.states = sm.states.filter((s) => s !== st);
        sm.transitions = sm.transitions.filter((t) => t.from !== st.id && t.to !== st.id);
        if (sm.initial === st.id) sm.initial = sm.states[0]!.id;
      } else if (p.kind === "transition") sm.transitions = sm.transitions.filter((t) => t.id !== p.ref);
      else sm.listeners = sm.listeners.filter((l) => l.id !== p.ref);
      return summary(sm);
    },
  }),
  defineCommand({
    id: "sm.delete",
    title: "Delete state machine",
    description: "Delete a whole state machine.",
    params: z.object({ sm: Ref }),
    mutates: true,
    run: ({ doc }, p) => {
      const sm = findStateMachine(doc, p.sm);
      doc.stateMachines = doc.stateMachines.filter((s) => s !== sm);
      return { deleted: sm.id };
    },
  }),
  defineCommand({
    id: "sm.simulate",
    title: "Simulate state machine",
    description:
      'Run the state machine headlessly and report states: steps like {"wait":0.5}, {"set":{"hover":true}}, {"fire":"press"}, {"pointer":{"event":"click","nodeId":"n3"}}. Returns the state after each step and the full history. Use it to test interactivity without a window.',
    params: z.object({
      sm: Ref.optional(),
      steps: z.array(
        z.union([
          z.object({ wait: z.number().min(0).max(60) }),
          z.object({ set: z.record(z.string(), Value) }),
          z.object({ fire: z.string() }),
          z.object({ pointer: z.object({ event: z.enum(EVENTS), nodeId: Ref }) }),
        ]),
      ),
    }),
    mutates: false,
    run: ({ doc }, p) => {
      const rt = new StateMachineRuntime(doc, p.sm);
      const log: { step: unknown; state: string; inputs: Record<string, boolean | number> }[] = [];
      for (const s of p.steps) {
        if ("wait" in s) for (let t = 0; t < s.wait; t += 1 / 60) rt.advance(Math.min(1 / 60, s.wait - t));
        else if ("set" in s) for (const [k, v] of Object.entries(s.set)) rt.setInput(k, v);
        else if ("fire" in s) rt.fire(s.fire);
        else rt.pointer(s.pointer.event, s.pointer.nodeId);
        log.push({ step: s, state: rt.current.state.name, inputs: Object.fromEntries(rt.inputs) });
      }
      return { log, history: rt.history };
    },
  }),
];
