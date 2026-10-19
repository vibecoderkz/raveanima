# RaveAnima

RaveAnima (formerly Anima, repo `vibecoderkz/raveanima`, MIT): desktop 2D vector design + animation editor (clean-room alternative to Rive) that AI agents can drive.
Research log: [RESEARCH.md](RESEARCH.md). Recon of Rive: [replica/recon.md](replica/recon.md), [replica/features.csv](replica/features.csv).

## Architecture
- `packages/core` (TS, no DOM): `types.ts` document model (plain JSON, ids `n1`, `a1`), `editor.ts` command registry
  + snapshot undo (`historyKey` coalesces drags, `batch` is atomic), `commands.ts` every command (zod params, they are
  the API for UI, CLI, MCP and bridge), `animation.ts` evaluate/loop, `easing.ts`, `geometry.ts`, `render.ts`
  (Canvas2D subset + SVG), `lottie.ts`.
- `packages/headless`: `render.ts` (@napi-rs/canvas PNG, contact sheet, ffmpeg video), `mcp.ts`, `cli.ts`, `backend.ts`
  (LocalBackend in-process, BridgeBackend -> desktop window). Build: `node build.mjs` -> `dist/anima.js`.
- `apps/desktop`: React UI (`src/store.ts` is the hub: `editProp` = design edit or auto-key in Animate mode),
  `src/canvas/Canvas.tsx` (tools, selection, handles, pen), `src/panels/*`, `src/platform.ts` (Tauri IPC, bridge
  listener). Rust `src-tauri/src/main.rs`: files, video_start/frame/finish -> ffmpeg, bridge HTTP on 127.0.0.1:47900.

## Rules
- Clean-room: learn Rive from public docs and the MIT runtime only. Never decompile or copy the Rive editor.
- New features = new commands in `core/commands.ts` first, UI second. Agents must be able to do everything the UI does.
- Error messages are part of the agent UX: name the field and the fix.
- Brand: dialektai style (SF Pro, `#FF3B2E`, ink `#0a0a0b`, `#f6f6f4`), heroicons outline, no emoji, no em-dash in UI copy.
- Attribution "Developed by Dias Zhumagaliyev: https://dias.now · hello@dias.now": About dialog, `raveanima --version`, `RaveAnima --version`, README footer. LICENSE is MIT.
- Names: user-facing name is RaveAnima (`PRODUCT_NAME` in core). Internal ids keep "anima" on purpose: `anima` CLI alias, `.anima` files and `format:"anima"`, MCP tool names, `<anima-player>`, `packages/headless/dist/anima.js`, `~/.config/anima/bridge.token`, port 47900, Tauri identifier, Cargo crate name.
- SF Pro font files are gitignored (Apple license forbids redistribution); never commit them.
- Before done: `npm run build` clean (tests + typecheck + bundles).
