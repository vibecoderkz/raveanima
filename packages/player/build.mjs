import { build } from "esbuild";

const banner = { js: "/* RaveAnima Player 0.2.0. Developed by Dias Zhumagaliyev: https://dias.now. MIT License */" };
// ESM for bundlers, IIFE for a plain <script> tag (and for embedding into exported HTML).
await build({ entryPoints: ["src/player.ts"], outfile: "dist/anima-player.js", bundle: true, format: "esm", minify: true, target: "es2020", banner, logLevel: "info" });
await build({ entryPoints: ["src/player.ts"], outfile: "dist/anima-player.iife.js", bundle: true, format: "iife", globalName: "AnimaPlayer", minify: true, target: "es2020", banner, logLevel: "info" });
