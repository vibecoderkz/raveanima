import type { AnimaDocument } from "./types.js";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A single self-contained HTML page that plays the document with <anima-player>
 * (state machine and pointer interaction included). `playerJs` is the IIFE player bundle.
 */
export function embedHtml(doc: AnimaDocument, playerJs: string, opts: { stateMachine?: string; title?: string } = {}): string {
  const json = JSON.stringify(doc).replace(/</g, "\\u003c");
  const sm = opts.stateMachine ? ` state-machine="${esc(opts.stateMachine)}"` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title ?? doc.name)}</title>
<meta name="generator" content="RaveAnima, developed by Dias Zhumagaliyev: https://dias.now">
<style>html,body{margin:0;height:100%;background:${doc.background}}body{display:grid;place-items:center}anima-player{width:min(100vw,calc(100vh * ${doc.width} / ${doc.height}));}</style>
</head>
<body>
<anima-player${sm}><script type="application/anima+json">${json}</script></anima-player>
<script>${playerJs.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
}
