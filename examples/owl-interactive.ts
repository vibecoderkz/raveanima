// Turns the owl into an interactive piece: hover makes it alert, a click makes it hoot.
// Uses only commands (as an agent would over MCP). Run: npx tsx examples/owl-interactive.ts
import { readFileSync, writeFileSync } from "node:fs";
import { createEditor, type AnimaDocument } from "../packages/core/src/index.js";

const doc = JSON.parse(readFileSync(new URL("./owl.anima", import.meta.url), "utf8")) as AnimaDocument;
const ed = createEditor();
ed.execute("doc.load", { document: doc });
const byName = (name: string) => Object.values(ed.doc.nodes).filter((n) => n.name === name).map((n) => n.id);
const [owl, head, body, wingL, wingR] = ["Owl", "Head", "Body", "Wing left", "Wing right"].map((n) => byName(n)[0]!);
const pupils = byName("Pupil");
const lids = byName("Eyelid");
const tufts = [...byName("Ear tuft left"), ...byName("Ear tuft right")];
const key = (nodeId: string, prop: string, frames: [number, unknown, string?][]) => {
  for (const [time, value, ease] of frames) ed.execute("keyframe.set", { nodeId, prop, time, value, ease: ease ?? "easeInOut" });
};

// Alert: head snaps towards the viewer, pupils go wide, ear tufts stand up. Holds while hovered.
ed.execute("anim.new", { name: "Alert", duration: 0.5, loop: "none" });
key(head, "transform.rotation", [[0, 0, "backOut"], [0.35, -4]]);
key(head, "transform.y", [[0, -545, "backOut"], [0.35, -562]]);
for (const p of pupils) {
  key(p, "width", [[0, 52, "backOut"], [0.4, 78]]);
  key(p, "height", [[0, 52, "backOut"], [0.4, 78]]);
}
for (const [i, t] of tufts.entries()) key(t, "transform.rotation", [[0, i ? 16 : -16, "backOut"], [0.4, i ? 2 : -2]]);

// Hoot: quick double blink, a shake of the body and a wing flap.
ed.execute("anim.new", { name: "Hoot", duration: 0.9, loop: "none" });
for (const l of lids) key(l, "transform.scaleY", [[0, 0.02, "easeIn"], [0.08, 1, "easeOut"], [0.18, 0.02, "easeIn"], [0.26, 1, "easeOut"], [0.36, 0.02]]);
key(body, "transform.scaleY", [[0, 1, "easeOut"], [0.15, 1.06, "easeInOut"], [0.35, 0.97, "easeInOut"], [0.6, 1]]);
key(head, "transform.rotation", [[0, -4], [0.12, 8, "easeInOut"], [0.26, -8, "easeInOut"], [0.4, 5], [0.6, -4]]);
key(head, "transform.y", [[0, -562], [0.6, -562]]);
key(wingL, "transform.rotation", [[0, 0, "easeOut"], [0.15, 12, "easeInOut"], [0.35, -4], [0.6, 0]]);
key(wingR, "transform.rotation", [[0, 0, "easeOut"], [0.15, -12, "easeInOut"], [0.35, 4], [0.6, 0]]);
for (const p of pupils) {
  key(p, "width", [[0, 78], [0.9, 78]]);
  key(p, "height", [[0, 78], [0.9, 78]]);
}

ed.execute("sm.new", { name: "Owl", idleAnimation: "Idle" });
ed.execute("sm.addInput", { name: "hover", type: "bool" });
ed.execute("sm.addInput", { name: "hoot", type: "trigger" });
ed.execute("sm.addState", { name: "Alert", animation: "Alert" });
ed.execute("sm.addState", { name: "Hoot", animation: "Hoot" });
ed.execute("sm.addTransition", { from: "Idle", to: "Alert", conditions: [{ input: "hover", value: true }], duration: 0.25 });
ed.execute("sm.addTransition", { from: "Alert", to: "Idle", conditions: [{ input: "hover", value: false }], duration: 0.6 });
ed.execute("sm.addTransition", { from: "any", to: "Hoot", conditions: [{ input: "hoot", op: "fired" }], duration: 0.1 });
ed.execute("sm.addTransition", { from: "Hoot", to: "Alert", exitTime: 1, conditions: [{ input: "hover", value: true }], duration: 0.2 });
ed.execute("sm.addTransition", { from: "Hoot", to: "Idle", exitTime: 1, conditions: [{ input: "hover", value: false }], duration: 0.4 });
ed.execute("sm.addListener", { nodeId: owl, event: "enter", input: "hover", action: "set", value: true });
ed.execute("sm.addListener", { nodeId: owl, event: "leave", input: "hover", action: "set", value: false });
ed.execute("sm.addListener", { nodeId: owl, event: "click", input: "hoot" });
ed.execute("anim.select", { id: "Idle" });

const check = ed.execute<{ history: string[] }>("sm.simulate", { steps: [{ pointer: { event: "enter", nodeId: head } }, { wait: 1 }, { pointer: { event: "click", nodeId: body } }, { wait: 1.2 }, { pointer: { event: "leave", nodeId: head } }, { wait: 1 }] });
console.log("simulated:", check.history.join(" -> "));
writeFileSync(new URL("./owl-interactive.anima", import.meta.url), JSON.stringify(ed.doc, null, 2) + "\n");
