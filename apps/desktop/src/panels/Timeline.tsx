import { useEffect, useRef, useState } from "react";
import { EASE_NAMES, easeToCubic, type Animation, type Ease } from "@raveanima/core";
import { editor, getUi, run, setTime, setUi, useStore } from "../store";
import { Diamond, Icon, PlayIcon } from "../icons";
import { BottomTabs } from "./StateMachine";

const PAD = 24;
const ROW = 26;
const PROP_LABEL: Record<string, string> = {
  "transform.x": "X",
  "transform.y": "Y",
  "transform.rotation": "Rotation",
  "transform.scaleX": "Scale X",
  "transform.scaleY": "Scale Y",
  "transform.originX": "Origin X",
  "transform.originY": "Origin Y",
  "fill.color": "Fill",
  "stroke.paint.color": "Stroke",
  "stroke.width": "Stroke width",
  cornerRadius: "Corner radius",
  innerRadius: "Inner radius",
  points: "Path",
};

type Row = { kind: "node"; nodeId: string; times: number[] } | { kind: "prop"; nodeId: string; prop: string };

function buildRows(anim: Animation | undefined): Row[] {
  const doc = editor.doc;
  if (!anim) return [];
  const byNode = new Map<string, string[]>();
  for (const t of anim.tracks) byNode.set(t.nodeId, [...(byNode.get(t.nodeId) ?? []), t.prop]);
  for (const id of editor.state.selection) if (!byNode.has(id) && doc.nodes[id]) byNode.set(id, []);
  const order: string[] = [];
  const visit = (ids: string[]) => {
    for (const id of [...ids].reverse()) {
      order.push(id);
      const n = doc.nodes[id];
      if (n?.type === "group") visit(n.children);
    }
  };
  visit(doc.root);
  const rows: Row[] = [];
  for (const id of order) {
    const props = byNode.get(id);
    if (!props) continue;
    const times = [...new Set(anim.tracks.filter((t) => t.nodeId === id).flatMap((t) => t.keys.map((k) => k.time)))];
    rows.push({ kind: "node", nodeId: id, times });
    for (const prop of props) rows.push({ kind: "prop", nodeId: id, prop });
  }
  return rows;
}

export function Timeline() {
  useStore();
  const doc = editor.doc;
  const ui = getUi();
  const anim = doc.animations.find((a) => a.id === doc.activeAnimation);
  const lanes = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(lanes.current!);
    return () => ro.disconnect();
  }, []);

  const dur = anim?.duration ?? 1;
  const tx = (t: number) => PAD + (t / dur) * (width - PAD * 2);
  const xt = (x: number) => ((x - PAD) / (width - PAD * 2)) * dur;
  const snap = (t: number) => Math.max(0, Math.min(dur, Math.round(t * doc.fps) / doc.fps));
  const rows = buildRows(anim);
  const time = editor.state.time;

  const scrub = (e: React.PointerEvent) => {
    if (!anim) return;
    const r = lanes.current!.getBoundingClientRect();
    const go = (cx: number) => setTime(snap(xt(cx - r.left)));
    setUi({ playing: false, selectedKey: null });
    go(e.clientX);
    const move = (ev: PointerEvent) => go(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const dragKey = (e: React.PointerEvent, nodeId: string, prop: string, t0: number) => {
    e.stopPropagation();
    setUi({ selectedKey: { nodeId, prop, time: t0 } });
    setTime(t0);
    const r = lanes.current!.getBoundingClientRect();
    let cur = t0;
    const key = `kmove-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const t = snap(xt(ev.clientX - r.left));
      if (Math.abs(t - cur) < 1e-6) return;
      const track = anim!.tracks.find((x) => x.nodeId === nodeId && x.prop === prop);
      if (track?.keys.some((k) => Math.abs(k.time - t) < 1e-6)) return; // don't stack keys
      run("keyframe.move", { nodeId, prop, time: cur, to: t }, key);
      cur = t;
      setUi({ selectedKey: { nodeId, prop, time: t } });
      setTime(t);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const sk = ui.selectedKey;
  const selTrack = sk && anim?.tracks.find((t) => t.nodeId === sk.nodeId && t.prop === sk.prop);
  const selKey = selTrack?.keys.find((k) => Math.abs(k.time - sk!.time) < 1e-6);
  const ticks = Math.max(1, Math.min(dur * 10, Math.floor((width - PAD * 2) / 50)));

  return (
    <section className="time">
      <div className="tbar">
        <BottomTabs />
        <button className="play" title="Play / pause (Space)" disabled={!anim} onClick={() => (anim ? setUi({ playing: !ui.playing, mode: "animate" }) : run("anim.new", {}))}>
          <PlayIcon playing={ui.playing} />
        </button>
        <div className="tc">
          {time.toFixed(2)}s <small>/ {dur.toFixed(2)}s</small>
        </div>
        {anim ? (
          <>
            <div className="field" style={{ width: 150 }}>
              <input
                key={anim.id + anim.name}
                defaultValue={anim.name}
                style={{ paddingLeft: 9 }}
                onBlur={(e) => e.target.value.trim() && e.target.value !== anim.name && run("anim.update", { name: e.target.value.trim() })}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            <div className="field" style={{ width: 92 }} title="Duration in seconds">
              <label>Dur</label>
              <input
                key={anim.id + anim.duration}
                defaultValue={anim.duration}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0 && v !== anim.duration) run("anim.update", { duration: v });
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
            <select className="sel" value={anim.loop} onChange={(e) => run("anim.update", { loop: e.target.value })}>
              <option value="none">One shot</option>
              <option value="loop">Loop</option>
              <option value="pingpong">Ping-pong</option>
            </select>
            <div className="spacer" />
            <span style={{ color: "var(--muted)" }}>{ui.mode === "animate" ? "Edits create keyframes at the playhead" : "Switch to Animate to key properties"}</span>
            <button className="pill ghost" title="Delete animation" onClick={() => confirm(`Delete "${anim.name}"?`) && run("anim.delete", { id: anim.id })}>
              <Icon name="trash" />
            </button>
          </>
        ) : (
          <span style={{ color: "var(--muted)" }}>No animation yet</span>
        )}
      </div>
      <div className="tnames">
        <div style={{ height: 22, borderBottom: "1px solid var(--line)" }} />
        {rows.map((r) =>
          r.kind === "node" ? (
            <div key={r.nodeId} className={`trow node ${editor.state.selection.includes(r.nodeId) ? "sel" : ""}`} onClick={() => run("select.set", { ids: [r.nodeId] })}>
              {doc.nodes[r.nodeId]?.name}
            </div>
          ) : (
            <div key={r.nodeId + r.prop} className={`trow prop ${sk?.nodeId === r.nodeId && sk.prop === r.prop ? "sel" : ""}`}>
              {PROP_LABEL[r.prop] ?? r.prop}
              <span className="spacer" />
              <button
                className="keybtn"
                title="Remove track"
                style={{ color: "var(--faint)" }}
                onClick={() => run("track.delete", { nodeId: r.nodeId, prop: r.prop })}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ),
        )}
      </div>
      <div className="tlanes" ref={lanes} onPointerDown={scrub}>
        <div className="ruler">
          {Array.from({ length: ticks + 1 }, (_, i) => {
            const t = (dur * i) / ticks;
            return (
              <span key={i} style={{ position: "absolute", left: tx(t), top: 0, height: 22, borderLeft: "1px solid var(--line2)", paddingLeft: 4, fontSize: 10, lineHeight: "22px", color: "var(--faint)", fontVariantNumeric: "tabular-nums" }}>
                {t.toFixed(t % 1 === 0 ? 0 : 1)}s
              </span>
            );
          })}
        </div>
        {!anim && (
          <div className="tl-empty">
            <div>
              <b style={{ color: "var(--ink)", font: "600 14px SFD" }}>Bring it to life</b>
              <br />
              Press <span className="kbd">Tab</span> for Animate mode, move the playhead, then change anything.
            </div>
          </div>
        )}
        {anim && rows.length === 0 && <div className="tl-empty">Select a layer and press <span className="kbd">K</span>, or edit it in Animate mode.</div>}
        <div style={{ position: "absolute", top: 22, left: 0, right: 0 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ position: "absolute", top: i * ROW, left: 0, right: 0, height: ROW, borderBottom: "1px solid #f3f3f1", background: r.kind === "node" ? "#fbfbfa" : undefined }}>
              {r.kind === "node"
                ? r.times.map((t) => <span key={t} style={{ position: "absolute", left: tx(t) - 3, top: ROW / 2 - 3, width: 6, height: 6, borderRadius: 2, background: "var(--faint)", transform: "rotate(45deg)" }} />)
                : anim!.tracks
                    .find((t) => t.nodeId === r.nodeId && t.prop === r.prop)
                    ?.keys.map((k, ki, arr) => {
                      const on = sk?.nodeId === r.nodeId && sk.prop === r.prop && Math.abs(sk.time - k.time) < 1e-6;
                      const next = arr[ki + 1];
                      return (
                        <span key={k.time}>
                          {next && <span style={{ position: "absolute", left: tx(k.time), width: tx(next.time) - tx(k.time), top: ROW / 2 - 1, height: 2, background: k.ease === "hold" ? "repeating-linear-gradient(90deg,#ff3b2e55 0 4px,transparent 4px 8px)" : "#ff3b2e33" }} />}
                          <span
                            onPointerDown={(e) => dragKey(e, r.nodeId, r.prop, k.time)}
                            title={`${k.time.toFixed(2)}s · ${typeof k.ease === "string" ? k.ease : "custom"}`}
                            style={{ position: "absolute", left: tx(k.time) - 7, top: ROW / 2 - 7, width: 14, height: 14, color: on ? "var(--ink)" : "var(--accent)", display: "grid", placeItems: "center", cursor: "grab" }}
                          >
                            <span style={{ width: 11, height: 11, display: "block" }}>
                              <Diamond />
                            </span>
                          </span>
                        </span>
                      );
                    })}
            </div>
          ))}
        </div>
        {anim && <div style={{ position: "absolute", top: 0, bottom: 0, left: tx(time), width: 1.5, background: "var(--accent)", pointerEvents: "none", zIndex: 3 }}>
          <div style={{ position: "absolute", top: 0, left: -5, width: 11, height: 11, borderRadius: "0 0 6px 6px", background: "var(--accent)" }} />
        </div>}
      </div>
      {sk && selKey && <EasePopover ease={selKey.ease} label={`${doc.nodes[sk.nodeId]?.name} · ${PROP_LABEL[sk.prop] ?? sk.prop} · ${sk.time.toFixed(2)}s`} onEase={(ease, key) => run("keyframe.setEase", { ...sk, ease }, key)} onDelete={() => (run("keyframe.delete", sk), setUi({ selectedKey: null }))} onClose={() => setUi({ selectedKey: null })} />}
    </section>
  );
}

function EasePopover({ ease, label, onEase, onDelete, onClose }: { ease: Ease; label: string; onEase: (e: Ease, key?: string) => void; onDelete: () => void; onClose: () => void }) {
  const cubic = easeToCubic(ease);
  const svg = useRef<SVGSVGElement>(null);
  const W = 212, H = 150, M = 22;
  const px = (x: number) => M + x * (W - M * 2);
  const py = (y: number) => H - M - y * (H - M * 2);
  const drag = (i: 0 | 1) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const r = svg.current!.getBoundingClientRect();
    const key = `ease-${Date.now()}`;
    const start = cubic ?? [0, 0, 1, 1];
    const move = (ev: PointerEvent) => {
      const x = Math.min(1, Math.max(0, ((ev.clientX - r.left) * (W / r.width) - M) / (W - M * 2)));
      const y = Math.round(((H - M - (ev.clientY - r.top) * (H / r.height)) / (H - M * 2)) * 100) / 100;
      const c = [...start] as [number, number, number, number];
      c[i * 2] = Math.round(x * 100) / 100;
      c[i * 2 + 1] = y;
      onEase({ cubic: c }, key);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="ease-pop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="h">
        Easing
        <button onClick={onClose} title="Close">
          <Icon name="x" size={14} />
        </button>
      </div>
      <div style={{ color: "var(--muted)", marginBottom: 8, fontSize: 11.5 }}>{label}</div>
      <div className="chips">
        {EASE_NAMES.map((n) => (
          <button key={n} className={`chip ${ease === n ? "on" : ""}`} onClick={() => onEase(n)}>
            {n}
          </button>
        ))}
      </div>
      {cubic && (
        <svg className="curve" ref={svg} viewBox={`0 0 ${W} ${H}`}>
          <rect x={px(0)} y={py(1)} width={W - M * 2} height={H - M * 2} fill="none" stroke="#e2e2df" strokeDasharray="3 3" />
          <line x1={px(0)} y1={py(0)} x2={px(cubic[0])} y2={py(cubic[1])} stroke="#ff3b2e" strokeWidth="1" />
          <line x1={px(1)} y1={py(1)} x2={px(cubic[2])} y2={py(cubic[3])} stroke="#ff3b2e" strokeWidth="1" />
          <path d={`M${px(0)} ${py(0)} C${px(cubic[0])} ${py(cubic[1])} ${px(cubic[2])} ${py(cubic[3])} ${px(1)} ${py(1)}`} fill="none" stroke="#0a0a0b" strokeWidth="2" />
          <circle cx={px(cubic[0])} cy={py(cubic[1])} r="6" fill="#fff" stroke="#ff3b2e" strokeWidth="2" onPointerDown={drag(0)} style={{ cursor: "grab" }} />
          <circle cx={px(cubic[2])} cy={py(cubic[3])} r="6" fill="#fff" stroke="#ff3b2e" strokeWidth="2" onPointerDown={drag(1)} style={{ cursor: "grab" }} />
        </svg>
      )}
      {cubic && <div style={{ marginTop: 8, color: "var(--muted)", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>cubic-bezier({cubic.join(", ")})</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <button className="pill ghost" onClick={onDelete}>
          <Icon name="trash" /> Delete key
        </button>
      </div>
    </div>
  );
}
