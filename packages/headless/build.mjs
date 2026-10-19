import { readFileSync } from "node:fs";
import { build } from "esbuild";

// The web player is embedded into exported .html files.
const playerJs = readFileSync(new URL("../player/dist/anima-player.iife.js", import.meta.url), "utf8");

await build({
  entryPoints: ["src/bin.ts"],
  outfile: "dist/anima.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: ["@napi-rs/canvas"],
  define: { __PLAYER_JS__: JSON.stringify(playerJs) },
  logLevel: "info",
});
