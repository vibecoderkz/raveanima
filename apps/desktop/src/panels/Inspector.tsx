import { isColor, type AnimaNode, type Paint } from "@raveanima/core";
import { currentValue, editor, editProp, getUi, run, setUi, trackInfo, useStore, viewDoc } from "../store";
import { Diamond, Icon } from "../icons";

const fmt = (v: number) => String(Math.round(v * 100) / 100);

/** Tiny arithmetic evaluator for number fields ("120*2", "(10+5)/3"). No eval, so the CSP stays strict. */
function calc(src: string): number {
  const s = src.replace(/\s+/g, "");
  let i = 0;
  const num = (): number => {
    if (s[i] === "-") return i++, -num();
    if (s[i] === "(") {
      i++;
      const v = expr();
      if (s[i++] !== ")") throw new Error("paren");
      return v;
    }
    const m = /^\d*\.?\d+(e[-+]?\d+)?/i.exec(s.slice(i));
    if (!m) throw new Error("number");
    i += m[0].length;
    return Number(m[0]);
  };
  const term = (): number => {
    let v = num();
    while (s[i] === "*" || s[i] === "/") v = s[i++] === "*" ? v * num() : v / num();
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (s[i] === "+" || s[i] === "-") v = s[i++] === "+" ? v + term() : v - term();
    return v;
  };
  const v = expr();
  if (i !== s.length) throw new Error("trailing");
  return v;
}

function KeyButton({ nodeId, prop }: { nodeId: string; prop: string }) {
  const doc = editor.doc;
  if (!doc.activeAnimation) return <span style={{ width: 22 }} />;
  const { hasTrack, keyHere } = trackInfo(nodeId, prop);
  return (
    <button
      className={`keybtn ${keyHere ? "on" : hasTrack ? "track" : ""}`}
      title={keyHere ? "Remove keyframe" : "Add keyframe at playhead (K)"}
      onClick={() => {
        const time = +editor.state.time.toFixed(4);
        if (keyHere) run("keyframe.delete", { nodeId, prop, time });
        else run("keyframe.set", { nodeId, prop, time, value: currentValue(nodeId, prop) });
      }}
    >
      <Diamond />
    </button>
  );
}

function NumField({ label, nodeId, prop, step = 1, min, max, title }: { label: string; nodeId: string; prop: string; step?: number; min?: number; max?: number; title?: string }) {
  const value = Number(currentValue(nodeId, prop) ?? 0);
  const keyed = trackInfo(nodeId, prop).hasTrack && getUi().mode === "animate";
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (raw: string) => {
    // Small expressions like "100*2" or "+20" are handy when typing numbers.
    const s = raw.trim().startsWith("+") || raw.trim().startsWith("*") ? `${value}${raw}` : raw;
    let v = NaN;
    try {
      v = calc(s);
    } catch {
      /* not a number: ignore */
    }
    if (Number.isFinite(v) && v !== value) editProp(nodeId, prop, clamp(v));
  };
  const scrub = (e: React.PointerEvent) => {
    const x0 = e.clientX;
    const v0 = value;
    const key = `scrub-${prop}-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const d = Math.round((ev.clientX - x0) / 2) * step * (ev.shiftKey ? 10 : 1);
      editProp(nodeId, prop, clamp(Math.round((v0 + d) * 1000) / 1000), key);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className={`field ${keyed ? "keyed" : ""}`} title={title}>
      <label onPointerDown={scrub}>{label}</label>
      <input
        key={`${nodeId}-${prop}-${value}`}
        defaultValue={fmt(value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            editProp(nodeId, prop, clamp(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
          }
        }}
      />
    </div>
  );
}

function ColorField({ value, onChange, keyed }: { value: string; onChange: (c: string, key?: string) => void; keyed?: boolean }) {
  const hex6 = value.slice(0, 7);
  return (
    <>
      <div className="swatch">
        <i style={{ background: value }} />
        <input type="color" value={hex6} onChange={(e) => onChange(e.target.value + value.slice(7), "color-drag")} />
      </div>
      <div className={`field ${keyed ? "keyed" : ""}`}>
        <input
          key={value}
          defaultValue={value.toUpperCase()}
          style={{ paddingLeft: 9 }}
          onBlur={(e) => {
            let v = e.target.value.trim();
            if (!v.startsWith("#")) v = `#${v}`;
            if (isColor(v) && v.toLowerCase() !== value.toLowerCase()) onChange(v.toLowerCase());
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
    </>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="row">{children}</div>;
}

function PaintEditor({ node, which }: { node: AnimaNode; which: "fill" | "stroke" }) {
  const paint: Paint = which === "fill" ? node.fill : node.stroke?.paint ?? { type: "none" };
  const colorProp = which === "fill" ? "fill.color" : "stroke.paint.color";
  const setPaint = (p: Paint | string | null) =>
    run("node.update", { id: node.id, props: which === "fill" ? { fill: p } : { stroke: p === null ? null : { paint: p } } });
  const setType = (t: string) => {
    const base = paint.type === "solid" ? paint.color : paint.type === "linear" || paint.type === "radial" ? paint.stops[0]!.color : "#ff3b2e";
    const size = node.type === "rect" || node.type === "ellipse" || node.type === "image" ? Math.max(node.width, node.height) / 2 : node.type === "polygon" || node.type === "star" ? node.radius : node.type === "text" ? node.fontSize * 2 : 100;
    if (t === "none") setPaint(which === "stroke" ? null : { type: "none" });
    else if (t === "solid") setPaint(base);
    else if (t === "linear") setPaint({ type: "linear", from: { x: -size, y: 0 }, to: { x: size, y: 0 }, stops: [{ offset: 0, color: base }, { offset: 1, color: "#0a0a0b" }] });
    else setPaint({ type: "radial", center: { x: 0, y: 0 }, radius: size, stops: [{ offset: 0, color: base }, { offset: 1, color: "#0a0a0b" }] });
  };
  const keyed = trackInfo(node.id, colorProp).hasTrack && getUi().mode === "animate";
  const live = currentValue(node.id, colorProp);
  return (
    <>
      <Row>
        <select className="sel" style={{ flex: 1 }} value={paint.type} onChange={(e) => setType(e.target.value)}>
          <option value="none">None</option>
          <option value="solid">Solid</option>
          <option value="linear">Linear gradient</option>
          <option value="radial">Radial gradient</option>
        </select>
      </Row>
      {paint.type === "solid" && (
        <Row>
          <ColorField value={typeof live === "string" ? live : paint.color} keyed={keyed} onChange={(c, k) => editProp(node.id, colorProp, c, k ? `${k}-${node.id}` : undefined)} />
          <KeyButton nodeId={node.id} prop={colorProp} />
        </Row>
      )}
      {(paint.type === "linear" || paint.type === "radial") &&
        paint.stops.map((s, i) => (
          <Row key={i}>
            <ColorField
              value={s.color}
              onChange={(c) => {
                const stops = paint.stops.map((x, j) => (j === i ? { ...x, color: c } : x));
                setPaint({ ...paint, stops });
              }}
            />
            <span style={{ color: "var(--faint)", width: 34, textAlign: "right" }}>{Math.round(s.offset * 100)}%</span>
          </Row>
        ))}
    </>
  );
}

export function Inspector() {
  useStore();
  const doc = editor.doc;
  const sel = editor.state.selection.filter((id) => doc.nodes[id]);
  if (sel.length === 0) return <DocInspector />;
  if (sel.length > 1)
    return (
      <aside className="panel right">
        <div className="doc-title">{sel.length} layers</div>
        <div className="doc-sub">Move them together on the canvas, or group them.</div>
        <div className="sec">
          <Row>
            <button className="pill" onClick={() => run("node.group", { ids: sel })}>
              <Icon name="group" /> Group
            </button>
            <button className="pill" onClick={() => run("node.duplicate", { ids: sel })}>
              Duplicate
            </button>
            <button className="pill ghost" onClick={() => run("node.delete", { ids: sel })}>
              <Icon name="trash" />
            </button>
          </Row>
        </div>
        <AlignSection ids={sel} />
      </aside>
    );
  const node = viewDoc().nodes[sel[0]!] ?? doc.nodes[sel[0]!]!;
  const restNode = doc.nodes[node.id]!;
  const F = (label: string, prop: string, o: { step?: number; min?: number; max?: number; title?: string } = {}) => (
    <Row>
      <NumField label={label} nodeId={node.id} prop={prop} {...o} />
      <KeyButton nodeId={node.id} prop={prop} />
    </Row>
  );
  const Pair = (a: [string, string], b: [string, string], o: { step?: number; min?: number } = {}) => (
    <div className="grid2" style={{ marginTop: 6, gridTemplateColumns: "1fr 1fr 22px 22px", alignItems: "center" }}>
      <NumField label={a[0]} nodeId={node.id} prop={a[1]} {...o} />
      <NumField label={b[0]} nodeId={node.id} prop={b[1]} {...o} />
      <KeyButton nodeId={node.id} prop={a[1]} />
      <KeyButton nodeId={node.id} prop={b[1]} />
    </div>
  );
  return (
    <aside className="panel right">
      <div className="doc-title" style={{ fontSize: 18 }}>{restNode.name}</div>
      <div className="doc-sub">
        {restNode.type} <span style={{ color: "var(--faint)" }}>{restNode.id}</span>
      </div>
      <div className="sec">
        <div className="h" style={{ padding: "4px 0 2px" }}>Transform</div>
        {Pair(["X", "transform.x"], ["Y", "transform.y"])}
        {Pair(["SX", "transform.scaleX"], ["SY", "transform.scaleY"], { step: 0.01 })}
        {F("R°", "transform.rotation")}
        {Pair(["OX", "transform.originX"], ["OY", "transform.originY"])}
      </div>
      {(restNode.type === "rect" || restNode.type === "ellipse" || restNode.type === "polygon" || restNode.type === "star") && (
        <div className="sec">
          <div className="h" style={{ padding: "12px 0 2px" }}>
            Shape
            <button title="Convert to an editable path" onClick={() => run("node.convertToPath", { id: node.id })}>
              <Icon name="pen" size={14} />
            </button>
          </div>
          {(restNode.type === "rect" || restNode.type === "ellipse") && Pair(["W", "width"], ["H", "height"], { min: 0 })}
          {restNode.type === "rect" && F("Radius", "cornerRadius", { min: 0 })}
          {(restNode.type === "polygon" || restNode.type === "star") && F("Radius", "radius", { min: 0 })}
          {restNode.type === "star" && F("Inner", "innerRadius", { min: 0 })}
          {restNode.type === "polygon" && (
            <Row>
              <NumField label="Sides" nodeId={node.id} prop="sides" min={3} max={64} />
              <span style={{ width: 22 }} />
            </Row>
          )}
          {restNode.type === "star" && (
            <Row>
              <NumField label="Points" nodeId={node.id} prop="points" min={2} max={64} />
              <span style={{ width: 22 }} />
            </Row>
          )}
        </div>
      )}
      {restNode.type === "path" && (
        <div className="sec">
          <div className="h" style={{ padding: "12px 0 2px" }}>Path</div>
          <Row>
            <span style={{ flex: 1, color: "var(--muted)" }}>{restNode.points.length} points</span>
            <button className="chip" onClick={() => run("node.update", { id: node.id, props: { closed: !restNode.closed } })}>
              {restNode.closed ? "Closed" : "Open"}
            </button>
            <KeyButton nodeId={node.id} prop="points" />
          </Row>
          <Row>
            <button className={`chip ${getUi().editPath === node.id ? "on" : ""}`} onClick={() => setUi({ editPath: getUi().editPath === node.id ? null : node.id, tool: "select" })}>
              Edit points
            </button>
            {restNode.subpaths.length > 0 && (
              <button className={`chip ${restNode.fillRule === "evenodd" ? "on" : ""}`} onClick={() => run("node.update", { id: node.id, props: { fillRule: restNode.fillRule === "evenodd" ? "nonzero" : "evenodd" } })}>
                Even-odd
              </button>
            )}
          </Row>
        </div>
      )}
      {restNode.type === "text" && <TextSection node={restNode} />}
      {restNode.type === "image" && (
        <div className="sec">
          <div className="h" style={{ padding: "12px 0 2px" }}>Image</div>
          {Pair(["W", "width"], ["H", "height"], { min: 1 })}
          <Row>
            <button className="chip" onClick={() => replaceImage(node.id)}>Replace image</button>
          </Row>
        </div>
      )}
      {restNode.type === "group" && (
        <div className="sec">
          <div className="h" style={{ padding: "12px 0 2px" }}>Group</div>
          <Row>
            <button className={`chip ${restNode.clip ? "on" : ""}`} title="The bottom layer becomes a mask for the rest" onClick={() => run("node.update", { id: node.id, props: { clip: !restNode.clip } })}>
              Clip to bottom layer
            </button>
          </Row>
        </div>
      )}
      {"trimStart" in restNode && (
        <div className="sec">
          <div className="h" style={{ padding: "12px 0 2px" }}>Trim path</div>
          {Pair(["S", "trimStart"], ["E", "trimEnd"], { step: 0.01, min: 0 })}
          {F("Offset", "trimOffset", { step: 0.01 })}
        </div>
      )}
      <div className="sec">
        <div className="h" style={{ padding: "12px 0 2px" }}>Appearance</div>
        {F("Opacity", "opacity", { step: 0.01, min: 0, max: 1 })}
        {F("Blur", "blur", { min: 0 })}
        <Row>
          <button
            className={`chip ${restNode.shadow ? "on" : ""}`}
            onClick={() => run("node.update", { id: node.id, props: { shadow: restNode.shadow ? null : { color: "#0a0a0b40", x: 0, y: 16, blur: 32 } } })}
          >
            Shadow
          </button>
        </Row>
        {restNode.shadow && (
          <>
            <Row>
              <ColorField value={String(currentValue(node.id, "shadow.color") ?? restNode.shadow.color)} onChange={(c, k) => editProp(node.id, "shadow.color", c, k ? `${k}-${node.id}-sh` : undefined)} />
              <KeyButton nodeId={node.id} prop="shadow.color" />
            </Row>
            {Pair(["X", "shadow.x"], ["Y", "shadow.y"])}
            {F("Soft", "shadow.blur", { min: 0 })}
          </>
        )}
      </div>
      {restNode.type !== "group" && restNode.type !== "image" && (
        <div className="sec">
          <div className="h" style={{ padding: "12px 0 2px" }}>Fill</div>
          <PaintEditor node={restNode} which="fill" />
        </div>
      )}
      {restNode.type !== "group" && restNode.type !== "image" && (
        <div className="sec">
          <div className="h" style={{ padding: "12px 0 2px" }}>Stroke</div>
          <PaintEditor node={restNode} which="stroke" />
          {restNode.stroke && (
            <>
              {F("Width", "stroke.width", { min: 0 })}
              <Row>
                <select className="sel" style={{ flex: 1 }} value={restNode.stroke.cap} onChange={(e) => run("node.update", { id: node.id, props: { stroke: { cap: e.target.value } } })}>
                  <option value="butt">Butt cap</option>
                  <option value="round">Round cap</option>
                  <option value="square">Square cap</option>
                </select>
                <select className="sel" style={{ flex: 1 }} value={restNode.stroke.join} onChange={(e) => run("node.update", { id: node.id, props: { stroke: { join: e.target.value } } })}>
                  <option value="miter">Miter join</option>
                  <option value="round">Round join</option>
                  <option value="bevel">Bevel join</option>
                </select>
              </Row>
            </>
          )}
        </div>
      )}
      {getUi().mode === "animate" && editor.doc.activeAnimation && <PresetSection id={node.id} trimmable={"trimStart" in restNode} />}
      <AlignSection ids={[node.id]} />
    </aside>
  );
}

function DocInspector() {
  const doc = editor.doc;
  const set = (p: Record<string, unknown>) => run("doc.setProps", p);
  const num = (label: string, key: "width" | "height" | "fps") => (
    <div className="field">
      <label>{label}</label>
      <input
        key={`${key}-${doc[key]}`}
        defaultValue={doc[key]}
        onBlur={(e) => {
          const v = Math.round(Number(e.target.value));
          if (Number.isFinite(v) && v > 0 && v !== doc[key]) set({ [key]: v });
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
  return (
    <aside className="panel right">
      <div className="doc-title">
        <input
          key={doc.name}
          defaultValue={doc.name}
          style={{ border: 0, outline: "none", font: "inherit", letterSpacing: "inherit", width: "100%", background: "transparent" }}
          onBlur={(e) => e.target.value.trim() && e.target.value !== doc.name && set({ name: e.target.value.trim() })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="doc-sub">Artboard</div>
      <div className="sec">
        <div className="grid2">
          {num("W", "width")}
          {num("H", "height")}
        </div>
        <div className="row">
          <ColorField value={doc.background} onChange={(c, k) => run("doc.setProps", { background: c }, k)} />
        </div>
        <div className="row">
          {num("FPS", "fps")}
        </div>
        <div className="chips" style={{ marginTop: 10 }}>
          {[
            ["Square", 1080, 1080],
            ["Story", 1080, 1920],
            ["Video", 1920, 1080],
            ["Icon", 512, 512],
          ].map(([n, w, h]) => (
            <button key={n} className={`chip ${doc.width === w && doc.height === h ? "on" : ""}`} onClick={() => set({ width: w, height: h })}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="sec">
        <div className="h" style={{ padding: "12px 0 6px" }}>Shortcuts</div>
        <div style={{ color: "var(--muted)", lineHeight: 2 }}>
          <span className="kbd">Tab</span> design / animate &nbsp; <span className="kbd">Space</span> play
          <br />
          <span className="kbd">K</span> key selection &nbsp; <span className="kbd">Ctrl</span>+<span className="kbd">D</span> duplicate
          <br />
          Drag the canvas with <span className="kbd">Space</span> held, zoom with <span className="kbd">Ctrl</span>+wheel
        </div>
      </div>
      <div className="attrib">
        Developed by Dias Zhumagaliyev · <a href="https://dias.now" target="_blank" rel="noreferrer">dias.now</a>
      </div>
    </aside>
  );
}

const ALIGN: { a: string; label: string }[] = [
  { a: "left", label: "Left" },
  { a: "center", label: "Center" },
  { a: "right", label: "Right" },
  { a: "top", label: "Top" },
  { a: "middle", label: "Middle" },
  { a: "bottom", label: "Bottom" },
];

function AlignSection({ ids }: { ids: string[] }) {
  return (
    <div className="sec">
      <div className="h" style={{ padding: "12px 0 6px" }}>{ids.length > 1 ? "Align" : "Align to artboard"}</div>
      <div className="chips">
        {ALIGN.map((x) => (
          <button key={x.a} className="chip" onClick={() => run("node.align", { ids, align: x.a })}>
            {x.label}
          </button>
        ))}
        {ids.length > 2 && (
          <>
            <button className="chip" onClick={() => run("node.distribute", { ids, axis: "horizontal" })}>Space H</button>
            <button className="chip" onClick={() => run("node.distribute", { ids, axis: "vertical" })}>Space V</button>
          </>
        )}
      </div>
    </div>
  );
}

const PRESET_LABELS: [string, string][] = [
  ["fadeIn", "Fade in"], ["popIn", "Pop in"], ["slideInUp", "Slide up"], ["slideInLeft", "Slide right"], ["bounce", "Bounce"], ["pulse", "Pulse"],
  ["heartbeat", "Heartbeat"], ["float", "Float"], ["wiggle", "Wiggle"], ["shake", "Shake"], ["spin", "Spin"], ["blink", "Blink"], ["fadeOut", "Fade out"], ["popOut", "Pop out"],
];

function PresetSection({ id, trimmable }: { id: string; trimmable: boolean }) {
  const add = (preset: string) => run("anim.preset", { nodeId: id, preset, time: +editor.state.time.toFixed(3) });
  return (
    <div className="sec">
      <div className="h" style={{ padding: "12px 0 6px" }}>
        Motion presets <Icon name="sparkles" size={14} />
      </div>
      <div className="chips">
        {trimmable && <button className="chip" onClick={() => add("draw")}>Draw on</button>}
        {PRESET_LABELS.map(([p, l]) => (
          <button key={p} className="chip" onClick={() => add(p)}>
            {l}
          </button>
        ))}
      </div>
      <div style={{ color: "var(--faint)", marginTop: 8, fontSize: 11 }}>Starts at the playhead, relative to the current pose.</div>
    </div>
  );
}

const FONTS = ["SF Pro Display", "SF Pro Text", "Georgia", "Times New Roman", "Helvetica", "Courier New", "monospace"];

function TextSection({ node }: { node: Extract<AnimaNode, { type: "text" }> }) {
  return (
    <div className="sec">
      <div className="h" style={{ padding: "12px 0 2px" }}>Text</div>
      <textarea
        key={node.id + node.text}
        defaultValue={node.text}
        rows={Math.min(6, node.text.split("\n").length + 1)}
        onBlur={(e) => e.target.value !== node.text && run("node.update", { id: node.id, props: { text: e.target.value } })}
        onKeyDown={(e) => e.stopPropagation()}
        style={{ width: "100%", marginTop: 6, border: "1px solid transparent", borderRadius: 8, background: "var(--bg2)", padding: "8px 9px", font: "inherit", resize: "vertical", outline: "none" }}
      />
      <Row>
        <select className="sel" style={{ flex: 1 }} value={FONTS.includes(node.fontFamily) ? node.fontFamily : "custom"} onChange={(e) => e.target.value !== "custom" && run("node.update", { id: node.id, props: { fontFamily: e.target.value } })}>
          {FONTS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
          {!FONTS.includes(node.fontFamily) && <option value="custom">{node.fontFamily}</option>}
        </select>
        <select className="sel" value={node.fontWeight} onChange={(e) => run("node.update", { id: node.id, props: { fontWeight: Number(e.target.value) } })}>
          {[300, 400, 500, 600, 700, 800, 900].map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
      </Row>
      <div className="grid2" style={{ marginTop: 6, gridTemplateColumns: "1fr 1fr 22px 22px", alignItems: "center" }}>
        <NumField label="Size" nodeId={node.id} prop="fontSize" min={1} />
        <NumField label="LS" nodeId={node.id} prop="letterSpacing" step={0.1} title="Letter spacing" />
        <KeyButton nodeId={node.id} prop="fontSize" />
        <KeyButton nodeId={node.id} prop="letterSpacing" />
      </div>
      <Row>
        <NumField label="LH" nodeId={node.id} prop="lineHeight" step={0.05} min={0.5} title="Line height" />
        <div className="chips">
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} className={`chip ${node.align === a ? "on" : ""}`} onClick={() => run("node.update", { id: node.id, props: { align: a } })}>
              {a[0]!.toUpperCase() + a.slice(1)}
            </button>
          ))}
        </div>
      </Row>
    </div>
  );
}

function replaceImage(id: string) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => run("node.update", { id, props: { src: String(r.result), name: f.name } });
    r.readAsDataURL(f);
  };
  input.click();
}
