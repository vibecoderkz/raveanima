import { useEffect } from "react";
import { getAnimation, localTime } from "@raveanima/core";
import { Canvas } from "./canvas/Canvas";
import { Inspector } from "./panels/Inspector";
import { Layers } from "./panels/Layers";
import { Modals } from "./panels/Modals";
import { Timeline } from "./panels/Timeline";
import { StateMachinePanel } from "./panels/StateMachine";
import { TopBar } from "./panels/TopBar";
import { editor, editProp, currentValue, getUi, run, setTime, setUi, useStore, copySelection, pasteClipboard, readAutosave, clearAutosave, toast, type Tool } from "./store";
import { newDocument, openDocument, saveDocument, startBridge, pickAndImport } from "./platform";
import { loadExample } from "./example";

const TOOL_KEYS: Record<string, Tool> = { v: "select", r: "rect", o: "ellipse", u: "polygon", s: "star", p: "pen", t: "text" };

function usePlayback() {
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let clock = 0;
    let wasPlaying = false;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const ui = getUi();
      const doc = editor.doc;
      if (!ui.playing || !doc.activeAnimation) {
        wasPlaying = false;
        return;
      }
      const anim = getAnimation(doc);
      if (!wasPlaying) {
        clock = editor.state.time >= anim.duration - 1e-3 && anim.loop === "none" ? 0 : editor.state.time;
        last = now;
        wasPlaying = true;
      }
      clock += (now - last) / 1000;
      last = now;
      if (anim.loop === "none" && clock >= anim.duration) {
        setTime(anim.duration);
        setUi({ playing: false });
        return;
      }
      setTime(localTime(anim, clock));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    let spaceDown = 0;
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const sel = editor.state.selection;
      const ui = getUi();
      // Preview is read-only: Escape leaves it, editing shortcuts wait.
      if (ui.smPreview) {
        if (k === "escape") setUi({ smPreview: false });
        return;
      }
      if (mod) {
        const map: Record<string, () => void> = {
          z: () => run(e.shiftKey ? "history.redo" : "history.undo"),
          y: () => run("history.redo"),
          s: () => saveDocument(e.shiftKey),
          o: () => openDocument(),
          n: () => newDocument(),
          e: () => setUi({ exportOpen: true }),
          d: () => sel.length && run("node.duplicate", { ids: sel }),
          c: () => copySelection(),
          x: () => copySelection(true),
          v: () => pasteClipboard(),
          i: () => pickAndImport(),
          g: () => (e.shiftKey ? sel.length === 1 && run("node.ungroup", { id: sel[0] }) : sel.length && run("node.group", { ids: sel })),
          a: () => run("select.set", { ids: [...editor.doc.root] }),
          "]": () => sel.forEach((id) => run("node.reorder", { id, to: e.shiftKey ? "top" : "up" })),
          "[": () => sel.forEach((id) => run("node.reorder", { id, to: e.shiftKey ? "bottom" : "down" })),
        };
        if (map[k]) {
          e.preventDefault();
          map[k]!();
        }
        return;
      }
      if (e.code === "Space") {
        if (!e.repeat) spaceDown = performance.now();
        e.preventDefault();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const mode = ui.mode === "design" ? "animate" : "design";
        if (mode === "animate" && !editor.doc.activeAnimation) run("anim.new", { name: "Animation 1", duration: 2 });
        setUi({ mode, playing: false });
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (ui.selectedKey) {
          run("keyframe.delete", ui.selectedKey);
          setUi({ selectedKey: null });
        } else if (sel.length) run("node.delete", { ids: sel });
        return;
      }
      if (e.key === "Escape") {
        setUi({ selectedKey: null, tool: "select", exportOpen: false, aboutOpen: false });
        run("select.set", { ids: [] });
        return;
      }
      if (e.key.startsWith("Arrow") && sel.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const key = `nudge-${Math.floor(Date.now() / 800)}`;
        for (const id of sel) {
          if (dx) editProp(id, "transform.x", Number(currentValue(id, "transform.x")) + dx, key);
          if (dy) editProp(id, "transform.y", Number(currentValue(id, "transform.y")) + dy, key);
        }
        return;
      }
      if (k === "k" && sel.length && editor.doc.activeAnimation) {
        // Key the transform and opacity of the selection at the playhead.
        const time = +editor.state.time.toFixed(4);
        editor.batch(sel.flatMap((id) => ["transform.x", "transform.y", "transform.rotation", "transform.scaleX", "transform.scaleY", "opacity"].map((prop) => ({ command: "keyframe.set", params: { nodeId: id, prop, time, value: currentValue(id, prop) } }))));
        return;
      }
      if (e.key === "!" || (e.shiftKey && e.code === "Digit1")) return (window as unknown as { __animaFit?: () => void }).__animaFit?.();
      if (e.key === "," || e.key === ".") {
        const fps = editor.doc.fps;
        setTime(Math.round(editor.state.time * fps + (e.key === "," ? -1 : 1)) / fps);
        return;
      }
      if (TOOL_KEYS[k]) setUi({ tool: TOOL_KEYS[k]! });
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && spaceDown && performance.now() - spaceDown < 220) {
        if (!editor.doc.activeAnimation) return;
        setUi({ playing: !getUi().playing, mode: "animate" });
      }
      if (e.code === "Space") spaceDown = 0;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
}

export function App() {
  useStore();
  usePlayback();
  useShortcuts();
  useEffect(() => {
    startBridge();
    const saved = readAutosave();
    if (saved && saved.doc?.format === "anima") {
      // Unsaved work from a previous session (crash or closed window): restore it right away.
      editor.execute("doc.load", { document: saved.doc });
      editor.dirty = true;
      setUi({ filePath: saved.path });
      toast(`Restored unsaved work from ${new Date(saved.at).toLocaleTimeString()}`);
    } else if (!localStorage.getItem("anima.seen")) {
      loadExample();
      try {
        localStorage.setItem("anima.seen", "1");
      } catch {
        /* storage may be unavailable */
      }
    }
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (editor.dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  const ui = getUi();
  return (
    <div className="app">
      <TopBar />
      <Layers />
      <Canvas />
      <Inspector />
      {ui.bottomTab === "sm" ? <StateMachinePanel /> : <Timeline />}
      <Modals />
      {ui.toast && (
        <div key={ui.toast.id} className={`toast ${ui.toast.error ? "err" : ""}`} style={{ bottom: 252 }}>
          {ui.toast.text}
        </div>
      )}
    </div>
  );
}

export { loadExample };
