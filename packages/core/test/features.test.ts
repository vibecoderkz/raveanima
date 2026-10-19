import { describe, expect, it } from "vitest";
import { createEditor, evaluate, exportLottie, exportSvg, migrateDocument, nodeBounds, renderDocument, splitCubic, trimContours, type Ctx2D, type Fragment } from "../src/index.js";

function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (t, k: string) =>
      k in t ? t[k] : (...args: unknown[]) => (calls.push({ name: k, args }), k.startsWith("create") ? { addColorStop() {} } : k === "getTransform" ? { a: 1, b: 0, c: 0, d: 1 } : undefined),
    set: (t, k: string, v) => {
      t[k] = v;
      calls.push({ name: `set:${k}`, args: [v] });
      return true;
    },
  }) as unknown as Ctx2D;
  return { ctx, calls };
}

describe("trim paths", () => {
  const line = [{ closed: false, points: [{ x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 }, { x: 100, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 }] }];
  it("keeps the requested fraction of the length", () => {
    const runs = trimContours(line, 0.25, 0.75, 0);
    expect(runs).toHaveLength(1);
    expect(runs[0]![0]!.x0).toBeCloseTo(25, 1);
    expect(runs[0]![0]!.x1).toBeCloseTo(75, 1);
  });
  it("wraps around with an offset and returns nothing for an empty window", () => {
    expect(trimContours(line, 0.5, 0.9, 0.3)).toHaveLength(2);
    expect(trimContours(line, 0.4, 0.4, 0)).toHaveLength(0);
  });
  it("splits a cubic exactly", () => {
    const q = { x0: 0, y0: 0, c1x: 0, c1y: 100, c2x: 100, c2y: 100, x1: 100, y1: 0 };
    const left = splitCubic(q, 0, 0.5), right = splitCubic(q, 0.5, 1);
    expect(left.x1).toBeCloseTo(right.x0);
    expect(left.y1).toBeCloseTo(75);
    expect(right.x1).toBe(100);
  });
});

describe("new node features", () => {
  it("text and image nodes have bounds and render", () => {
    const ed = createEditor();
    const t = ed.execute<{ id: string }>("node.add", { type: "text", props: { text: "Hello\nAnima", fontSize: 40, transform: { x: 300, y: 300 } } }).id;
    const img = ed.execute<{ id: string }>("node.add", { type: "image", props: { src: "data:image/png;base64,AAAA", width: 120, height: 80, transform: { x: 100, y: 100 } } }).id;
    expect(nodeBounds(ed.doc, t)!.height).toBeCloseTo(96);
    expect(nodeBounds(ed.doc, img)).toEqual({ x: 40, y: 60, width: 120, height: 80 });
    const { ctx, calls } = recorder();
    renderDocument(ctx, ed.doc);
    expect(calls.filter((c) => c.name === "fillText")).toHaveLength(2);
    expect(calls.some((c) => c.name === "fillRect")).toBe(true); // image placeholder
  });

  it("clip groups clip with the bottom child and do not draw it", () => {
    const ed = createEditor();
    const mask = ed.execute<{ id: string }>("node.add", { type: "ellipse", props: { width: 100, height: 100 } }).id;
    const r = ed.execute<{ id: string }>("node.add", { type: "rect", props: { width: 300, height: 300 } }).id;
    const g = ed.execute<{ id: string }>("node.group", { ids: [mask, r] }).id;
    ed.execute("node.update", { id: g, props: { clip: true } });
    const { ctx, calls } = recorder();
    renderDocument(ctx, ed.doc, { background: false });
    expect(calls.filter((c) => c.name === "clip")).toHaveLength(1);
    expect(calls.filter((c) => c.name === "fill")).toHaveLength(1);
    expect(exportSvg(ed.doc)).toContain("clipPath");
    const l = exportLottie(ed.doc) as { layers: { masksProperties?: unknown[] }[] };
    expect(l.layers[0]!.masksProperties).toHaveLength(1);
  });

  it("blur and shadow reach the canvas, scaled by the view", () => {
    const ed = createEditor();
    const id = ed.execute<{ id: string }>("node.add", { type: "rect", props: { blur: 4, shadow: { color: "#00000080", x: 0, y: 10, blur: 20 } } }).id;
    const { ctx, calls } = recorder();
    (ctx as unknown as { filter: string }).filter = "none";
    renderDocument(ctx, ed.doc, { background: false, scale: 2 });
    expect(calls.some((c) => c.name === "set:filter" && c.args[0] === "blur(4px)")).toBe(true); // recorder reports unit transform
    expect(calls.some((c) => c.name === "set:shadowOffsetY" && c.args[0] === 10)).toBe(true);
    expect(exportSvg(ed.doc)).toContain("feDropShadow");
    expect(ed.doc.nodes[id]!.shadow!.blur).toBe(20);
  });

  it("evenodd compound paths render with the rule and export two shapes", () => {
    const ed = createEditor();
    const sq = (s: number) => [{ x: -s, y: -s }, { x: s, y: -s }, { x: s, y: s }, { x: -s, y: s }];
    ed.execute("node.add", { type: "path", props: { points: sq(50), closed: true, subpaths: [{ points: sq(20), closed: true }], fillRule: "evenodd", fill: "#000000", stroke: null } });
    const { ctx, calls } = recorder();
    renderDocument(ctx, ed.doc, { background: false });
    expect(calls.find((c) => c.name === "fill")!.args[0]).toBe("evenodd");
    const l = exportLottie(ed.doc) as { layers: { shapes: { it: { ty: string; r?: number }[] }[] }[] };
    const items = l.layers[0]!.shapes[0]!.it;
    expect(items.filter((i) => i.ty === "sh")).toHaveLength(2);
    expect(items.find((i) => i.ty === "fl")!.r).toBe(2);
  });

  it("migrates documents from before these fields existed", () => {
    const ed = createEditor();
    ed.execute("node.add", { type: "rect" });
    const old = JSON.parse(JSON.stringify(ed.doc));
    delete old.nodes.n1.blur;
    delete old.nodes.n1.trimEnd;
    migrateDocument(old);
    expect(old.nodes.n1.blur).toBe(0);
    expect(old.nodes.n1.trimEnd).toBe(1);
  });
});

describe("editing commands", () => {
  it("copies and pastes with animation, into another document", () => {
    const a = createEditor();
    const id = a.execute<{ id: string }>("node.add", { type: "star", props: { transform: { x: 100, y: 100 } } }).id;
    a.execute("anim.new", { name: "Intro" });
    a.execute("keyframe.set", { nodeId: id, prop: "transform.x", time: 0 });
    a.execute("keyframe.set", { nodeId: id, prop: "transform.x", time: 1, value: 300 });
    const { fragment } = a.execute<{ fragment: Fragment }>("node.copy", { ids: [id] });
    const b = createEditor();
    b.execute("anim.new", { name: "Intro" });
    const { ids } = b.execute<{ ids: string[] }>("node.paste", { fragment: JSON.parse(JSON.stringify(fragment)), offsetX: 50 });
    expect(b.doc.nodes[ids[0]!]!.transform.x).toBe(150);
    expect(evaluate(b.doc, 1).nodes[ids[0]!]!.transform.x).toBe(350);
  });

  it("aligns and distributes", () => {
    const ed = createEditor();
    const ids = [100, 260, 700].map((x) => ed.execute<{ id: string }>("node.add", { type: "rect", props: { width: 40, height: 40, transform: { x, y: x } } }).id);
    ed.execute("node.align", { ids, align: "top" });
    expect(ids.map((id) => nodeBounds(ed.doc, id)!.y)).toEqual([80, 80, 80]);
    ed.execute("node.distribute", { ids, axis: "horizontal" });
    const xs = ids.map((id) => nodeBounds(ed.doc, id)!.x);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!);
    ed.execute("node.align", { ids: [ids[0]!], align: "center", to: "artboard" });
    expect(nodeBounds(ed.doc, ids[0]!)!.x).toBe(520);
  });

  it("converts shapes to paths and edits points without changing the outline", () => {
    const ed = createEditor();
    const id = ed.execute<{ id: string }>("node.add", { type: "ellipse", props: { width: 200, height: 100 } }).id;
    const before = nodeBounds(ed.doc, id)!;
    ed.execute("node.convertToPath", { id });
    expect(ed.doc.nodes[id]!.type).toBe("path");
    ed.execute("path.insertPoint", { id, index: 0, t: 0.5 });
    expect((ed.doc.nodes[id] as { points: unknown[] }).points).toHaveLength(5);
    const after = nodeBounds(ed.doc, id)!;
    expect(after.width).toBeCloseTo(before.width, 0);
    ed.execute("path.setPoint", { id, index: 0, point: { y: -80 } });
    expect(nodeBounds(ed.doc, id)!.y).toBeLessThan(before.y);
    ed.execute("path.deletePoint", { id, index: 1 });
    expect((ed.doc.nodes[id] as { points: unknown[] }).points).toHaveLength(4);
  });

  it("adds animation presets relative to the pose", () => {
    const ed = createEditor();
    const id = ed.execute<{ id: string }>("node.add", { type: "path", props: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false, transform: { x: 300, y: 300 } } }).id;
    ed.execute("anim.preset", { nodeId: id, preset: "slideInLeft", distance: 100 });
    ed.execute("anim.preset", { nodeId: id, preset: "draw", time: 0.7 });
    expect(evaluate(ed.doc, 0).nodes[id]!.transform.x).toBe(200);
    expect(evaluate(ed.doc, 0.7).nodes[id]!.transform.x).toBe(300);
    expect((evaluate(ed.doc, 0.7).nodes[id] as { trimEnd: number }).trimEnd).toBe(0);
    const l = JSON.stringify(exportLottie(ed.doc));
    expect(l).toContain('"ty":"tm"');
    expect(() => ed.execute("anim.preset", { nodeId: id, preset: "nope" })).toThrow(/preset/);
  });
});

describe("svg import command", () => {
  it("imports a logo as editable, centred paths with holes", () => {
    const ed = createEditor();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>.a{fill:#ff3b2e}</style>
      <g transform="translate(10 10)"><path class="a" fill-rule="evenodd" d="M0 0H80V80H0Z M20 20V60H60V20Z"/></g>
      <circle cx="50" cy="50" r="10" fill="url(#g)"/><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs></svg>`;
    const r = ed.execute<{ id: string; warnings: string[] }>("import.svg", { svg, width: 400, x: 0, y: 0 });
    const g = ed.doc.nodes[r.id] as { children: string[] };
    expect(g.children).toHaveLength(2);
    const inner = (ed.doc.nodes[g.children[0]!] as { children: string[] }).children[0]!; // <g> stays a group
    const frame = ed.doc.nodes[inner] as { subpaths: unknown[]; fillRule: string; transform: { x: number } };
    expect(frame.subpaths).toHaveLength(1);
    expect(frame.fillRule).toBe("evenodd");
    expect(frame.transform.x).toBe(200); // (10..90)*4 -> centre 200
    expect(nodeBounds(ed.doc, inner)).toEqual({ x: 40, y: 40, width: 320, height: 320 });
    expect(ed.doc.nodes[g.children[1]!]!.fill.type).toBe("linear");
  });
});
