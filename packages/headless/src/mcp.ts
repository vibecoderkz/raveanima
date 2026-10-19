import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve, sep } from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ANIMA_VERSION, createEditor } from "@raveanima/core";
import type { Backend } from "./backend.js";
import { GUIDE } from "./guide.js";
import { exportTo, readDocument } from "./io.js";
import { renderContactSheet, renderPng } from "./render.js";

export interface McpOptions {
  backend: Backend;
  /** File access is limited to these directories (default: home). */
  roots?: string[];
}

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const text = (v: unknown): { content: Content[] } => ({
  content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }],
});

export function buildServer({ backend, roots = [homedir()] }: McpOptions): McpServer {
  const server = new McpServer({ name: "anima", version: ANIMA_VERSION });
  // The registry is the same in every backend, so a local editor answers schema questions.
  const registry = createEditor();

  const safePath = (p: string) => {
    const abs = resolve(p);
    if (!roots.some((r) => abs === resolve(r) || abs.startsWith(resolve(r) + sep))) throw new Error(`Path ${abs} is outside the allowed roots: ${roots.join(", ")}`);
    return abs;
  };

  const guard =
    <A>(fn: (a: A) => Promise<{ content: Content[] }>) =>
    async (a: A) => {
      try {
        return await fn(a);
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    };

  server.registerTool(
    "anima_guide",
    { title: "How to use RaveAnima", description: "Read first: coordinate system, node types, animation model and the recommended workflow.", inputSchema: {} },
    async () => text(`${GUIDE}\nMode: ${backend.kind === "live" ? "live (driving the open RaveAnima window)" : "headless (in-memory document)"}`),
  );

  server.registerTool(
    "command_list",
    {
      title: "List commands",
      description: "Commands with descriptions and JSON Schema of their params. filter matches id, title or description (e.g. 'keyframe', 'node').",
      inputSchema: { filter: z.string().optional(), schemas: z.boolean().default(true).describe("Include param JSON Schemas") },
    },
    guard(async ({ filter, schemas }) =>
      text(
        registry.commands(filter).map((c) => ({
          id: c.id,
          description: c.description,
          ...(schemas ? { params: z.toJSONSchema(c.params, { io: "input", unrepresentable: "any" }) } : {}),
        })),
      ),
    ),
  );

  server.registerTool(
    "command_run",
    {
      title: "Run command",
      description: "Run one editor command, e.g. {command:'node.add', params:{type:'rect', props:{width:200,height:100,fill:'#FF3B2E',transform:{x:540,y:540}}}}.",
      inputSchema: { command: z.string(), params: z.record(z.string(), z.unknown()).default({}) },
    },
    guard(async ({ command, params }) => text((await backend.execute(command, params)) ?? { ok: true })),
  );

  server.registerTool(
    "command_batch",
    {
      title: "Run commands",
      description: "Run several commands in order as one undo step. Atomic: if one fails, nothing is applied. Returns each result.",
      inputSchema: { steps: z.array(z.object({ command: z.string(), params: z.record(z.string(), z.unknown()).default({}) })).min(1) },
    },
    guard(async ({ steps }) => text(await backend.batch(steps))),
  );

  server.registerTool(
    "doc_inspect",
    { title: "Inspect document", description: "Artboard, node tree with ids and world bounds, animations and tracks.", inputSchema: {} },
    guard(async () => text(await backend.execute("doc.inspect"))),
  );

  server.registerTool(
    "doc_open",
    { title: "Open file", description: "Open an .anima file (absolute path) as the current document.", inputSchema: { path: z.string() } },
    guard(async ({ path }) => {
      await backend.load(readDocument(safePath(path)));
      return text(await backend.execute("doc.inspect"));
    }),
  );

  server.registerTool(
    "doc_import",
    {
      title: "Import file",
      description: "Import an .svg (becomes editable paths/groups) or a raster image (.png/.jpg/.webp, embedded as an image node) into the current document. Optional width (px) to fit, and x,y centre for images / top-left for SVG.",
      inputSchema: { path: z.string(), width: z.number().positive().optional(), x: z.number().optional(), y: z.number().optional() },
    },
    guard(async ({ path, width, x, y }) => {
      const abs = safePath(path);
      if (abs.toLowerCase().endsWith(".svg")) {
        const svg = readFileSync(abs, "utf8");
        return text(await backend.execute("import.svg", { svg, width, x, y, name: basename(abs).replace(/\.svg$/i, "") }));
      }
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[abs.split(".").pop()!.toLowerCase()];
      if (!mime) throw new Error("Use .svg, .png, .jpg, .webp or .gif");
      const data = readFileSync(abs);
      const img = await loadImage(data);
      const doc = await backend.document();
      const w = width ?? Math.min(img.width, doc.width * 0.8);
      const h = (img.height / img.width) * w;
      const src = `data:${mime};base64,${data.toString("base64")}`;
      return text(await backend.execute("node.add", { type: "image", props: { name: basename(abs), src, width: Math.round(w), height: Math.round(h), transform: { x: x ?? doc.width / 2, y: y ?? doc.height / 2 } } }));
    }),
  );

  server.registerTool(
    "export",
    {
      title: "Save / export",
      description: "Write the document; the extension picks the format: .anima (editable source), .json (Lottie), .html (self-contained interactive page with the web player and state machines), .svg / .png (frame at `time`), .mp4 / .webm / .mov / .gif (rendered animation).",
      inputSchema: {
        path: z.string().describe("Absolute output path"),
        time: z.number().optional(),
        animation: z.string().optional(),
        scale: z.number().positive().max(8).optional(),
        fps: z.number().int().min(1).max(120).optional(),
        loops: z.number().int().min(1).max(20).optional(),
      },
    },
    guard(async ({ path, ...opts }) => {
      const doc = await backend.document();
      const out = await exportTo(doc, safePath(path), opts);
      if (out.format !== "lottie") return text(out);
      const r = (await backend.execute("export.lottie", { animation: opts.animation })) as { warnings: string[] };
      return text({ ...out, warnings: r.warnings });
    }),
  );

  server.registerTool(
    "render_preview",
    {
      title: "Look at a frame",
      description: "PNG of the artboard at `time` seconds (animation applied). Use it to check your work.",
      inputSchema: { time: z.number().default(0), animation: z.string().optional(), maxSize: z.number().int().min(64).max(2048).default(768) },
    },
    guard(async ({ time, animation, maxSize }) => {
      const png = await renderPng(await backend.document(), { time, animation, maxSize });
      return { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }] };
    }),
  );

  server.registerTool(
    "render_contact_sheet",
    {
      title: "Look at the motion",
      description: "One PNG grid of frames across the animation, each labelled with its time. mode 'even' spaces them evenly; 'keys' samples keyframe times and midpoints so short events (blinks, hits) are never missed. The fastest way to judge an animation.",
      inputSchema: { frames: z.number().int().min(2).max(36).default(8), animation: z.string().optional(), cell: z.number().int().min(96).max(640).default(280), mode: z.enum(["even", "keys"]).default("even") },
    },
    guard(async ({ frames, animation, cell, mode }) => {
      const png = await renderContactSheet(await backend.document(), { frames, animation, cell, mode });
      return { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }] };
    }),
  );

  return server;
}

export async function runStdio(opts: McpOptions): Promise<void> {
  const server = buildServer(opts);
  await server.connect(new StdioServerTransport());
}
