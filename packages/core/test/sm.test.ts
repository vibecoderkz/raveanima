import { describe, expect, it } from "vitest";
import { createEditor, StateMachineRuntime } from "../src/index.js";

/** A button: hover scales it up, click plays a one-shot "press" and returns to hover/idle. */
function button() {
  const ed = createEditor();
  const id = ed.execute<{ id: string }>("node.add", { type: "rect", props: { name: "Button", width: 200, height: 80, transform: { x: 300, y: 300 } } }).id;
  ed.execute("anim.new", { name: "Hover", duration: 0.3, loop: "none" });
  ed.execute("keyframe.set", { nodeId: id, prop: "transform.scaleX", time: 0, value: 1 });
  ed.execute("keyframe.set", { nodeId: id, prop: "transform.scaleX", time: 0.3, value: 1.2 });
  ed.execute("anim.new", { name: "Press", duration: 0.4, loop: "none" });
  ed.execute("keyframe.set", { nodeId: id, prop: "transform.scaleX", time: 0, value: 1.2 });
  ed.execute("keyframe.set", { nodeId: id, prop: "transform.scaleX", time: 0.2, value: 0.9 });
  ed.execute("keyframe.set", { nodeId: id, prop: "transform.scaleX", time: 0.4, value: 1.2 });
  ed.execute("sm.new", { name: "Button" });
  ed.execute("sm.addInput", { name: "hover", type: "bool" });
  ed.execute("sm.addInput", { name: "press", type: "trigger" });
  ed.execute("sm.addState", { name: "Hovered", animation: "Hover" });
  ed.execute("sm.addState", { name: "Pressed", animation: "Press" });
  ed.execute("sm.addTransition", { from: "Idle", to: "Hovered", conditions: [{ input: "hover", value: true }], duration: 0 });
  ed.execute("sm.addTransition", { from: "Hovered", to: "Idle", conditions: [{ input: "hover", value: false }], duration: 0.2 });
  ed.execute("sm.addTransition", { from: "any", to: "Pressed", conditions: [{ input: "press", op: "fired" }], duration: 0 });
  ed.execute("sm.addTransition", { from: "Pressed", to: "Hovered", exitTime: 1, duration: 0 });
  ed.execute("sm.addListener", { nodeId: id, event: "enter", input: "hover", action: "set", value: true });
  ed.execute("sm.addListener", { nodeId: id, event: "leave", input: "hover", action: "set", value: false });
  ed.execute("sm.addListener", { nodeId: id, event: "click", input: "press" });
  return { ed, id };
}

describe("state machines", () => {
  it("moves between states from inputs, triggers and exit time", () => {
    const { ed } = button();
    const r = ed.execute<{ log: { state: string }[]; history: string[] }>("sm.simulate", {
      steps: [{ set: { hover: true } }, { wait: 0.3 }, { fire: "press" }, { wait: 0.5 }, { set: { hover: false } }],
    });
    expect(r.log.map((l) => l.state)).toEqual(["Hovered", "Hovered", "Pressed", "Hovered", "Idle"]);
    expect(r.history).toEqual(["Idle", "Hovered", "Pressed", "Hovered", "Idle"]);
  });

  it("listeners turn pointer events into inputs and evaluate blends values", () => {
    const { ed, id } = button();
    const rt = new StateMachineRuntime(ed.doc);
    rt.pointer("enter", id);
    expect(rt.current.state.name).toBe("Hovered");
    rt.advance(0.15);
    expect(rt.evaluate().nodes[id]!.transform.scaleX).toBeCloseTo(1.1, 1);
    rt.advance(0.2);
    expect(rt.isSettled()).toBe(true);
    rt.pointer("leave", id);
    rt.advance(0.1); // halfway through the 0.2 s crossfade back to the rest pose
    const s = rt.evaluate().nodes[id]!.transform.scaleX;
    expect(s).toBeGreaterThan(1);
    expect(s).toBeLessThan(1.2);
    expect(rt.interactiveNodes().has(id)).toBe(true);
  });

  it("explains mistakes", () => {
    const { ed } = button();
    expect(() => ed.execute("sm.addTransition", { from: "Idle", to: "Nope", conditions: [{ input: "hover" }] })).toThrow(/State "Nope" not found/);
    expect(() => ed.execute("sm.addTransition", { from: "Idle", to: "Pressed", conditions: [{ input: "press" }] })).toThrow(/use op "fired"/);
    expect(() => ed.execute("sm.addListener", { nodeId: "n1", event: "click", input: "missing" })).toThrow(/No input "missing"/);
    ed.execute("node.delete", { ids: ["n1"] });
    expect(ed.doc.stateMachines[0]!.listeners).toHaveLength(0);
  });
});
