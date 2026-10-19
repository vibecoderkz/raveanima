import { editor, setUi } from "./store";

/** A small scene that shows off shapes, gradients, path morphing and easing. */
export function loadExample() {
  editor.execute("doc.new", { name: "Hello RaveAnima", width: 1080, height: 1080, background: "#f6f6f4" });
  editor.batch([
    { command: "node.add", params: { type: "rect", props: { name: "Card", width: 640, height: 400, cornerRadius: 44, fill: "#ffffff", stroke: { paint: "#ececec", width: 2 }, transform: { x: 540, y: 500 } } } },
    { command: "node.add", params: { type: "ellipse", props: { name: "Ball", width: 140, height: 140, fill: { type: "radial", center: { x: -24, y: -24 }, radius: 96, stops: [{ offset: 0, color: "#ff7a70" }, { offset: 1, color: "#ff3b2e" }] }, transform: { x: 320, y: 500 } } } },
    { command: "node.add", params: { type: "star", props: { name: "Star", radius: 64, innerRadius: 28, fill: "#0a0a0b", transform: { x: 760, y: 500 } } } },
    { command: "node.add", params: { type: "path", props: { name: "Wave", closed: false, stroke: { paint: "#ff3b2e", width: 10 }, transform: { x: 540, y: 800 }, points: [{ x: -240, y: 0, outX: 80, outY: -90 }, { x: 0, y: 0, inX: -80, inY: 90, outX: 80, outY: -90 }, { x: 240, y: 0, inX: -80, inY: 90 }] } } },
    { command: "anim.new", params: { name: "Intro", duration: 2, loop: "pingpong" } },
    { command: "keyframe.set", params: { nodeId: "n2", prop: "transform.x", time: 0, ease: "backOut" } },
    { command: "keyframe.set", params: { nodeId: "n2", prop: "transform.x", time: 1.2, value: 600 } },
    { command: "keyframe.set", params: { nodeId: "n3", prop: "transform.rotation", time: 0 } },
    { command: "keyframe.set", params: { nodeId: "n3", prop: "transform.rotation", time: 2, value: 216 } },
    { command: "keyframe.set", params: { nodeId: "n3", prop: "fill.color", time: 0, ease: "linear" } },
    { command: "keyframe.set", params: { nodeId: "n3", prop: "fill.color", time: 2, value: "#ff3b2e" } },
    { command: "keyframe.set", params: { nodeId: "n1", prop: "transform.scaleX", time: 0, value: 0.92, ease: "backOut" } },
    { command: "keyframe.set", params: { nodeId: "n1", prop: "transform.scaleX", time: 0.8, value: 1 } },
    { command: "keyframe.set", params: { nodeId: "n1", prop: "transform.scaleY", time: 0, value: 0.92, ease: "backOut" } },
    { command: "keyframe.set", params: { nodeId: "n1", prop: "transform.scaleY", time: 0.8, value: 1 } },
    { command: "keyframe.set", params: { nodeId: "n4", prop: "points", time: 0 } },
    {
      command: "keyframe.set",
      params: { nodeId: "n4", prop: "points", time: 2, value: [{ x: -240, y: 0, outX: 80, outY: 90 }, { x: 0, y: 0, inX: -80, inY: -90, outX: 80, outY: 90 }, { x: 240, y: 0, inX: -80, inY: -90 }] },
    },
  ]);
  editor.execute("select.set", { ids: [] });
  editor.dirty = false;
  setUi({ mode: "animate", playing: true, filePath: null, selectedKey: null });
}
