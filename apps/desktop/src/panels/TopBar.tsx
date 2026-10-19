import { editor, getUi, run, setUi, useStore, type Tool } from "../store";
import { Icon, type IconName } from "../icons";
import { openDocument, saveDocument, newDocument, pickAndImport } from "../platform";

const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
  { id: "select", icon: "cursor", label: "Select", key: "V" },
  { id: "rect", icon: "rect", label: "Rectangle", key: "R" },
  { id: "ellipse", icon: "ellipse", label: "Ellipse", key: "O" },
  { id: "polygon", icon: "polygon", label: "Polygon", key: "U" },
  { id: "star", icon: "star", label: "Star", key: "S" },
  { id: "pen", icon: "pen", label: "Pen", key: "P" },
  { id: "text", icon: "text", label: "Text", key: "T" },
];

export function TopBar() {
  useStore();
  const ui = getUi();
  const h = editor.history();
  const name = ui.filePath ? ui.filePath.replace(/^.*[\\/]/, "") : `${editor.doc.name}.anima`;
  const setMode = (mode: "design" | "animate") => {
    if (mode === "animate" && !editor.doc.activeAnimation) run("anim.new", { name: "Animation 1", duration: 2 });
    setUi({ mode, playing: mode === "design" ? false : ui.playing });
  };
  return (
    <header className="top">
      <div className="brand">
        <b>
          RaveAnima<i>.</i>
        </b>
        <span className={editor.dirty ? "dirty" : ""} title={ui.filePath ?? ""}>
          {name}
        </span>
      </div>
      <div className="seg" role="toolbar">
        {TOOLS.map((t) => (
          <button key={t.id} className={ui.tool === t.id ? "on" : ""} title={`${t.label} (${t.key})`} onClick={() => setUi({ tool: t.id })}>
            <Icon name={t.icon} />
          </button>
        ))}
      </div>
      <div className="seg mode">
        <button className={ui.mode === "design" ? "on" : ""} onClick={() => setMode("design")} title="Design mode (Tab)">
          Design
        </button>
        <button className={ui.mode === "animate" ? "on anim" : ""} onClick={() => setMode("animate")} title="Animate mode (Tab)">
          Animate
        </button>
      </div>
      <div className="spacer" />
      <div className={`agent ${ui.agent.busy ? "busy" : ui.agent.connected ? "on" : ""}`} title="AI agents drive this window through the local bridge (raveanima mcp --live)">
        <span className="dot" />
        {ui.agent.last ? (
          <>
            Agent <em>{ui.agent.last}</em>
          </>
        ) : ui.agent.connected ? (
          "Agent bridge ready"
        ) : (
          "Agent bridge off"
        )}
      </div>
      <button className="pill ghost" title="Undo (Ctrl+Z)" disabled={!h.undo.length} onClick={() => run("history.undo")}>
        <Icon name="undo" />
      </button>
      <button className="pill ghost" title="Redo (Ctrl+Shift+Z)" disabled={!h.redo.length} onClick={() => run("history.redo")}>
        <Icon name="redo" />
      </button>
      <button className="pill ghost" title="New (Ctrl+N)" onClick={newDocument}>
        <Icon name="docPlus" />
      </button>
      <button className="pill ghost" title="Open (Ctrl+O)" onClick={openDocument}>
        <Icon name="folder" />
      </button>
      <button className="pill ghost" title="Import SVG or image (Ctrl+I), or drop files on the canvas" onClick={pickAndImport}>
        <Icon name="photo" />
      </button>
      <button className="pill" title="Save (Ctrl+S)" onClick={() => saveDocument()}>
        Save
      </button>
      <button className="pill ink" title="Export (Ctrl+E)" onClick={() => setUi({ exportOpen: true })}>
        <Icon name="download" /> Export
      </button>
      <button className="pill ghost" title="About" onClick={() => setUi({ aboutOpen: true })}>
        <Icon name="info" />
      </button>
    </header>
  );
}
