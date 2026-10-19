import { useState } from "react";
import type { AnimaNode } from "@raveanima/core";
import { editor, getUi, run, setTime, setUi, useStore } from "../store";
import { loadExample } from "../example";
import { Icon, NODE_ICON } from "../icons";

type Drop = { id: string; where: "above" | "below" | "in" } | null;

export function Layers() {
  useStore();
  const doc = editor.doc;
  const sel = editor.state.selection;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);

  const rows: { node: AnimaNode; depth: number }[] = [];
  // Top of the list = top of the stack, like every design tool.
  const collapsed = getUi().collapsed;
  const visit = (ids: string[], depth: number) => {
    for (const id of [...ids].reverse()) {
      const n = doc.nodes[id];
      if (!n) continue;
      rows.push({ node: n, depth });
      // Groups start collapsed when large, so imported art and big scenes stay navigable.
      const isCollapsed = collapsed[id] ?? (n.type === "group" && n.children.length > 8);
      if (n.type === "group" && !isCollapsed) visit(n.children, depth + 1);
    }
  };
  const toggle = (id: string, now: boolean) => setUi({ collapsed: { ...collapsed, [id]: !now } });
  visit(doc.root, 0);

  const click = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) run("select.set", { ids: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] });
    else run("select.set", { ids: [id] });
  };

  const commitDrop = () => {
    if (!dragId || !drop || drop.id === dragId) return;
    const target = doc.nodes[drop.id]!;
    if (drop.where === "in" && target.type === "group") {
      run("node.reparent", { id: dragId, parent: target.id });
      return;
    }
    const parent = target.parent;
    const siblings = parent ? (doc.nodes[parent] as { children: string[] }).children : doc.root;
    const without = siblings.filter((x) => x !== dragId);
    const ti = without.indexOf(target.id);
    // The panel is drawn top-down, the stack bottom-up: "above" means a higher index.
    const index = drop.where === "above" ? ti + 1 : ti;
    if (doc.nodes[dragId]!.parent !== parent) run("node.reparent", { id: dragId, parent, index });
    else run("node.reorder", { id: dragId, to: index });
  };

  const anims = doc.animations;
  return (
    <aside className="panel left">
      <div className="h">
        Layers
        <button title="Group selection (Ctrl+G)" disabled={!sel.length} onClick={() => sel.length && run("node.group", { ids: sel })}>
          <Icon name="group" size={14} />
        </button>
      </div>
      <div className="layers">
        {rows.length === 0 && (
          <div className="empty">
            <b>Empty artboard</b>
            Pick a shape tool (<span className="kbd">R</span> <span className="kbd">O</span> <span className="kbd">P</span>) and drag on the canvas, or let an agent draw through the bridge.
            <div style={{ marginTop: 10 }}>
              <button className="chip" onClick={loadExample}>Open the example</button>
            </div>
          </div>
        )}
        {rows.map(({ node, depth }) => (
          <div
            key={node.id}
            className={`layer ${sel.includes(node.id) ? "sel" : ""} ${node.visible ? "" : "hidden"} ${drop?.id === node.id ? `drop-${drop.where}` : ""}`}
            style={{ paddingLeft: 2 + depth * 14 }}
            draggable={renaming !== node.id}
            onDragStart={(e) => {
              setDragId(node.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const y = (e.clientY - r.top) / r.height;
              setDrop({ id: node.id, where: node.type === "group" && y > 0.3 && y < 0.7 ? "in" : y < 0.5 ? "above" : "below" });
            }}
            onDragLeave={() => setDrop(null)}
            onDrop={(e) => {
              e.preventDefault();
              commitDrop();
              setDrop(null);
              setDragId(null);
            }}
            onClick={(e) => click(e, node.id)}
            onDoubleClick={() => setRenaming(node.id)}
          >
            {node.type === "group" ? (
              <button
                className="twisty"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(node.id, collapsed[node.id] ?? node.children.length > 8);
                }}
                style={{ transform: (collapsed[node.id] ?? node.children.length > 8) ? "rotate(-90deg)" : undefined }}
              >
                <Icon name="chevron" size={12} />
              </button>
            ) : (
              <span style={{ width: 14 }} />
            )}
            <span className="glyph">
              <Icon name={NODE_ICON[node.type]!} size={14} />
            </span>
            {renaming === node.id ? (
              <input
                className="lname"
                autoFocus
                defaultValue={node.name}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== node.name) run("node.update", { id: node.id, props: { name: e.target.value.trim() } });
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                  e.stopPropagation();
                }}
              />
            ) : (
              <span className="lname">{node.name}</span>
            )}
            <button
              className={`eye ${node.locked ? "off" : ""}`}
              title={node.locked ? "Unlock" : "Lock"}
              onClick={(e) => {
                e.stopPropagation();
                run("node.update", { id: node.id, props: { locked: !node.locked } });
              }}
            >
              <Icon name={node.locked ? "lock" : "unlock"} size={13} />
            </button>
            <button
              className={`eye ${node.visible ? "" : "off"}`}
              title={node.visible ? "Hide" : "Show"}
              onClick={(e) => {
                e.stopPropagation();
                run("node.update", { id: node.id, props: { visible: !node.visible } });
              }}
            >
              <Icon name={node.visible ? "eye" : "eyeOff"} size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="anims">
        <div className="h">
          Animations
          <button
            title="New animation"
            onClick={() => {
              run("anim.new", { name: `Animation ${anims.length + 1}`, duration: 2 });
              setUi({ mode: "animate" });
              setTime(0);
            }}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
        {anims.length === 0 && <div className="empty" style={{ marginTop: 0 }}>Switch to Animate to create your first timeline.</div>}
        {anims.map((a) => (
          <div
            key={a.id}
            className={`anim-row ${a.id === doc.activeAnimation ? "on" : ""}`}
            onClick={() => {
              if (a.id !== doc.activeAnimation) run("anim.select", { id: a.id });
              setUi({ mode: "animate", selectedKey: null });
              setTime(Math.min(editor.state.time, a.duration));
            }}
          >
            <Icon name="film" size={14} /> {a.name}
            <small>{a.duration.toFixed(1)}s</small>
          </div>
        ))}
      </div>
    </aside>
  );
}
