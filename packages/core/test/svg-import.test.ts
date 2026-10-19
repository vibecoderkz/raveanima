import { describe, expect, it } from "vitest";
import { parseSvg, type SvgContour, type SvgNode } from "../src/svg-import.js";

type PathN = Extract<SvgNode, { kind: "path" }>;

const svg = (body: string, attrs = 'viewBox="0 0 200 200"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

function paths(nodes: SvgNode[]): PathN[] {
  return nodes.flatMap((n) => (n.kind === "path" ? [n] : paths(n.children)));
}

function firstPath(src: string): PathN {
  const p = paths(parseSvg(src).nodes)[0];
  if (!p) throw new Error("no path");
  return p;
}

const xy = (c: SvgContour) => c.points.map((p) => [p.x, p.y]);

/** Cubic segment i of a contour evaluated at t. */
function segAt(c: SvgContour, i: number, t: number): [number, number] {
  const a = c.points[i];
  const b = c.points[(i + 1) % c.points.length];
  const u = 1 - t;
  const f = (p0: number, p1: number, p2: number, p3: number) => u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  return [f(a.x, a.x + a.outX, b.x + b.inX, b.x), f(a.y, a.y + a.outY, b.y + b.inY, b.y)];
}

describe("svg import: document", () => {
  it("throws only without an <svg> root", () => {
    expect(() => parseSvg("<html><body/></html>")).toThrow("Not an SVG document");
    expect(() => parseSvg("garbage")).toThrow("Not an SVG document");
    expect(() => parseSvg("<svg><path d='M0 0 L')")).not.toThrow();
  });

  it("reports size and viewBox with defaults", () => {
    expect(parseSvg('<svg width="100" height="50" viewBox="0 0 10 5"/>')).toMatchObject({ width: 100, height: 50, viewBox: [0, 0, 10, 5] });
    expect(parseSvg('<svg viewBox="5 5 40 30"/>')).toMatchObject({ width: 40, height: 30, viewBox: [5, 5, 40, 30] });
    expect(parseSvg('<svg width="64px" height="32"/>')).toMatchObject({ width: 64, height: 32, viewBox: [0, 0, 64, 32] });
    expect(parseSvg("<svg/>")).toMatchObject({ width: 300, height: 150, viewBox: [0, 0, 300, 150] });
  });

  it("handles XML prolog, doctype entities, comments and CDATA styles", () => {
    const src = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY red "#ff0000">]><!-- hi -->
      <svg:svg xmlns:svg="http://www.w3.org/2000/svg"><style><![CDATA[ .b { stroke: blue } ]]></style>
      <svg:rect class="b" fill="&red;" width="1" height="1"/></svg:svg>`;
    const p = firstPath(src);
    expect(p.fill).toEqual({ type: "solid", color: "#ff0000" });
    expect(p.stroke?.paint).toEqual({ type: "solid", color: "#0000ff" });
  });
});

describe("svg import: geometry", () => {
  it("bakes translate + rotate into rect corners", () => {
    const p = firstPath(svg('<rect id="box" x="0" y="0" width="20" height="10" transform="translate(100 50) rotate(90)"/>'));
    expect(p.name).toBe("box");
    expect(p.contours).toHaveLength(1);
    expect(p.contours[0].closed).toBe(true);
    expect(xy(p.contours[0])).toEqual([
      [100, 50],
      [100, 70],
      [90, 70],
      [90, 50],
    ]);
  });

  it("bakes nested group transforms, scales handles and stroke width", () => {
    const p = firstPath(svg('<g transform="scale(2)"><g transform="translate(10,0)"><path d="M0 0 C1 0 2 1 2 2" stroke="red" stroke-width="3"/></g></g>'));
    const [a, b] = p.contours[0].points;
    expect([a.x, a.y, a.outX, a.outY]).toEqual([20, 0, 2, 0]);
    expect([b.x, b.y, b.inX, b.inY]).toEqual([24, 4, 0, -2]);
    expect(p.stroke?.width).toBe(6);
  });

  it("converts a circle to 4 points with kappa handles", () => {
    const p = firstPath(svg('<circle cx="50" cy="50" r="10"/>'));
    const c = p.contours[0];
    expect(c.closed).toBe(true);
    expect(xy(c)).toEqual([
      [60, 50],
      [50, 60],
      [40, 50],
      [50, 40],
    ]);
    for (const q of c.points) {
      expect(Math.hypot(q.inX, q.inY)).toBeCloseTo(5.522847498, 8);
      expect(Math.hypot(q.outX, q.outY)).toBeCloseTo(5.522847498, 8);
      expect(q.inX + q.outX).toBeCloseTo(0, 12); // smooth tangent
    }
    expect(p.name).toBe("circle");
  });

  it("rounded rect: 8 points, degenerating to 4 when rx = w/2", () => {
    const a = firstPath(svg('<rect width="100" height="50" rx="10"/>')).contours[0];
    expect(a.points).toHaveLength(8);
    expect(a.points[0]).toMatchObject({ x: 10, y: 0 });
    expect(a.points[0].inX).toBeCloseTo(-10 * 0.5522847498, 9);
    const pill = firstPath(svg('<rect width="100" height="40" rx="20"/>')).contours[0];
    expect(pill.points).toHaveLength(6); // ry = h/2: the vertical sides vanish
    const disc = firstPath(svg('<rect width="40" height="40" rx="20"/>')).contours[0];
    expect(disc.points).toHaveLength(4);
  });

  it("parses relative commands and implicit linetos", () => {
    const p = firstPath(svg('<path d="m10 10 10 0 10 10 h-20 z m5 5 l1 0 0 1z"/>'));
    expect(p.contours).toHaveLength(2);
    expect(xy(p.contours[0])).toEqual([
      [10, 10],
      [20, 10],
      [30, 20],
      [10, 20],
    ]);
    expect(p.contours[0].closed).toBe(true);
    // a moveto after Z is relative to the subpath start
    expect(xy(p.contours[1])).toEqual([
      [15, 15],
      [16, 15],
      [16, 16],
    ]);
  });

  it("starts a new contour at the subpath start when drawing continues after Z", () => {
    const p = firstPath(svg('<path d="M0 0 L10 0 L10 10 Z L0 20"/>'));
    expect(p.contours).toHaveLength(2);
    expect(xy(p.contours[1])).toEqual([
      [0, 0],
      [0, 20],
    ]);
    expect(p.contours[1].closed).toBe(false);
  });

  it("merges an explicit closing segment into the first point", () => {
    const p = firstPath(svg('<path d="M0 0 L10 0 C10 5 5 10 0 0 Z"/>'));
    const c = p.contours[0];
    expect(c.points).toHaveLength(2);
    expect([c.points[0].inX, c.points[0].inY]).toEqual([5, 10]);
  });

  it("reflects control points for S and T", () => {
    const s = firstPath(svg('<path d="M0 0 C10 0 20 10 30 10 S50 20 60 20"/>')).contours[0];
    expect([s.points[1].outX, s.points[1].outY]).toEqual([10, 0]);
    expect([s.points[2].inX, s.points[2].inY]).toEqual([-10, 0]);
    // S without a preceding C uses the current point as the first control point
    const s2 = firstPath(svg('<path d="M0 0 S10 10 20 0"/>')).contours[0];
    expect([s2.points[0].outX, s2.points[0].outY]).toEqual([0, 0]);

    const t = firstPath(svg('<path d="M0 0 Q10 10 20 0 T40 0"/>')).contours[0];
    expect(t.points[0].outX).toBeCloseTo(20 / 3, 12);
    expect(t.points[0].outY).toBeCloseTo(20 / 3, 12);
    expect(t.points[1].outX).toBeCloseTo(20 / 3, 12); // reflected control (30,-10)
    expect(t.points[1].outY).toBeCloseTo(-20 / 3, 12);
    expect(t.points[2].inX).toBeCloseTo(-20 / 3, 12);
    expect(t.points[2].inY).toBeCloseTo(-20 / 3, 12);
  });

  it("converts elliptical arcs accurately", () => {
    const rx = 50;
    const ry = 25;
    const phi = (30 * Math.PI) / 180;
    const onEllipse = (x: number, y: number) => {
      const u = x * Math.cos(phi) + y * Math.sin(phi);
      const v = -x * Math.sin(phi) + y * Math.cos(phi);
      return (u / rx) ** 2 + (v / ry) ** 2;
    };
    const start = [rx * Math.cos(phi), rx * Math.sin(phi)];
    const end = [-ry * Math.sin(phi), ry * Math.cos(phi)];
    for (const [flags, segs] of [
      ["0 1", 1],
      ["1 0", 3],
    ] as const) {
      const c = firstPath(svg(`<path d="M${start[0]} ${start[1]} A${rx} ${ry} 30 ${flags} ${end[0]} ${end[1]}"/>`)).contours[0];
      expect(c.points).toHaveLength(segs + 1);
      const last = c.points[c.points.length - 1];
      expect(Math.abs(last.x - end[0])).toBeLessThan(1e-6);
      expect(Math.abs(last.y - end[1])).toBeLessThan(1e-6);
      for (let i = 0; i < segs; i++) {
        const [mx, my] = segAt(c, i, 0.5);
        expect(Math.abs(onEllipse(mx, my) - 1)).toBeLessThan(1e-3);
      }
    }
  });

  it("scales up radii that are too small and handles compact arc flags", () => {
    const c = firstPath(svg('<path d="M0 0a1 1 0 0010 0"/>')).contours[0];
    const last = c.points[c.points.length - 1];
    expect([last.x, last.y]).toEqual([10, 0]);
    const [mx, my] = segAt(c, 0, 1);
    expect(Math.hypot(mx - 5, my)).toBeCloseTo(5, 6);
    // sweep 0 (counter-clockwise on screen) from (0,0) to (10,0) passes through (5,5)
    expect(c.points).toHaveLength(3);
    expect(c.points[1].x).toBeCloseTo(5, 9);
    expect(c.points[1].y).toBeCloseTo(5, 9);
  });

  it("tolerates compact/malformed number sequences", () => {
    const c = firstPath(svg('<path d="M10-20L.5.5"/>')).contours[0];
    expect(xy(c)).toEqual([
      [10, -20],
      [0.5, 0.5],
    ]);
    const e = firstPath(svg('<path d="M1e1,2E-1l-1-2"/>')).contours[0];
    expect(xy(e)[0]).toEqual([10, 0.2]);
    expect(xy(e)[1][0]).toBeCloseTo(9, 12);
    const r = parseSvg(svg('<path d="M0 0 L10 10 L20 x30"/>'));
    expect(paths(r.nodes)[0].contours[0].points).toHaveLength(2);
    expect(r.warnings.some((w) => /Malformed path/.test(w))).toBe(true);
  });

  it("supports line, polyline and polygon", () => {
    const r = parseSvg(svg('<line x1="1" y1="2" x2="3" y2="4" stroke="#000"/><polyline points="0,0 10,0 10,10"/><polygon points="0 0 10 0 10 10 0 0"/>'));
    const [l, pl, pg] = paths(r.nodes);
    expect(xy(l.contours[0])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(pl.contours[0].closed).toBe(false);
    expect(pg.contours[0].closed).toBe(true);
    expect(pg.contours[0].points).toHaveLength(3);
  });

  it("evenodd donut keeps both contours", () => {
    const p = firstPath(svg('<path fill-rule="evenodd" d="M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z M25 50 A25 25 0 1 0 75 50 A25 25 0 1 0 25 50 Z"/>'));
    expect(p.fillRule).toBe("evenodd");
    expect(p.contours).toHaveLength(2);
    expect(p.contours.every((c) => c.closed)).toBe(true);
    expect(p.contours[0].points).toHaveLength(4); // closing arc merged into the start point
    expect(p.contours[1].points[0]).toMatchObject({ x: 25, y: 50 });
  });
});

describe("svg import: structure", () => {
  it("clones <use> elements with x/y offset", () => {
    const r = parseSvg(svg('<defs><rect id="r" width="10" height="10" fill="red"/></defs><use id="copy" href="#r" x="5" y="7"/><use xlink:href="#r" x="20"/>'));
    expect(r.nodes).toHaveLength(2);
    expect(r.nodes[0]).toMatchObject({ kind: "group", name: "copy" });
    const [a, b] = paths(r.nodes);
    expect(xy(a.contours[0])[0]).toEqual([5, 7]);
    expect(xy(b.contours[0])[0]).toEqual([20, 0]);
    expect(a.fill).toEqual({ type: "solid", color: "#ff0000" });
  });

  it("<use> inherits style from the use element and survives cycles", () => {
    const r = parseSvg(svg('<symbol id="s"><circle r="5"/></symbol><use href="#s" fill="lime"/><g id="loop"><use href="#loop"/></g>'));
    const ps = paths(r.nodes);
    expect(ps).toHaveLength(1);
    expect(ps[0].fill).toEqual({ type: "solid", color: "#00ff00" });
    expect(r.warnings.some((w) => /Circular/.test(w))).toBe(true);
  });

  it("offsets nested svg content by its x/y", () => {
    const r = parseSvg(svg('<svg x="10" y="20"><rect width="5" height="5"/></svg>'));
    expect(xy(paths(r.nodes)[0].contours[0])[0]).toEqual([10, 20]);
    // nested viewBox scales into the viewport
    const s = parseSvg(svg('<svg x="10" y="0" width="20" height="20" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'));
    expect(xy(paths(s.nodes)[0].contours[0])[2]).toEqual([30, 20]);
  });

  it("names nodes by id, inkscape:label, then tag; drops empties and hidden", () => {
    const r = parseSvg(
      svg(
        '<g inkscape:label="Layer 1"><path d="M0 0 L1 1"/><g/></g><rect width="0" height="5"/>' +
          '<rect display="none" width="5" height="5"/><g style="display:none"><rect width="5" height="5"/></g>' +
          '<g visibility="hidden"><rect width="5" height="5"/><rect visibility="visible" id="shown" width="5" height="5"/></g>' +
          "<title>t</title><desc>d</desc><metadata/><clipPath><rect width='1' height='1'/></clipPath>",
      ),
    );
    expect(r.nodes.map((n) => n.name)).toEqual(["Layer 1", "g"]);
    expect((r.nodes[0] as { children: SvgNode[] }).children.map((n) => n.name)).toEqual(["path"]);
    expect(paths([r.nodes[1]]).map((n) => n.name)).toEqual(["shown"]);
  });

  it("puts opacity on the node rather than inheriting it", () => {
    const r = parseSvg(svg('<g opacity="0.5"><rect opacity="50%" width="1" height="1"/><rect width="1" height="1"/></g>'));
    expect(r.nodes[0].opacity).toBe(0.5);
    expect(paths(r.nodes).map((p) => p.opacity)).toEqual([0.5, 1]);
  });
});

describe("svg import: styling", () => {
  it("applies <style> classes and inherits from groups", () => {
    const p = firstPath(
      svg(
        '<style>.a, #other { fill: #00f } rect { fill: green } g.wrap { stroke-linejoin: round }</style>' +
          '<g class="wrap" stroke="red" stroke-width="2" stroke-linecap="square"><rect class="a" width="5" height="5"/></g>',
      ),
    );
    expect(p.fill).toEqual({ type: "solid", color: "#0000ff" }); // class beats tag selector
    expect(p.stroke).toEqual({ paint: { type: "solid", color: "#ff0000" }, width: 2, join: "round", cap: "square" });
  });

  it("orders presentation attribute < stylesheet < style attribute", () => {
    const p = firstPath(svg('<style>path { fill: blue }</style><path fill="red" style="stroke: #123; stroke-width: 4px" d="M0 0 L1 1"/>'));
    expect(p.fill).toEqual({ type: "solid", color: "#0000ff" });
    expect(p.stroke?.paint).toEqual({ type: "solid", color: "#112233" });
    const q = firstPath(svg('<style>path { fill: blue }</style><path style="fill:red" d="M0 0 L1 1"/>'));
    expect(q.fill).toEqual({ type: "solid", color: "#ff0000" });
  });

  it("folds fill-opacity and stroke-opacity into colour alpha", () => {
    const p = firstPath(svg('<g fill-opacity="0.5"><rect fill="#ff0000" stroke="rgba(0,0,255,0.5)" stroke-opacity="0.5" width="1" height="1"/></g>'));
    expect(p.fill).toEqual({ type: "solid", color: "#ff000080" });
    expect(p.stroke?.paint).toEqual({ type: "solid", color: "#0000ff40" });
  });

  it("parses colour syntaxes", () => {
    const fills = paths(
      parseSvg(
        svg(
          ["#abc", "#abcd", "rgb(100%, 0%, 0%)", "rgb(0 128 255 / 50%)", "hsl(120, 100%, 50%)", "hsla(240deg 100% 50% / 0.25)", "Tomato", "transparent", "none", "currentColor"]
            .map((f) => `<rect fill="${f}" color="#010203" width="1" height="1"/>`)
            .join(""),
        ),
      ).nodes,
    ).map((p) => (p.fill.type === "solid" ? p.fill.color : p.fill.type));
    expect(fills).toEqual(["#aabbcc", "#aabbccdd", "#ff0000", "#0080ff80", "#00ff00", "#0000ff40", "#ff6347", "#00000000", "none", "#010203"]);
  });

  it("defaults to black fill and no stroke", () => {
    const p = firstPath(svg('<path d="M0 0 L5 5"/>'));
    expect(p.fill).toEqual({ type: "solid", color: "#000000" });
    expect(p.stroke).toBeNull();
    expect(p.fillRule).toBe("nonzero");
  });
});

describe("svg import: gradients", () => {
  it("converts objectBoundingBox linear gradients to user space", () => {
    const p = firstPath(
      svg(
        '<defs><linearGradient id="base"><stop offset="0" stop-color="red"/><stop offset="100%" stop-color="blue" stop-opacity=".5"/></linearGradient>' +
          '<linearGradient id="g" href="#base" x2="0" y2="1"/></defs>' +
          '<rect x="10" y="20" width="100" height="50" fill="url(#g)" transform="translate(5 5)"/>',
      ),
    );
    expect(p.fill).toEqual({
      type: "linear",
      from: { x: 15, y: 25 },
      to: { x: 15, y: 75 },
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff80" },
      ],
    });
  });

  it("supports userSpaceOnUse radial gradients with gradientTransform", () => {
    const p = firstPath(
      svg(
        '<radialGradient id="r" gradientUnits="userSpaceOnUse" cx="10" cy="10" r="5" gradientTransform="scale(2)">' +
          '<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>' +
          '<circle cx="20" cy="20" r="10" fill="url(#r)" transform="translate(1 1)"/>',
      ),
    );
    expect(p.fill).toMatchObject({ type: "radial", center: { x: 21, y: 21 }, radius: 10 });
  });

  it("falls back for patterns and missing references with a warning", () => {
    const r = parseSvg(svg('<pattern id="p"/><rect fill="url(#p)" width="1" height="1"/><rect fill="url(#nope) green" width="1" height="1"/>'));
    const [a, b] = paths(r.nodes);
    expect(a.fill).toEqual({ type: "solid", color: "#000000" });
    expect(b.fill).toEqual({ type: "solid", color: "#008000" });
    expect(r.warnings.some((w) => /pattern/.test(w))).toBe(true);
  });
});
