import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createEditor, type AnimaDocument, type Editor } from "@raveanima/core";

/**
 * Where commands run: an in-process editor (headless) or the open desktop window (live bridge).
 * Both speak the same command registry, so agents use one vocabulary everywhere.
 */
export interface Backend {
  readonly kind: "headless" | "live";
  execute(command: string, params?: unknown): Promise<unknown>;
  batch(steps: { command: string; params?: unknown }[]): Promise<unknown[]>;
  document(): Promise<AnimaDocument>;
  load(doc: AnimaDocument): Promise<void>;
}

export class LocalBackend implements Backend {
  readonly kind = "headless" as const;
  constructor(readonly editor: Editor = createEditor()) {}
  async execute(command: string, params: unknown = {}) {
    return this.editor.execute(command, params);
  }
  async batch(steps: { command: string; params?: unknown }[]) {
    return this.editor.batch(steps);
  }
  async document() {
    return this.editor.doc;
  }
  async load(doc: AnimaDocument) {
    this.editor.load(doc);
  }
}

export const DEFAULT_BRIDGE_PORT = 47900;
export const DEFAULT_TOKEN_FILE = join(homedir(), ".config", "anima", "bridge.token");

/** Talks to the desktop app's local control channel (127.0.0.1 only, bearer token). */
export class BridgeBackend implements Backend {
  readonly kind = "live" as const;
  private token: string;
  constructor(
    private url = `http://127.0.0.1:${DEFAULT_BRIDGE_PORT}`,
    tokenFile = DEFAULT_TOKEN_FILE,
  ) {
    try {
      this.token = readFileSync(tokenFile, "utf8").trim();
    } catch {
      throw new Error(`Bridge token not found at ${tokenFile}. Start the RaveAnima desktop app first (it writes the token on launch).`);
    }
  }

  private async rpc(method: string, params: unknown = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ method, params }),
      });
    } catch {
      throw new Error(`Cannot reach the RaveAnima window at ${this.url}. Is the desktop app open?`);
    }
    const body = (await res.json()) as { ok: boolean; result?: unknown; error?: string };
    if (!body.ok) throw new Error(body.error ?? `Bridge error ${res.status}`);
    return body.result;
  }

  execute(command: string, params: unknown = {}) {
    return this.rpc("execute", { command, params });
  }
  async batch(steps: { command: string; params?: unknown }[]) {
    return (await this.rpc("batch", { steps })) as unknown[];
  }
  async document() {
    return (await this.rpc("execute", { command: "doc.json", params: {} })) as AnimaDocument;
  }
  async load(doc: AnimaDocument) {
    await this.rpc("execute", { command: "doc.load", params: { document: doc } });
  }
}
