import { useState } from "react";
import type { SmCondition, StateMachine } from "@raveanima/core";
import { Icon } from "../icons";
import { editor, getUi, refresh, run, setUi, smRuntime, useStore } from "../store";

/** Switch between the timeline and the state machine editor; shared by both bottom panels. */
export function BottomTabs() {
  const ui = getUi();
  return (
    <div className="seg" style={{ marginRight: 4 }}>
      <button className={ui.bottomTab === "timeline" ? "on" : ""} onClick={() => setUi({ bottomTab: "timeline", smPreview: false })}>
        Timeline
      </button>
      <button className={ui.bottomTab === "sm" ? "on" : ""} onClick={() => setUi({ bottomTab: "sm" })}>
        State machine
      </button>
    </div>
  );
}

const stop = (e: React.KeyboardEvent) => {
  e.stopPropagation();
  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
};

function stateName(sm: StateMachine, id: string) {
  return id === "any" ? "Any state" : (sm.states.find((s) => s.id === id)?.name ?? id);
}

function condText(c: SmCondition) {
  if (c.op === "fired") return `${c.input} fired`;
  return `${c.input} ${c.op} ${String(c.value ?? true)}`;
}

export function StateMachinePanel() {
  useStore();
  const ui = getUi();
  const doc = editor.doc;
  const sm = doc.stateMachines.find((s) => s.id === ui.activeSm) ?? doc.stateMachines[0];
  const sel = editor.state.selection;
  const rt = ui.smPreview ? smRuntime : null;
  const smArg = sm ? { sm: sm.id } : {};

  // Draft forms for new items.
  const [inputType, setInputType] = useState<"bool" | "number" | "trigger">("bool");
  const [tr, setTr] = useState({ from: "", to: "", input: "", value: "true", duration: "0.2", exit: "" });
  const [ls, setLs] = useState({ event: "click", input: "" });

  const header = (
    <div className="tbar">
      <BottomTabs />
      {sm ? (
        <>
          <select className="sel" value={sm.id} onChange={(e) => setUi({ activeSm: e.target.value, smPreview: false })}>
            {doc.stateMachines.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="pill ghost" title="New state machine" onClick={() => newSm()}>
            <Icon name="plus" />
          </button>
          <button className={`pill ${ui.smPreview ? "ink" : ""}`} title="Try it on the canvas: hover and click the artwork" onClick={() => setUi({ smPreview: !ui.smPreview, activeSm: sm.id, playing: false })}>
            <Icon name="sparkles" /> {ui.smPreview ? "Stop preview" : "Preview"}
          </button>
          {rt && (
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>
              State: {rt.current.state.name}
            </span>
          )}
          <div className="spacer" />
          <button className="pill ghost" title="Delete state machine" onClick={() => confirm(`Delete "${sm.name}"?`) && run("sm.delete", { sm: sm.id })}>
            <Icon name="trash" />
          </button>
        </>
      ) : (
        <span style={{ color: "var(--muted)" }}>No state machine yet</span>
      )}
    </div>
  );

  function newSm() {
    const idle = doc.animations[0];
    const r = run<{ id: string }>("sm.new", { name: `State Machine ${doc.stateMachines.length + 1}`, ...(idle ? { idleAnimation: idle.id } : {}) });
    if (r) setUi({ activeSm: r.id });
  }

  if (!sm)
    return (
      <section className="time smp">
        {header}
        <div className="sm-empty">
          <p>A state machine makes the artwork interactive: inputs (hover, click, a number) switch between states, and each state plays an animation.</p>
          <button className="pill ink" onClick={newSm}>
            <Icon name="plus" /> New state machine
          </button>
        </div>
      </section>
    );

  const animOptions = [<option key="" value="">Rest pose</option>, ...doc.animations.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)];
  const trInput = sm.inputs.find((i) => i.name === (tr.input || sm.inputs[0]?.name));

  return (
    <section className="time smp">
      {header}
      <div className="sm-cols">
        <div className="sm-col">
          <h4>Inputs</h4>
          {sm.inputs.map((i) => {
            const live = rt?.inputs.get(i.name);
            return (
              <div key={i.name} className="sm-item">
                <b>{i.name}</b>
                <small>{i.type}</small>
                <span className="spacer" />
                {rt ? (
                  i.type === "trigger" ? (
                    <button className="chip" onClick={() => (rt.fire(i.name), refresh())}>
                      Fire
                    </button>
                  ) : i.type === "bool" ? (
                    <button className={`chip ${live ? "on" : ""}`} onClick={() => (rt.setInput(i.name, !live), refresh())}>
                      {String(live)}
                    </button>
                  ) : (
                    <input className="sm-num" type="number" defaultValue={Number(live)} onKeyDown={stop} onChange={(e) => (rt.setInput(i.name, Number(e.target.value)), refresh())} />
                  )
                ) : (
                  <button className="keybtn" title="Remove input" onClick={() => run("sm.remove", { ...smArg, kind: "input", ref: i.name })}>
                    <Icon name="x" size={12} />
                  </button>
                )}
              </div>
            );
          })}
          <form
            className="sm-add"
            onSubmit={(e) => {
              e.preventDefault();
              const el = (e.target as HTMLFormElement).elements.namedItem("name") as HTMLInputElement;
              if (el.value.trim() && run("sm.addInput", { ...smArg, name: el.value.trim(), type: inputType })) el.value = "";
            }}
          >
            <input name="name" placeholder="New input" onKeyDown={(e) => e.stopPropagation()} />
            <select className="sel" value={inputType} onChange={(e) => setInputType(e.target.value as typeof inputType)}>
              <option value="bool">bool</option>
              <option value="number">number</option>
              <option value="trigger">trigger</option>
            </select>
            <button className="pill" type="submit">Add</button>
          </form>
        </div>

        <div className="sm-col">
          <h4>States</h4>
          {sm.states.map((s) => (
            <div key={s.id} className={`sm-item ${rt?.current.state.id === s.id ? "live" : ""}`}>
              <input key={s.id + s.name} className="sm-name" defaultValue={s.name} onKeyDown={stop} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && run("sm.updateState", { ...smArg, state: s.id, name: e.target.value.trim() })} />
              {sm.initial === s.id ? <small title="Initial state">start</small> : <button className="keybtn" title="Make initial" onClick={() => run("sm.update", { ...smArg, initial: s.id })}>start</button>}
              <select className="sel" value={s.animation ?? ""} onChange={(e) => run("sm.updateState", { ...smArg, state: s.id, animation: e.target.value || null })}>
                {animOptions}
              </select>
              {sm.states.length > 1 && (
                <button className="keybtn" title="Remove state" onClick={() => run("sm.remove", { ...smArg, kind: "state", ref: s.id })}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          ))}
          <form
            className="sm-add"
            onSubmit={(e) => {
              e.preventDefault();
              const f = e.target as HTMLFormElement;
              const name = (f.elements.namedItem("name") as HTMLInputElement).value.trim();
              const animation = (f.elements.namedItem("anim") as HTMLSelectElement).value || null;
              if (name && run("sm.addState", { ...smArg, name, animation })) (f.elements.namedItem("name") as HTMLInputElement).value = "";
            }}
          >
            <input name="name" placeholder="New state" onKeyDown={(e) => e.stopPropagation()} />
            <select name="anim" className="sel" defaultValue={doc.animations[0]?.id ?? ""}>
              {animOptions}
            </select>
            <button className="pill" type="submit">Add</button>
          </form>
        </div>

        <div className="sm-col wide">
          <h4>Transitions</h4>
          {sm.transitions.map((t) => (
            <div key={t.id} className="sm-item">
              <b>{stateName(sm, t.from)}</b>
              <span style={{ color: "var(--faint)" }}>to</span>
              <b>{stateName(sm, t.to)}</b>
              <small>
                {[...t.conditions.map(condText), t.exitTime !== null ? `after ${Math.round(t.exitTime * 100)}%` : ""].filter(Boolean).join(", ")} · {t.duration}s
              </small>
              <span className="spacer" />
              <button className="keybtn" title="Remove transition" onClick={() => run("sm.remove", { ...smArg, kind: "transition", ref: t.id })}>
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
          <form
            className="sm-add"
            onSubmit={(e) => {
              e.preventDefault();
              const input = trInput;
              const conditions: SmCondition[] = !input
                ? []
                : input.type === "trigger"
                  ? [{ input: input.name, op: "fired" }]
                  : [{ input: input.name, op: "==", value: input.type === "bool" ? tr.value === "true" : Number(tr.value) }];
              const exit = tr.exit === "" ? null : Math.min(1, Math.max(0, Number(tr.exit) / 100));
              run("sm.addTransition", { ...smArg, from: tr.from || "any", to: tr.to || sm.states[0]!.id, conditions, duration: Number(tr.duration) || 0, exitTime: exit });
            }}
          >
            <select className="sel" value={tr.from} onChange={(e) => setTr({ ...tr, from: e.target.value })}>
              <option value="">Any state</option>
              {sm.states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className="sel" value={tr.to || sm.states[0]!.id} onChange={(e) => setTr({ ...tr, to: e.target.value })}>
              {sm.states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span style={{ color: "var(--faint)" }}>when</span>
            <select className="sel" value={tr.input || sm.inputs[0]?.name || ""} onChange={(e) => setTr({ ...tr, input: e.target.value })}>
              {sm.inputs.length ? sm.inputs.map((i) => <option key={i.name} value={i.name}>{i.name}</option>) : <option value="">no input</option>}
            </select>
            {trInput?.type === "bool" && (
              <select className="sel" value={tr.value} onChange={(e) => setTr({ ...tr, value: e.target.value })}>
                <option value="true">is true</option>
                <option value="false">is false</option>
              </select>
            )}
            {trInput?.type === "number" && <input style={{ width: 54 }} value={tr.value} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => setTr({ ...tr, value: e.target.value })} title="Equals" />}
            <input style={{ width: 50 }} value={tr.exit} placeholder="exit %" title="Wait until this much of the animation has played" onKeyDown={(e) => e.stopPropagation()} onChange={(e) => setTr({ ...tr, exit: e.target.value })} />
            <input style={{ width: 44 }} value={tr.duration} title="Crossfade, seconds" onKeyDown={(e) => e.stopPropagation()} onChange={(e) => setTr({ ...tr, duration: e.target.value })} />
            <button className="pill" type="submit">Add</button>
          </form>
        </div>

        <div className="sm-col">
          <h4>Listeners</h4>
          {sm.listeners.map((l) => (
            <div key={l.id} className="sm-item">
              <b>{doc.nodes[l.nodeId]?.name ?? l.nodeId}</b>
              <small>
                {l.event} → {l.action} {l.input}
                {l.action === "set" ? ` = ${String(l.value)}` : ""}
              </small>
              <span className="spacer" />
              <button className="keybtn" title="Remove listener" onClick={() => run("sm.remove", { ...smArg, kind: "listener", ref: l.id })}>
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
          <form
            className="sm-add"
            onSubmit={(e) => {
              e.preventDefault();
              const input = ls.input || sm.inputs[0]?.name;
              if (!input) return;
              const def = sm.inputs.find((i) => i.name === input)!;
              // Hover-style pairs set a bool; clicks toggle it; triggers fire.
              const extra = def.type === "bool" && ls.event !== "click" ? { action: "set", value: ls.event === "enter" || ls.event === "down" } : def.type === "number" ? { action: "set", value: 1 } : {};
              for (const nodeId of sel) run("sm.addListener", { ...smArg, nodeId, event: ls.event, input, ...extra });
            }}
          >
            <span style={{ color: sel.length ? "var(--ink)" : "var(--faint)" }}>{sel.length ? `${sel.length} selected` : "Select a layer"}</span>
            <select className="sel" value={ls.event} onChange={(e) => setLs({ ...ls, event: e.target.value })}>
              {["click", "enter", "leave", "down", "up"].map((ev) => <option key={ev}>{ev}</option>)}
            </select>
            <select className="sel" value={ls.input || sm.inputs[0]?.name || ""} onChange={(e) => setLs({ ...ls, input: e.target.value })}>
              {sm.inputs.map((i) => <option key={i.name}>{i.name}</option>)}
            </select>
            <button className="pill" type="submit" disabled={!sel.length || !sm.inputs.length}>Add</button>
          </form>
        </div>
      </div>
    </section>
  );
}
