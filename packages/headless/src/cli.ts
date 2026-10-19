import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ANIMA_VERSION, ATTRIBUTION, PRODUCT_NAME, createDocument, createEditor } from "@raveanima/core";
import { z } from "zod";
import { BridgeBackend, DEFAULT_BRIDGE_PORT, DEFAULT_TOKEN_FILE, LocalBackend } from "./backend.js";
import { GUIDE } from "./guide.js";
import { exportTo, readDocument, writeDocument } from "./io.js";
import { runStdio } from "./mcp.js";
import { renderContactSheet } from "./render.js";

const HELP = `${PRODUCT_NAME} ${ANIMA_VERSION}: 2D vector design and animation, for humans and AI agents

Usage ("anima" is an alias of "raveanima"):
  raveanima new <file.anima> [--width 1080] [--height 1080] [--background #ffffff] [--fps 60]
  raveanima inspect <file.anima>
  raveanima run <file.anima> <command> [json-params]      run one command and save the file
  raveanima batch <file.anima> <steps.json | ->           run [{command, params}] as one step and save
  raveanima export <file.anima> <out> [--time s] [--scale n] [--fps n] [--loops n]
                                                          out: .json (Lottie) .html (interactive) .svg .png .mp4 .webm .mov .gif .anima
  raveanima sheet <file.anima> <out.png> [--frames 8] [--keys]
                                                          contact sheet (--keys: sample around keyframes)
  raveanima commands [--filter text] [--json]
  raveanima guide                                         primer for agents
  raveanima mcp [--live] [--port ${DEFAULT_BRIDGE_PORT}] [--token-file path] [--root dir]...
                                                          MCP server on stdio (headless, or --live to drive the open window)
  raveanima --version

${ATTRIBUTION}`;

function fail(msg: string): never {
  process.stderr.write(`raveanima: ${msg}\n`);
  process.exit(1);
}

function parseJson(s: string | undefined, what: string): unknown {
  if (s === undefined) return {};
  try {
    return JSON.parse(s);
  } catch {
    fail(`${what} is not valid JSON: ${s}`);
  }
}

function print(v: unknown) {
  process.stdout.write((typeof v === "string" ? v : JSON.stringify(v, null, 2)) + "\n");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values: o, positionals: pos } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
      width: { type: "string" },
      height: { type: "string" },
      background: { type: "string" },
      fps: { type: "string" },
      time: { type: "string" },
      scale: { type: "string" },
      loops: { type: "string" },
      frames: { type: "string" },
      filter: { type: "string" },
      json: { type: "boolean" },
      keys: { type: "boolean" },
      live: { type: "boolean" },
      port: { type: "string" },
      "token-file": { type: "string" },
      root: { type: "string", multiple: true },
    },
  });
  const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
  const [cmd, ...rest] = pos;

  if (o.version) return print(`${PRODUCT_NAME} ${ANIMA_VERSION}\n${ATTRIBUTION}`);
  if (o.help || !cmd) return print(HELP);

  switch (cmd) {
    case "new": {
      const file = rest[0] ?? fail("new: missing <file.anima>");
      if (existsSync(file)) fail(`${file} already exists`);
      writeDocument(file, createDocument({ name: file.replace(/^.*\//, "").replace(/\.anima$/, ""), width: num(o.width), height: num(o.height), background: o.background, fps: num(o.fps) }));
      return print({ created: file });
    }
    case "inspect": {
      const ed = createEditor(readDocument(rest[0] ?? fail("inspect: missing file")));
      return print(ed.execute("doc.inspect"));
    }
    case "run": {
      const [file, command, params] = rest;
      if (!file || !command) fail("run: usage raveanima run <file.anima> <command> [json-params]");
      const ed = createEditor(readDocument(file));
      const result = ed.execute(command, parseJson(params, "params"));
      const def = ed.command(command);
      if (def.mutates || command === "doc.new" || command === "doc.load") writeDocument(file, ed.doc);
      return print(result ?? { ok: true });
    }
    case "batch": {
      const [file, src] = rest;
      if (!file || !src) fail("batch: usage raveanima batch <file.anima> <steps.json | ->");
      const raw = src === "-" ? readFileSync(0, "utf8") : readFileSync(src, "utf8");
      const steps = z.array(z.object({ command: z.string(), params: z.unknown().optional() })).parse(parseJson(raw, "steps"));
      const ed = createEditor(readDocument(file));
      const results = ed.batch(steps);
      writeDocument(file, ed.doc);
      return print(results);
    }
    case "export": {
      const [file, out] = rest;
      if (!file || !out) fail("export: usage raveanima export <file.anima> <out>");
      return print(await exportTo(readDocument(file), out, { time: num(o.time), scale: num(o.scale), fps: num(o.fps), loops: num(o.loops) }));
    }
    case "sheet": {
      const [file, out] = rest;
      if (!file || !out) fail("sheet: usage raveanima sheet <file.anima> <out.png>");
      writeFileSync(out, await renderContactSheet(readDocument(file), { frames: num(o.frames), mode: o.keys ? "keys" : "even" }));
      return print({ path: out });
    }
    case "commands": {
      const list = createEditor().commands(o.filter);
      if (o.json) return print(list.map((c) => ({ id: c.id, title: c.title, description: c.description, mutates: c.mutates, params: z.toJSONSchema(c.params, { io: "input", unrepresentable: "any" }) })));
      return print(list.map((c) => `${c.id.padEnd(18)} ${c.description}`).join("\n"));
    }
    case "guide":
      return print(GUIDE);
    case "mcp": {
      const backend = o.live ? new BridgeBackend(`http://127.0.0.1:${o.port ?? DEFAULT_BRIDGE_PORT}`, o["token-file"] ?? DEFAULT_TOKEN_FILE) : new LocalBackend();
      await runStdio({ backend, roots: o.root });
      return;
    }
    default:
      fail(`unknown command "${cmd}". Run raveanima --help`);
  }
}
