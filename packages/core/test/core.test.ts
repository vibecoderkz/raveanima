import { describe, expect, it } from "vitest";
import { applyEase, createEditor, cubicBezier, evaluate, exportLottie, exportSvg, lerpColor, localTime, nodeBounds, renderFrame, type Ctx2D } from "../src/index.js";

describe("easing", () => {
  it("solves cubic-bezier endpoints and symmetry", () => {
    expect(cubicBezier(0.42, 0, 0.58, 1, 0)).toBe(0);
    expect(cubicBezier(0.42, 0, 0.58, 1, 1)).toBe(1);
    expect(cubicBezier(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 4);
    expect(cubicBezier(0.42, 0, 1, 1, 0.25)).toBeLessThan(0.25);
  });
  it("hold steps and back overshoots", () => {
    expect(applyEase("hold", 0.99)).toBe(0);
    expect(applyEase("linear", 0.3)).toBe(0.3);
    const samples = Array.from({ length: 50 }, (_, i) => applyEase("backOut", i / 50));
    expect(Math.max(...samples)).toBeGreaterThan(1);
  });
});

describe("colour", () => {
  it("interpolates in RGBA", () => {
    expect(lerpColor("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(lerpColor("#ff000000", "#ff0000", 1)).toBe("#ff0000");
  });
});

describe("editor commands", () => {
  it("adds, updates, undoes and redoes", () => {
    const ed = createEditor();
    const { id } = ed.execute<{ id: string }>("node.add", { type: "rect", props: { width: 100, height: 50, fill: "#00ff00", transform: { x: 200, y: 100 } } });
    expect(ed.doc.nodes[id]!.type).toBe("rect");
    expect(nodeBounds(ed.doc, id)).toEqual({ x: 150, y: 75, width: 100, height: 50 });
    ed.execute("node.update", { id, props: { transform: { rotation: 90 } } });
    expect(ed.doc.nodes[id]!.transform.x).toBe(200);
    expect(ed.doc.nodes[id]!.transform.rotation).toBe(90);
    ed.undo();
    expect(ed.doc.nodes[id]!.transform.rotation).toBe(0);
    ed.redo();
    expect(ed.doc.nodes[id]!.transform.rotation).toBe(90);
  });

  it("rejects bad params with a readable message and leaves the doc untouched", () => {
    const ed = createEditor();
    expect(() => ed.execute("node.add", { type: "rect", props: { widht: 10 } })).toThrow(/widht/);
    expect(() => ed.execute("node.add", { type: "ellipse", props: { cornerRadius: 4 } })).toThrow(/does not apply/);
    expect(Object.keys(ed.doc.nodes)).toHaveLength(0);
    expect(() => ed.execute("nod.add")).toThrow(/Unknown command/);
  });

  it("coalesces a drag into one undo step", () => {
    const ed = createEditor();
    const { id } = ed.execute<{ id: string }>("node.add", { type: "ellipse" });
    for (let x = 0; x < 10; x++) ed.execute("node.update", { id, props: { transform: { x } } }, { historyKey: "drag-1" });
    expect(ed.history().undo).toHaveLength(2);
    ed.undo();
    expect(ed.doc.nodes[id]!.transform.x).toBe(0);
  });

  it("batch is atomic", () => {
    const ed = createEditor();
    expect(() =>
      ed.batch([
        { command: "node.add", params: { type: "rect" } },
        { command: "node.update", params: { id: "nope", props: {} } },
      ]),
    ).toThrow();
    expect(Object.keys(ed.doc.nodes)).toHaveLength(0);
    ed.batch([{ command: "node.add", params: { type: "rect" } }, { command: "node.add", params: { type: "star" } }]);
    expect(ed.history().undo).toHaveLength(1);
  });

  it("groups and ungroups while keeping world placement", () => {
    const ed = createEditor();
    const a = ed.execute<{ id: string }>("node.add", { type: "rect", props: { transform: { x: 100, y: 100 } } }).id;
    const b = ed.execute<{ id: string }>("node.add", { type: "rect", props: { transform: { x: 300, y: 100 } } }).id;
    const before = nodeBounds(ed.doc, a);
    const g = ed.execute<{ id: string }>("node.group", { ids: [a, b] }).id;
    ed.execute("node.update", { id: g, props: { transform: { x: 50, rotation: 30 } } });
    const moved = nodeBounds(ed.doc, a)!;
    ed.execute("node.ungroup", { id: g });
    const after = nodeBounds(ed.doc, a)!;
    expect(after.x).toBeCloseTo(moved.x, 3);
    expect(after.y).toBeCloseTo(moved.y, 3);
    expect(before).not.toEqual(moved);
    expect(ed.doc.root).toEqual([a, b]);
  });
});

describe("animation", () => {
  function bouncing() {
    const ed = createEditor();
    const id = ed.execute<{ id: string }>("node.add", { type: "ellipse", props: { transform: { x: 100, y: 100 } } }).id;
    ed.execute("anim.new", { name: "Move", duration: 2 });
    ed.execute("keyframe.set", { nodeId: id, prop: "transform.x", time: 0, ease: "linear" });
    ed.execute("keyframe.set", { nodeId: id, prop: "transform.x", time: 1, value: 300 });
    ed.execute("keyframe.set", { nodeId: id, prop: "fill.color", time: 0, value: "#000000", ease: "linear" });
    ed.execute("keyframe.set", { nodeId: id, prop: "fill.color", time: 2, value: "#ffffff" });
    return { ed, id };
  }

  it("evaluates tracks without mutating the rest pose", () => {
    const { ed, id } = bouncing();
    const mid = evaluate(ed.doc, 0.5);
    expect(mid.nodes[id]!.transform.x).toBeCloseTo(200);
    expect((mid.nodes[id]!.fill as { color: string }).color).toBe("#404040");
    expect(evaluate(ed.doc, 5).nodes[id]!.transform.x).toBe(300); // looped: 5s -> 1s
    expect(ed.doc.nodes[id]!.transform.x).toBe(100);
  });

  it("loops and ping-pongs", () => {
    const anim = { id: "a", name: "", duration: 2, loop: "loop" as const, tracks: [] };
    expect(localTime(anim, 5)).toBe(1);
    expect(localTime({ ...anim, loop: "pingpong" }, 3)).toBe(1);
    expect(localTime({ ...anim, loop: "none" }, 3)).toBe(2);
  });

  it("morphs paths with equal point counts", () => {
    const ed = createEditor();
    const pts = (y: number) => [
      { x: 0, y },
      { x: 100, y },
    ];
    const id = ed.execute<{ id: string }>("node.add", { type: "path", props: { points: pts(0), closed: false } }).id;
    ed.execute("anim.new", {});
    ed.execute("keyframe.set", { nodeId: id, prop: "points", time: 0, ease: "linear" });
    ed.execute("keyframe.set", { nodeId: id, prop: "points", time: 1, value: pts(50) });
    const n = evaluate(ed.doc, 0.5).nodes[id] as { points: { y: number }[] };
    expect(n.points[1]!.y).toBe(25);
  });

  it("deleting a node removes its tracks", () => {
    const { ed, id } = bouncing();
    ed.execute("node.delete", { ids: [id] });
    expect(ed.doc.animations[0]!.tracks).toHaveLength(0);
  });
});

describe("export", () => {
  it("writes valid-looking Lottie with eased keyframes", () => {
    const ed = createEditor();
    const id = ed.execute<{ id: string }>("node.add", { type: "rect", props: { transform: { x: 100, y: 100 } } }).id;
    ed.execute("anim.new", { duration: 1 });
    ed.execute("keyframe.set", { nodeId: id, prop: "transform.x", time: 0, ease: "easeIn" });
    ed.execute("keyframe.set", { nodeId: id, prop: "transform.x", time: 1, value: 500 });
    const l = exportLottie(ed.doc) as { op: number; fr: number; layers: { shapes: { it: { ty: string; p?: { a: number; k: unknown } }[] }[] }[] };
    expect(l.fr).toBe(60);
    expect(l.op).toBe(60);
    const tr = l.layers[0]!.shapes[0]!.it.find((i) => i.ty === "tr")!;
    expect(tr.p!.a).toBe(1);
    const keys = tr.p!.k as { t: number; s: number[]; o?: { x: number[] } }[];
    expect(keys).toHaveLength(2); // y is static, so the x keys keep their easing instead of being baked
    expect(keys[0]!.s).toEqual([100, 100]);
    expect(keys[0]!.o!.x[0]).toBe(0.42);
    expect(keys[1]!.t).toBe(60);
    expect(JSON.parse(JSON.stringify(l))).toBeTruthy();
  });

  it("writes SVG", () => {
    const ed = createEditor();
    ed.execute("node.add", { type: "star", props: { fill: "#FF3B2E" } });
    const svg = exportSvg(ed.doc);
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain("<path");
  });

  it("renders through a Canvas2D-like context", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => (calls.push(k), k.startsWith("create") ? { addColorStop() {} } : undefined)),
      set: (t, k: string, v) => ((t[k] = v), true),
    }) as unknown as Ctx2D;
    const ed = createEditor();
    ed.execute("node.add", { type: "rect" });
    renderFrame(ctx, ed.doc, 0);
    expect(calls).toContain("fillRect");
    expect(calls).toContain("bezierCurveTo");
    expect(calls).toContain("fill");
  });
});
