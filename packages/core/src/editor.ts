import { z } from "zod";
import { clone, createDocument } from "./doc.js";
import type { AnimaDocument } from "./types.js";

export interface EditorState {
  doc: AnimaDocument;
  selection: string[];
  time: number; // playhead, seconds
}

export interface CommandContext {
  editor: Editor;
  /** The live document. Mutating commands edit it in place; the editor snapshots it first. */
  doc: AnimaDocument;
}

export interface CommandDef<S extends z.ZodType = z.ZodType, R = unknown> {
  id: string;
  title: string;
  description: string;
  params: S;
  /** Mutating commands go through undo history; queries and view state do not. */
  mutates: boolean;
  run(ctx: CommandContext, params: z.output<S>): R;
}

export function defineCommand<S extends z.ZodType, R>(def: CommandDef<S, R>): CommandDef<S, R> {
  return def;
}

export interface ExecuteOptions {
  /**
   * Consecutive commands with the same key share one undo step (a drag that sends many
   * node.update calls). Use a fresh key per gesture.
   */
  historyKey?: string;
}

export interface ChangeEvent {
  command: string;
  state: EditorState;
}

interface HistoryEntry {
  doc: AnimaDocument;
  selection: string[];
  label: string;
  key?: string;
}

const HISTORY_LIMIT = 200;

/**
 * One editor session: the document, selection, playhead and undo history, plus the command
 * registry every surface goes through (desktop UI, CLI, MCP server, live bridge).
 */
export class Editor {
  state: EditorState;
  private registry = new Map<string, CommandDef>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<(e: ChangeEvent) => void>();
  dirty = false;

  constructor(commands: CommandDef[] = [], doc: AnimaDocument = createDocument()) {
    this.state = { doc, selection: [], time: 0 };
    for (const c of commands) this.register(c);
  }

  get doc(): AnimaDocument {
    return this.state.doc;
  }

  register(def: CommandDef): void {
    if (this.registry.has(def.id)) throw new Error(`Command "${def.id}" is already registered`);
    this.registry.set(def.id, def);
  }

  commands(filter?: string): CommandDef[] {
    const all = [...this.registry.values()];
    if (!filter) return all;
    const exact = this.registry.get(filter);
    if (exact) return [exact];
    const f = filter.toLowerCase();
    return all.filter((c) => c.id.toLowerCase().includes(f) || c.title.toLowerCase().includes(f) || c.description.toLowerCase().includes(f));
  }

  command(id: string): CommandDef {
    const c = this.registry.get(id);
    if (!c) {
      const near = this.commands(id.split(".")[0]).map((x) => x.id);
      throw new Error(`Unknown command "${id}".${near.length ? ` Did you mean: ${near.slice(0, 8).join(", ")}?` : ""}`);
    }
    return c;
  }

  execute<R = unknown>(id: string, params: unknown = {}, opts: ExecuteOptions = {}): R {
    const def = this.command(id);
    const parsed = def.params.safeParse(params ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`).join("; ");
      throw new Error(`${id}: invalid params. ${issues}`);
    }
    if (!def.mutates) {
      const before = { selection: this.state.selection, time: this.state.time };
      const r = def.run({ editor: this, doc: this.state.doc }, parsed.data) as R;
      if (before.selection !== this.state.selection || before.time !== this.state.time) this.emit(id);
      return r;
    }
    const snapshot: HistoryEntry = { doc: clone(this.state.doc), selection: [...this.state.selection], label: def.title, key: opts.historyKey };
    let result: R;
    try {
      result = def.run({ editor: this, doc: this.state.doc }, parsed.data) as R;
    } catch (err) {
      this.state.doc = snapshot.doc;
      this.state.selection = snapshot.selection;
      throw err;
    }
    const top = this.undoStack[this.undoStack.length - 1];
    if (!(opts.historyKey && top?.key === opts.historyKey)) {
      this.undoStack.push(snapshot);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.pruneSelection();
    this.dirty = true;
    this.emit(id);
    return result;
  }

  /** Several commands as one undo step; rolls back all of them if any fails. */
  batch(steps: { command: string; params?: unknown }[]): unknown[] {
    const snapshot: HistoryEntry = { doc: clone(this.state.doc), selection: [...this.state.selection], label: "Batch" };
    const key = `batch-${Math.random().toString(36).slice(2)}`;
    const results: unknown[] = [];
    const undoLen = this.undoStack.length;
    try {
      for (const s of steps) results.push(this.execute(s.command, s.params ?? {}, { historyKey: key }));
    } catch (err) {
      this.state.doc = snapshot.doc;
      this.state.selection = snapshot.selection;
      this.undoStack.length = undoLen;
      this.emit("batch");
      throw err;
    }
    if (this.undoStack.length > undoLen) this.undoStack.splice(undoLen, this.undoStack.length - undoLen, snapshot);
    return results;
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.redoStack.push({ doc: clone(this.state.doc), selection: [...this.state.selection], label: e.label });
    this.state.doc = e.doc;
    this.state.selection = e.selection;
    this.pruneSelection();
    this.dirty = true;
    this.emit("history.undo");
    return true;
  }

  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.undoStack.push({ doc: clone(this.state.doc), selection: [...this.state.selection], label: e.label });
    this.state.doc = e.doc;
    this.state.selection = e.selection;
    this.pruneSelection();
    this.dirty = true;
    this.emit("history.redo");
    return true;
  }

  history(): { undo: string[]; redo: string[] } {
    return { undo: this.undoStack.map((e) => e.label), redo: this.redoStack.map((e) => e.label) };
  }

  /** Replace the document (open file, doc.new). Clears history. */
  load(doc: AnimaDocument): void {
    this.state = { doc, selection: [], time: 0 };
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit("doc.load");
  }

  subscribe(fn: (e: ChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private pruneSelection(): void {
    this.state.selection = this.state.selection.filter((id) => id in this.state.doc.nodes);
  }

  private emit(command: string): void {
    for (const l of this.listeners) l({ command, state: this.state });
  }
}
