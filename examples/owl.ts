// A realistic night owl built only with Anima commands (the same ones agents use over MCP).
// Run: npx tsx examples/owl.ts  ->  examples/owl.anima
import { writeFileSync } from "node:fs";
import { createEditor, type PathPoint } from "../packages/core/src/index.js";

const ed = createEditor();
ed.execute("doc.new", { name: "Night Owl", width: 1080, height: 1350, background: "#0b1020", fps: 60 });

type P = Record<string, unknown>;
const add = (type: string, props: P, parent?: string): string => ed.execute<{ id: string }>("node.add", { type, props, parent, select: false }).id;
const group = (name: string, transform: P, parent?: string) => add("group", { name, transform }, parent);
const pt = (x: number, y: number, inX = 0, inY = 0, outX = 0, outY = 0): PathPoint => ({ x, y, inX, inY, outX, outY });
const mirror = (pts: PathPoint[]) => pts.map((p) => ({ ...p, x: -p.x, inX: -p.inX, outX: -p.outX }));
const lin = (x0: number, y0: number, x1: number, y1: number, ...stops: [number, string][]) => ({ type: "linear", from: { x: x0, y: y0 }, to: { x: x1, y: y1 }, stops: stops.map(([offset, color]) => ({ offset, color })) });
const rad = (cx: number, cy: number, r: number, ...stops: [number, string][]) => ({ type: "radial", center: { x: cx, y: cy }, radius: r, stops: stops.map(([offset, color]) => ({ offset, color })) });
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------------- sky ----------------
add("rect", { name: "Sky", width: 1080, height: 1350, fill: lin(0, -675, 0, 675, [0, "#070b17"], [0.55, "#142038"], [1, "#2a3654"]), transform: { x: 540, y: 675 } });
const glow = add("ellipse", { name: "Moon glow", width: 620, height: 620, fill: rad(0, 0, 310, [0, "#fff1c455"], [0.35, "#fff1c41f"], [1, "#fff1c400"]), transform: { x: 820, y: 260 } });
add("ellipse", { name: "Moon", width: 168, height: 168, fill: rad(-24, -24, 110, [0, "#fffdf2"], [0.7, "#f6e9c2"], [1, "#e6d39c"]), transform: { x: 820, y: 260 } });
add("ellipse", { name: "Moon crater", width: 34, height: 28, fill: "#e2cf9a66", transform: { x: 846, y: 284 } });
add("ellipse", { name: "Moon crater 2", width: 20, height: 18, fill: "#e2cf9a55", transform: { x: 796, y: 236 } });
const stars: string[] = [];
for (let i = 0; i < 34; i++) {
  const x = 30 + rnd() * 1020, y = 30 + rnd() * 620;
  if (Math.hypot(x - 820, y - 260) < 200) continue;
  const s = 2 + rnd() * 3.5;
  stars.push(add("ellipse", { name: `Star ${i + 1}`, width: s, height: s, opacity: 0.35 + rnd() * 0.6, fill: "#fdf6e3", transform: { x, y } }));
}

add("path", { name: "Far hills", closed: true, fill: lin(0, 900, 0, 1350, [0, "#1a2540"], [1, "#0f1628"]), points: [pt(-20, 1010, 0, 0, 160, -60), pt(420, 980, -140, -20, 160, 30), pt(1100, 940, -200, -20), pt(1100, 1360), pt(-20, 1360)] });
for (let i = 0; i < 9; i++) {
  const x = 40 + i * 128 + rnd() * 40, h = 110 + rnd() * 120, w = 56 + rnd() * 30;
  // Jagged tiers read as conifers instead of triangles.
  const tiers = 5, right: PathPoint[] = [], left: PathPoint[] = [];
  for (let t = 1; t <= tiers; t++) {
    const y = 1070 - h + (h * t) / tiers, half = (w / 2) * (t / tiers);
    right.push(pt(x + half, y), pt(x + half * 0.45, y - 4));
    left.unshift(pt(x - half * 0.45, y - 4), pt(x - half, y));
  }
  add("path", { name: "Pine", closed: true, fill: i % 2 ? "#0b111f" : "#0e1526", points: [pt(x, 1070 - h), ...right, pt(x + 5, 1090), pt(x - 5, 1090), ...left] });
}
add("ellipse", { name: "Fog", width: 1600, height: 1600, fill: rad(0, 0, 800, [0, "#8fa2c622"], [0.6, "#8fa2c60c"], [1, "#8fa2c600"]), transform: { x: 540, y: 1080, scaleY: 0.22 } });
add("rect", { name: "Ground shade", width: 1080, height: 300, fill: lin(0, -150, 0, 150, [0, "#0a0f1c00"], [1, "#05080fee"]), transform: { x: 540, y: 1200 } });

// ---------------- branch ----------------
const branch = group("Branch", { x: 540, y: 1100 });
add("path", {
  name: "Bough",
  closed: true,
  fill: lin(0, -40, 0, 50, [0, "#5b4330"], [0.5, "#3a2a1d"], [1, "#1f160f"]),
  points: [pt(-600, -10, 0, 0, 200, -30), pt(-80, -36, -180, 4, 160, -6), pt(620, -50, -220, 0), pt(620, 30, 0, 0, -240, 6), pt(-60, 44, 200, -4, -200, 0), pt(-600, 60, 200, 10)],
}, branch);
for (const [x0, w] of [[-420, 140], [-160, 90], [140, 120], [380, 160]] as const)
  add("path", { name: "Bark", closed: false, stroke: { paint: "#20170f", width: 3 }, opacity: 0.7, points: [pt(x0, -4 + rnd() * 10, 0, 0, w / 3, -6), pt(x0 + w, 2 + rnd() * 10, -w / 3, -4)] }, branch);
add("path", { name: "Twig", closed: true, fill: lin(0, 0, 0, -120, [0, "#3a2a1d"], [1, "#5b4330"]), points: [pt(300, -30, 0, 0, 40, -40), pt(430, -170, -10, 30), pt(440, -164, 0, 0, -20, 40), pt(330, -24, 30, -30)] }, branch);
const leaves: string[] = [];
for (const [x, y, r, s] of [[430, -170, -30, 1], [395, -120, 25, 0.8], [-470, -10, 200, 0.9], [-520, 20, 160, 0.75]] as const) {
  leaves.push(
    add("path", {
      name: "Leaf",
      closed: true,
      fill: lin(0, 0, 70, 0, [0, "#1f3a2a"], [1, "#3f6b45"]),
      stroke: { paint: "#16261c", width: 2 },
      points: [pt(0, 0, 0, 0, 20, -26), pt(80, 0, 10, -22, 10, 22), pt(0, 0, 20, 26)],
      transform: { x, y, rotation: r, scaleX: s, scaleY: s },
    }, branch),
  );
}

// ---------------- owl ----------------
// The owl group sits on the branch; its origin is between the feet.
const owl = group("Owl", { x: 520, y: 1068 });
add("path", { name: "Tail", closed: true, fill: lin(0, -120, 0, 120, [0, "#5a3d26"], [1, "#24170e"]), stroke: { paint: "#1d130b", width: 2 }, points: [pt(-80, -120), pt(-62, 96, 0, 0, 14, 14), pt(-30, 110, -10, 0, 10, 0), pt(0, 118, -10, 0, 10, 0), pt(30, 110, -10, 0, 10, 0), pt(62, 96, -14, 14), pt(80, -120)] }, owl);
for (const x of [-46, -16, 16, 46]) add("path", { name: "Tail bar", closed: false, opacity: 0.6, stroke: { paint: "#1d130b", width: 3 }, points: [pt(x * 0.7, 0), pt(x, 104)] }, owl);

const body = group("Body", { x: 0, y: 0 }, owl);
add("path", {
  name: "Body shape",
  closed: true,
  fill: rad(0, -300, 280, [0, "#ecd9b1"], [0.45, "#c39a68"], [0.8, "#8a6240"], [1, "#5e4029"]),
  points: [pt(0, -580, -160, 0, 160, 0), pt(225, -300, 0, -170, 0, 170), pt(0, -10, 160, 0, -160, 0), pt(-225, -300, 0, 170, 0, -170)],
}, body);
// Breast barring: rows of small dark scallops and streaks, narrower towards the flanks.
for (let row = 0; row < 11; row++) {
  const y = -440 + row * 36;
  const half = 205 * Math.sqrt(Math.max(0, 1 - ((y + 300) / 290) ** 2)) * 0.78;
  const n = Math.max(2, Math.round(half / 26));
  for (let i = 0; i <= n; i++) {
    const x = -half + (2 * half * i) / n + (row % 2 ? 13 : 0) + (rnd() - 0.5) * 6;
    if (Math.abs(x) > half) continue;
    const w = 11 + rnd() * 5;
    add("path", { name: "Feather edge", closed: false, opacity: 0.45, stroke: { paint: "#f4e4c2", width: 2 }, points: [pt(x - w, y - 4, 0, 0, w * 0.4, 9), pt(x + w, y - 4, -w * 0.4, 9)] }, body);
    add("path", { name: "Bar", closed: false, opacity: 0.5 + rnd() * 0.3, stroke: { paint: "#4a2f1b", width: 2.4, cap: "round" }, points: [pt(x - w, y, 0, 0, w * 0.4, 9), pt(x + w, y, -w * 0.4, 9)] }, body);
    if (rnd() > 0.6) add("path", { name: "Streak", closed: false, opacity: 0.35, stroke: { paint: "#3b2414", width: 2, cap: "round" }, points: [pt(x, y + 4), pt(x + (rnd() - 0.5) * 3, y + 16)] }, body);
  }
}
const wingPts = [
  pt(-150, -500, 0, 0, -60, 10), pt(-226, -330, -10, -90, 4, 110), pt(-208, -90, 10, -60, 0, 30),
  pt(-188, -40), pt(-178, -10, 0, 0, 0, 0), pt(-160, -36), pt(-150, 0), pt(-136, -40), pt(-124, -20),
  pt(-118, -130, 2, 50, -2, -60), pt(-140, -380, 6, 80, 4, -60),
];
const wingShape = (name: string, pts: PathPoint[], parent: string, sx: number) => {
  const pivot = { x: -180 * sx, y: -470 };
  const w = group(name, { x: pivot.x, y: pivot.y }, parent);
  const rel = pts.map((p) => ({ ...p, x: p.x - pivot.x, y: p.y - pivot.y }));
  add("path", { name: `${name} feathers`, closed: true, fill: lin(0, 0, 40 * sx, 460, [0, "#6b4a2f"], [0.5, "#4f3521"], [1, "#2c1d12"]), stroke: { paint: "#24170e", width: 2 }, points: rel }, w);
  // Coverts: overlapping rounded feathers near the shoulder, then long primaries with pale notches.
  for (let r = 0; r < 3; r++)
    for (let i = 0; i < 3; i++) {
      const x = (-4 + i * 20 + r * 4) * sx, y = 40 + r * 34 + i * 6;
      add("path", { name: "Covert", closed: false, opacity: 0.6, stroke: { paint: "#2a1b10", width: 2.5, cap: "round" }, points: [pt(x - 12 * sx, y), pt(x + 12 * sx, y, -4 * sx, 12, 0, 0)] }, w);
      add("ellipse", { name: "Covert tip", width: 8, height: 5, opacity: 0.55, fill: "#e6cfa0", transform: { x: x + 4 * sx, y: y + 9 } }, w);
    }
  for (let i = 0; i < 5; i++) {
    const x = (6 + i * 10) * sx;
    add("path", { name: "Primary", closed: false, opacity: 0.55, stroke: { paint: "#1f140c", width: 2.5, cap: "round" }, points: [pt(x - 6 * sx, 170), pt(x, 430, -2 * sx, -80)] }, w);
    for (let j = 0; j < 4; j++) add("ellipse", { name: "Notch", width: 7, height: 4, opacity: 0.5, fill: "#d9bd8d", transform: { x: x + 3 * sx, y: 210 + j * 55 + i * 6, rotation: 15 * sx } }, w);
  }
  return w;
};
const wingL = wingShape("Wing left", wingPts, body, 1);
const wingR = wingShape("Wing right", mirror(wingPts), body, -1);

// Feet gripping the branch.
for (const sx of [-1, 1]) {
  const foot = group(sx < 0 ? "Foot left" : "Foot right", { x: 62 * sx, y: -6 }, owl);
  add("ellipse", { name: "Feathered leg", width: 70, height: 46, fill: rad(0, -8, 40, [0, "#e8d3a6"], [1, "#b48c5c"]), transform: { x: 0, y: -14 } }, foot);
  for (const dx of [-22, 0, 22]) {
    add("ellipse", { name: "Toe", width: 18, height: 26, fill: "#c9a46a", transform: { x: dx, y: 6 } }, foot);
    add("path", { name: "Talon", closed: true, fill: "#171210", points: [pt(dx - 6, 14), pt(dx + 6, 14, 0, 0, 2, 10), pt(dx - 2, 32, 6, 0)] }, foot);
  }
}

// ---------------- head ----------------
// Pivot at the neck so tilts look natural.
const head = group("Head", { x: 0, y: -545 }, owl);
const tufts: string[] = [];
for (const sx of [-1, 1]) {
  const tuft = group(sx < 0 ? "Ear tuft left" : "Ear tuft right", { x: 128 * sx, y: -214, rotation: -16 * sx }, head);
  for (const [dx, h, c] of [[-18, 96, "#2c1d12"], [0, 118, "#4a3220"], [16, 92, "#6b4a2f"]] as const)
    add("path", {
      name: "Tuft feather",
      closed: true,
      fill: lin(0, 0, 0, -h, [0, c], [1, "#1a110a"]),
      stroke: { paint: "#140d07", width: 1.5 },
      points: [pt((dx - 16) * sx, 0, 0, 0, -4 * sx, -h * 0.5), pt((dx - 4) * sx, -h, -6 * sx, h * 0.3, 6 * sx, h * 0.2), pt((dx + 14) * sx, 0, 6 * sx, -h * 0.5)],
    }, tuft);
  tufts.push(tuft);
}
const headPts = [pt(0, -250, -120, 0, 120, 0), pt(220, -120, -10, -90, 6, 120), pt(140, 70, 70, -60, -60, 50), pt(0, 110, 70, 0, -70, 0), pt(-140, 70, 60, 50, -70, -60), pt(-220, -120, -6, 120, 10, -90)];
add("path", { name: "Head shape", closed: true, fill: lin(0, -250, 0, 110, [0, "#5e4029"], [0.5, "#7d5737"], [1, "#9a7247"]), stroke: { paint: "#2a1b10", width: 2 }, points: headPts }, head);
for (let i = 0; i < 26; i++) {
  const a = -Math.PI * (0.1 + 0.8 * rnd());
  const r = 150 + rnd() * 60;
  const x = Math.cos(a) * r, y = -90 + Math.sin(a) * r * 0.75;
  add("path", { name: "Head feather", closed: false, opacity: 0.45, stroke: { paint: "#3a2616", width: 2.5, cap: "round" }, points: [pt(x - 8, y, 0, 0, 4, 6), pt(x + 8, y + 2, -4, 6)] }, head);
}
// Facial disc: dark rims behind two lighter lobes.
for (const sx of [-1, 1]) add("ellipse", { name: "Disc rim", width: 236, height: 258, fill: "#2e1d11", transform: { x: 86 * sx, y: -84, rotation: -8 * sx } }, head);
for (const sx of [-1, 1])
  add("ellipse", { name: "Facial disc", width: 216, height: 238, fill: rad(-20 * sx, 30, 140, [0, "#e3c08b"], [0.55, "#c3965f"], [1, "#8c6239"]), transform: { x: 86 * sx, y: -84, rotation: -8 * sx } }, head);
for (let i = 0; i < 16; i++) {
  const sx = i % 2 ? 1 : -1;
  const a = (i / 16) * Math.PI * 2;
  const x = 86 * sx + Math.cos(a) * 70, y = -70 + Math.sin(a) * 78;
  add("path", { name: "Disc feather", closed: false, opacity: 0.35, stroke: { paint: "#6b4526", width: 2, cap: "round" }, points: [pt(86 * sx + Math.cos(a) * 40, -70 + Math.sin(a) * 46), pt(x, y)] }, head);
}

const eyes: { eye: string; pupil: string; lid: string }[] = [];
for (const sx of [-1, 1]) {
  const eye = group(sx < 0 ? "Eye left" : "Eye right", { x: 84 * sx, y: -96 }, head);
  add("ellipse", { name: "Eye socket", width: 132, height: 132, fill: "#140d08" }, eye);
  add("ellipse", { name: "Iris", width: 112, height: 112, fill: rad(0, -8, 60, [0, "#ffe27a"], [0.45, "#ffb02e"], [0.85, "#e8740f"], [1, "#9a4300"]) }, eye);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    add("path", { name: "Iris fiber", closed: false, opacity: 0.25, stroke: { paint: "#a2520a", width: 1.5 }, points: [pt(Math.cos(a) * 28, Math.sin(a) * 28), pt(Math.cos(a) * 52, Math.sin(a) * 52)] }, eye);
  }
  const pupil = add("ellipse", { name: "Pupil", width: 52, height: 52, fill: "#050304" }, eye);
  add("ellipse", { name: "Highlight", width: 22, height: 18, fill: "#ffffffee", transform: { x: -16, y: -20, rotation: -20 } }, eye);
  add("ellipse", { name: "Highlight small", width: 8, height: 8, fill: "#ffffffbb", transform: { x: 16, y: 14 } }, eye);
  // Eyelid scales down from its top edge to blink.
  const lid = add("ellipse", {
    name: "Eyelid",
    width: 140,
    height: 140,
    fill: lin(0, -70, 0, 70, [0, "#6b4a2f"], [1, "#8c6640"]),
    stroke: { paint: "#2a1b10", width: 3 },
    transform: { x: 0, y: -70, originX: 0, originY: -70, scaleY: 0.02 },
  }, eye);
  eyes.push({ eye, pupil, lid });
}
// Pale "eyebrows" and whiskers around the beak.
for (const sx of [-1, 1]) {
  add("path", { name: "Brow", closed: true, fill: "#efe2c4", opacity: 0.9, points: [pt(-12 * sx, -158), pt(-150 * sx, -178, 70 * sx, -16, -10 * sx, 8), pt(-140 * sx, -168, 0, 0, 70 * sx, -10), pt(-8 * sx, -142, -30 * sx, -6)] }, head);
  for (let i = 0; i < 4; i++)
    add("path", { name: "Whisker", closed: false, opacity: 0.35, stroke: { paint: "#f2e6cc", width: 1.6, cap: "round" }, points: [pt(-10 * sx, -40 + i * 10), pt(-46 * sx - i * 4, -24 + i * 14, 16 * sx, -4)] }, head);
}
add("path", { name: "Beak", closed: true, fill: lin(0, -60, 0, 40, [0, "#5a5149"], [0.6, "#2b2420"], [1, "#120e0c"]), points: [pt(0, -66, -14, 0, 14, 0), pt(26, -30, 0, -14, -2, 18), pt(0, 38, 8, -6), pt(-26, -30, 2, 18, 0, -14)] }, head);
add("path", { name: "Beak shine", closed: false, opacity: 0.5, stroke: { paint: "#a59a8e", width: 3, cap: "round" }, points: [pt(-8, -52, 0, 0, -6, 18), pt(-6, -6)] }, head);
add("ellipse", { name: "Chin", width: 120, height: 50, fill: rad(0, 0, 60, [0, "#e9d4aa"], [1, "#e9d4aa00"]), transform: { x: 0, y: 60 } }, head);

// ---------------- animation ----------------
ed.execute("anim.new", { name: "Idle", duration: 6, loop: "loop" });
const key = (nodeId: string, prop: string, frames: [number, unknown, string?][]) => {
  for (const [time, value, ease] of frames) ed.execute("keyframe.set", { nodeId, prop, time, value, ease: ease ?? "easeInOut" });
};
// Breathing: the body swells slightly from the feet.
key(body, "transform.scaleY", [[0, 1], [1.5, 1.022], [3, 1], [4.5, 1.022], [6, 1]]);
key(body, "transform.scaleX", [[0, 1], [1.5, 1.01], [3, 1], [4.5, 1.01], [6, 1]]);
key(head, "transform.y", [[0, -545], [1.5, -556], [3, -545], [4.5, -556], [6, -545]]);
// Head: look left, hold, quick owl-like turn right with a slight overshoot, back to centre.
key(head, "transform.rotation", [[0, 0], [0.7, -11, "easeOut"], [2.0, -11], [2.35, 9, "backOut"], [3.8, 9], [4.4, 0, "easeOut"], [6, 0]]);
key(head, "transform.x", [[0, 0], [0.7, -10, "easeOut"], [2.0, -10], [2.35, 8, "backOut"], [3.8, 8], [4.4, 0], [6, 0]]);
// Ear tufts lag behind the head.
for (const [i, t] of tufts.entries()) {
  const s = i === 0 ? -1 : 1;
  key(t, "transform.rotation", [[0, 0], [0.9, -6], [2.15, -6], [2.6, 7 * s + 4, "backOut"], [4.0, 4], [4.7, -2], [5.2, 0], [6, 0]]);
}
for (const { pupil, lid } of eyes) {
  // Eyes follow the look direction; pupils dilate while staring at the moon.
  key(pupil, "transform.x", [[0, 0], [0.7, -12, "easeOut"], [2.0, -12], [2.3, 12, "easeOut"], [3.8, 12], [4.4, 0], [6, 0]]);
  key(pupil, "transform.y", [[0, 0], [2.3, -6], [3.8, -6], [4.4, 0], [6, 0]]);
  key(pupil, "width", [[0, 52], [2.4, 52], [3.0, 70], [3.8, 70], [4.6, 52], [6, 52]]);
  key(pupil, "height", [[0, 52], [2.4, 52], [3.0, 70], [3.8, 70], [4.6, 52], [6, 52]]);
  // Slow blink, then a quick double blink.
  key(lid, "transform.scaleY", [[0, 0.02], [1.2, 0.02, "easeIn"], [1.32, 1, "easeOut"], [1.5, 0.02], [4.9, 0.02, "easeIn"], [4.98, 1, "easeOut"], [5.08, 0.02, "easeIn"], [5.16, 1, "easeOut"], [5.28, 0.02], [6, 0.02]]);
}
// Wing ruffle.
key(wingL, "transform.rotation", [[0, 0], [3.0, 0], [3.15, 4, "easeOut"], [3.35, -1.5], [3.6, 0], [6, 0]]);
key(wingR, "transform.rotation", [[0, 0], [3.0, 0], [3.15, -4, "easeOut"], [3.35, 1.5], [3.6, 0], [6, 0]]);
// Sky: moon glow pulse, twinkling stars, leaves swaying.
key(glow, "transform.scaleX", [[0, 1], [3, 1.08], [6, 1]]);
key(glow, "transform.scaleY", [[0, 1], [3, 1.08], [6, 1]]);
stars.forEach((s, i) => {
  if (i % 3) return;
  const o = 0.3 + rnd() * 0.6;
  const t0 = rnd() * 3;
  key(s, "opacity", [[0, o], [t0 + 0.6, 0.1], [t0 + 1.4, o], [6, o]]);
});
leaves.forEach((l, i) => {
  const r0 = Number((ed.doc.nodes[l]!.transform as { rotation: number }).rotation);
  key(l, "transform.rotation", [[0, r0], [2 + i * 0.3, r0 + 7], [4 + i * 0.2, r0 - 4], [6, r0]]);
});

ed.execute("select.set", { ids: [] });
const out = new URL("./owl.anima", import.meta.url);
writeFileSync(out, JSON.stringify(ed.doc, null, 2) + "\n");
const nodes = Object.keys(ed.doc.nodes).length;
const tracks = ed.doc.animations[0]!.tracks.length;
console.log(JSON.stringify({ file: out.pathname, nodes, tracks }));
