# Recon map: Rive editor (desktop: macOS/Windows app + browser editor)

Scope: the Rive **editor** feature set (Design mode, Animate mode, State Machine, rigging, data binding, scripting, export, collaboration, AI/agent surfaces), plus the open `.riv` runtime format. Runtimes are referenced only for format notes.
For: Anima (working name), a desktop 2D vector design + animation editor built for humans and AI agents. First MVP goal: draw 2D vector shapes, animate them, export Lottie.
Date: 2026-10-18
Method: clean-room. Public docs (rive.app/docs, including its `llms.txt` index and `.md` page variants), rive.app/pricing, Bing results, and the MIT runtime repo `rive-app/rive-runtime` (read only to locate format definitions). No Rive editor binary was downloaded, run or inspected. No account was used. All descriptions below are paraphrased.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | docs index for LLMs | https://rive.app/docs/llms.txt | full page list; every page also has a `.md` variant |
| 2 | pricing page | https://rive.app/pricing | plan cards + full comparison grid (read 2026-10-18) |
| 3 | pricing doc | https://rive.app/docs/account-admin/pricing | monthly vs annual prices; slightly different wording from #2 |
| 4 | interface overview | https://rive.app/docs/editor/interface-overview/overview | panels: file browser, toolbar, sidebar, inspector, viewport, timeline, SM graph, debug |
| 5 | toolbar | https://rive.app/docs/editor/interface-overview/toolbar | tools, Invite, Publish, mode toggle |
| 6 | keyboard shortcuts | https://rive.app/docs/editor/keyboard-shortcuts | complete documented shortcut table |
| 7 | design/animate modes | https://rive.app/docs/editor/fundamentals/design-vs-animate-mode | auto-key behaviour |
| 8 | artboards | https://rive.app/docs/editor/fundamentals/artboards | |
| 9 | components | https://rive.app/docs/editor/fundamentals/components | reusable artboards |
| 10 | shapes & paths | https://rive.app/docs/editor/fundamentals/shapes-and-paths-overview | shape layer vs path layer model |
| 11 | shape tools | https://rive.app/docs/editor/fundamentals/procedural-shapes | rect/ellipse/polygon/star, procedural props |
| 12 | pen tool | https://rive.app/docs/editor/fundamentals/pen-tool-overview | |
| 13 | edit vertices | https://rive.app/docs/editor/fundamentals/edit-vertices | vertex types, simplify, reverse |
| 14 | shape builder | https://rive.app/docs/editor/design/shape-builder | merge/subtract regions |
| 15 | freehand | https://rive.app/docs/editor/design/freehand-drawing | pencil, brush (spines), eraser |
| 16 | bucket tool | https://rive.app/docs/editor/design/bucket-tool | |
| 17 | shape bend | https://rive.app/docs/editor/design/shape-bend-tool | |
| 18 | fill & stroke | https://rive.app/docs/editor/fundamentals/fill-and-stroke | multi fills/strokes, gradients, fill rules, feather |
| 19 | trim path | https://rive.app/docs/editor/manipulating-shapes/trim-path | trim + dashes |
| 20 | clipping | https://rive.app/docs/editor/manipulating-shapes/clipping | |
| 21 | groups / solos / transform spaces / freeze | https://rive.app/docs/editor/fundamentals/groups , https://rive.app/docs/editor/manipulating-shapes/solos , https://rive.app/docs/editor/fundamentals/transform-spaces , https://rive.app/docs/editor/fundamentals/freeze-and-origin | |
| 22 | align & distribute, rulers & guides | https://rive.app/docs/editor/fundamentals/align-and-distribute , https://rive.app/docs/editor/design/rulers-and-guides | |
| 23 | selection & navigation, hierarchy | https://rive.app/docs/editor/interface-overview/selection-and-navigation , https://rive.app/docs/editor/interface-overview/hierarchy | |
| 24 | text | https://rive.app/docs/editor/text/text-overview , https://rive.app/docs/editor/text/text-modifiers | |
| 25 | layouts | https://rive.app/docs/editor/layouts/layouts-overview , https://rive.app/docs/editor/layouts/layout-parameters | flexbox-like rows/columns/grid/stack |
| 26 | assets, SVG, Lottie import | https://rive.app/docs/editor/fundamentals/assets-overview , https://rive.app/docs/editor/assets/svg , https://rive.app/docs/editor/assets/lottie | |
| 27 | timeline, keys, interpolation | https://rive.app/docs/editor/animate-mode/timeline , https://rive.app/docs/editor/animate-mode/keys , https://rive.app/docs/editor/animate-mode/interpolation-easing | |
| 28 | draw order animation | https://rive.app/docs/editor/animate-mode/animating-draw-order | |
| 29 | state machine | https://rive.app/docs/editor/state-machine/state-machine , .../states , .../transitions , .../layers , .../listeners | |
| 30 | events | https://rive.app/docs/editor/events/overview | |
| 31 | data binding | https://rive.app/docs/editor/data-binding/overview , .../property-types , .../converters | |
| 32 | bones, meshes, joysticks, constraints, IK | https://rive.app/docs/editor/manipulating-shapes/bones , .../meshes , .../joysticks , https://rive.app/docs/editor/constraints/constraints-overview , .../ik-constraint , .../follow-path-constraint | |
| 33 | export | https://rive.app/docs/editor/exporting/exporting-for-runtime , .../exporting-for-video-and-static-design , .../exporting-for-backup , https://rive.app/docs/editor/embed-urls/overview | |
| 34 | revision history, file browser, libraries | https://rive.app/docs/editor/fundamentals/revision-history , https://rive.app/docs/editor/interface-overview/file-browser , https://rive.app/docs/editor/libraries | |
| 35 | scripting | https://rive.app/docs/scripting/getting-started | Luau scripts, WGSL shaders |
| 36 | AI agent (in editor) | https://rive.app/docs/editor/ai-agent/ai-agent | |
| 37 | MCP integration | https://rive.app/docs/editor/ai/mcp | |
| 38 | Rive CLI | https://rive.app/docs/cli/overview , https://rive.app/docs/cli/agents , https://rive.app/docs/cli/reference/commands | |
| 39 | RML (Rive Markup Language) | https://rive.app/docs/runtimes/advanced-topic/rml | XML text form of a Rive file |
| 40 | .riv format doc | https://rive.app/docs/runtimes/advanced-topic/format | |
| 41 | runtime repo (MIT) | https://github.com/rive-app/rive-runtime | format pointers only |
| 42 | web runtime repo (MIT) | https://github.com/rive-app/rive-wasm | |
| 43 | Bing search for Lottie export | https://www.bing.com/search?q=rive+editor+export+to+lottie+json | shows only third-party Rive to Lottie converters |

## Core loop

Draw vector art on an artboard, key its properties on timelines, wire timelines into a state machine driven by data/inputs, and publish one `.riv` that plays interactively in any runtime.
For Anima's MVP the relevant slice is the first two steps plus an export target Rive does **not** offer (Lottie).

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | File browser | app launch / home | recent files, projects, folders, workspaces, marketplace examples, new file | sidebar (search, recent, shared, projects), file grid, context menu (open, duplicate, delete, download .riv/.rev/revision) | empty, filled; projects/folders gated to paid (src 34) |
| S02 | New file / artboard dialog | new file | pick artboard preset size or custom W/H | preset list, size fields | default |
| S03 | Editor shell | open file | main workspace | top toolbar, left sidebar, center viewport/stage, right inspector, bottom timeline (animate mode), file tabs | design mode, animate mode |
| S04 | Stage / viewport | center of S03 | draw, select, transform; also hosts script editor tabs | artboards, selection box, handles, rulers, guides, view-options menu (show bones, targets, events, joysticks) | design, animate (auto-key), freeze mode (blue outline), edit-vertices mode, mesh edit mode |
| S05 | Hierarchy panel | sidebar, Cmd/Ctrl+1 | tree of objects per artboard, draw order, visibility, rename, reparent by drag | tree rows, expand/collapse, eye toggle, solo radio buttons | empty artboard, nested |
| S06 | Inspector | right sidebar | properties of selection | transform fields, align/distribute row, fill/stroke stack, color picker with gradient bar, constraints list, layout section, clipping, draw-order rules, key buttons next to animatable props | nothing selected shows default interpolation; multi-select; key button states (unkeyed grey, animated blue stroke, key-at-playhead blue fill) |
| S07 | Color picker popover | click fill/stroke swatch | solid / linear / radial, stops | type dropdown, stop bar, sliders, hex | solid, gradient |
| S08 | Data panel | sidebar, Cmd/Ctrl+2 | view models, properties, instances, enums | property list with type menu | empty, filled |
| S09 | Assets panel | sidebar, Cmd/Ctrl+3 | images, fonts, audio, blobs, scripts, converters, components | list with filters, + import menu | empty, filled |
| S10 | Animations list | sidebar, Cmd/Ctrl+4 | timelines and state machines of the active artboard | list, + menu (timeline / state machine) | |
| S11 | Timeline | bottom, animate mode | key properties over time | playback controls, loop type (one-shot, loop, ping-pong), work area, duration, fps/snap, speed, show-only-selected, key rows (object grey keys, property blue keys), zoom scrollbar | no keys, keyed, selection |
| S12 | Interpolation panel | right of timeline when keys selected | easing per key segment | type icons (hold, linear, cubic, elastic), bezier preview with handles, 4-number field, set-as-default | |
| S13 | Graph editor | toggle on timeline, Shift+F3 | value/speed curves of selected objects | curves, cubic-value handles, graph type cycle (Shift+G) | |
| S14 | State machine graph | select a state machine | visual state graph | Entry/Exit/Any states, animation states, blend states, transition arrows, layers tab, listeners list, inspector for transitions/conditions/actions | |
| S15 | Agent panel | sidebar, Cmd/Ctrl+5 | in-editor AI chat | chat thread, new/toggle/close chat | out of credits |
| S16 | Script editor | viewport tab | Luau scripts and WGSL shaders | code editor, diagnostics | |
| S17 | Debug panel | bottom/side | logs, problems, AI changes, tests, audio | tabs | |
| S18 | Render presets + render queue (cloud renderer) | artboard inspector + file menu | export MP4/GIF/WebM/PNG seq/SVG seq/PNG/SVG | preset list (animation, format, fps, duration, bitrate, size), queue window, completed tab | queued, rendering, completed |
| S19 | Publish / export menu | blue Publish button | export .riv, publish library, embed, marketplace | menu | splash-screen watermark on Free (src 2) |
| S20 | Embed URL dialog | main menu | hosted snapshot link | artboard + SM/animation picker, renderer toggle, multi-touch, enable switch | paid (Voyager+) |
| S21 | Revision history | editor menu | browse/restore/name revisions | revision list, "edit current revision" | |
| S22 | Shortcuts panel | Shift+/ | shortcut reference | list | |
| S23 | Library publish panel | export menu | choose components/view models/enums to publish | checklist | Voyager+ |
| S24 | Dependency graph overlay | D | arrows showing constraint/binding dependencies | color-coded arrows, filter | |

## Flows

```
F01 Draw and animate a shape (Anima's MVP loop)
    S01 new file -> S02 pick size -> S03/S04 press R, drag rectangle -> S06 set fill
    -> Tab (animate mode) -> S10 timeline exists by default (uncertain) -> S11 move playhead
    -> S04 move/rotate shape (auto-keys) -> S12 pick cubic easing (F8) -> Space to play
    -> S19 export .riv  (Rive has no Lottie export)
    happy path clicks: about 10 to 12 plus drags
    edge: editing in animate mode with a timeline selected creates accidental keys (src 7);
          converting a procedural shape to a path drops its procedural animations (src 11)

F02 Custom path with pen and vertex edit
    S04 P -> click/drag vertices -> Esc -> Enter (edit vertices) -> toggle handle types
    (Cmd/Ctrl-click mirrored/straight, Alt-click detach) -> Done
    edge: winding direction affects fill rule and clipping (src 13, 20)

F03 Interactive button
    S11 make Idle/Hover/Press timelines -> S14 drag them onto graph -> draw transitions
    -> add condition on a view model property or listener (pointer enter/down) -> set duration/exit time
    -> Shift+Space to play default state machine
    edge: transitions with no condition fire immediately (src 29)

F04 Rig a character
    B to draw bone chain -> bind path vertices or image mesh to bones -> Shift+B weight tool
    -> add IK constraint on last bone with a Target group -> animate target

F05 Export video
    S06 artboard -> Render Presets + -> pick format -> Queue All -> S18 render in cloud -> download

F06 Agent / CLI round trip
    rive create proj -> agent writes RML/Luau -> rive proj --verify / inspect / --screenshot
    -> rive push (to account) -> open in editor -> rive pull
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Toolbar tool button + flyout | select/transform, create (shapes, pen, pencil, brush, eraser, text, bucket, shape builder, shape bend), hierarchy tools (group, solo, layout), rigging (bone, weight, joystick), events | active, hover, flyout open | S03 |
| Mode toggle | Design / Animate | | S03 |
| Inspector section | transform, align, fill/stroke stack, constraints, layout, clipping, draw order, text, guides, render presets | collapsed/expanded | S06 |
| Numeric field (scrubbable) | px, %, deg, unit toggle | default, keyed, bound | S06 |
| Key button (diamond) | | unkeyed, animated, keyed at playhead | S06 |
| Paint row (fill/stroke) | fill, stroke | visible/hidden, reorder by drag | S06 |
| Color picker | solid, linear, radial; gradient stop bar | | S07 |
| Tree view row | group, shape, path, bone, solo, layout, text, image, component instance | selected, hidden, expanded | S05 |
| Timeline key | object (grey), property (blue) | selected, dragging, resizing (Alt) | S11 |
| Bezier easing editor | interpolation panel, graph editor | | S12, S13 |
| Node graph | states, transitions with direction arrow | selected, active during play | S14 |
| Context menu | file, hierarchy, key (Data Bind) | | many |
| Chat panel | | thinking, out of credits | S15 |
| Code editor | Luau, WGSL | diagnostics | S16 |

## Inferred data model

Evidence for type names: RML doc (src 39) uses the editor type names directly; generated runtime headers in rive-runtime list folders `animation`, `shapes`, `shapes/paint`, `bones`, `constraints`, `text`, `layout`, `viewmodel`, `data_bind`, `assets`, `semantic`, `scripted`. Names marked (m) are medium confidence (recalled from the open headers' folder layout, not every file opened).

```
File/Backboard   default artboard, publish settings, assets, view models, enums, converters
                 evidence: RML doc ("Backboard" in bundles, rive.yaml in fragments); confidence: high
Artboard         name, width, height, origin, clip, fill, layout, defaultStateMachineId, viewModel
                 evidence: src 8, RML; confidence: high
Node/Transform   x, y, rotation (radians), scaleX/Y, opacity, parentId (index in artboard)
                 evidence: .riv doc (Node key 2, X key 13, Y key 14), node.json; confidence: high
Shape            drawable holding paths + paints; blend mode
                 evidence: src 10, shape.json (type key 3); confidence: high
Path             procedural: Rectangle(width,height,corner radii), Ellipse, Polygon(points,radius),
                 Star(points, inner radius), Triangle; custom: PointsPath with vertices
                 evidence: src 11, RML example (Triangle); confidence: high
PathVertex       x, y; Straight(radius) | CubicMirrored | CubicDetached | CubicAsymmetric (m)
                 evidence: src 13 handle types; confidence: medium (names)
Fill/Stroke      SolidColor | LinearGradient | RadialGradient(+ GradientStop color, position);
                 fillRule (nonZero, evenOdd, clockwise), feather; stroke thickness, cap, join,
                 TrimPath(start,end,offset,mode sequential/synced), dash list
                 evidence: src 18, 19; confidence: high (fields), medium (names)
ClippingShape    source shape, fillRule/op, inverse via even-odd
                 evidence: src 20; confidence: medium
Group / Solo / LayoutComponent    containers; Solo has activeComponentId
                 evidence: src 21, 25; confidence: medium
Text             TextStyle (font asset, size), TextValueRun (text, style), modifiers (range + props)
                 evidence: src 24; confidence: medium
Image + Mesh     image asset, mesh vertices/triangles, contour
                 evidence: src 32; confidence: medium
Bone/RootBone, Skin, Tendon, Weight    skinning of path vertices and mesh vertices
                 evidence: src 32 bones page; confidence: medium (names)
Constraint       IK(boneCount, invert, strength, targetId), Distance, Transform, Translation,
                 Rotation, Scale, FollowPath, Scroll; ordered list per object
                 evidence: src 32; confidence: high (types), medium (fields)
LinearAnimation  name, fps (default 60), duration, loop (oneShot|loop|pingPong), work area, speed
  KeyedObject    objectId
  KeyedProperty  propertyKey (same int keys as the core defs, e.g. 15 = rotation per RML doc)
  KeyFrame       frame, value (double|color|id|bool...), interpolationType (hold|linear|cubic),
                 interpolatorId -> CubicEase | CubicValue | Elastic(amplitude, period)
                 evidence: src 27, RML; confidence: high
StateMachine     layers -> states (Entry, Exit, Any, AnimationState, BlendState1D, BlendStateDirect),
                 transitions (duration ms, exit time, pause source, allow exit, interpolation,
                 conditions, actions, random weight), listeners (target, listen-to, actions)
                 evidence: src 29; confidence: high
Event            OpenUrl | Audio | General(deprecated); fired from timeline, state, transition, listener
                 evidence: src 30; confidence: high
ViewModel        properties: number, string, boolean, color, trigger, enum, image, font, blob,
                 artboard, nested view model, list; instances; DataBind(target prop, converter)
                 evidence: src 31; confidence: high
Asset            image (png/jpg/webp), font (ttf/otf), audio (mp3/wav/flac), blob, script;
                 export mode embedded | referenced | CDN
                 evidence: src 26; confidence: high
```

Relationships: File 1-n Artboard; Artboard 1-n Node tree (parent by index), 1-n LinearAnimation, 1-n StateMachine; Shape 1-n Path, 1-n Paint; LinearAnimation 1-n KeyedObject 1-n KeyedProperty 1-n KeyFrame; StateMachine 1-n Layer 1-n State, State 1-n Transition 1-n Condition; Artboard n-1 ViewModel.

Anima mapping note: this keyed-object/keyed-property/keyframe structure maps almost 1:1 onto Lottie's per-property keyframe arrays (`a:1`, `k:[{t,s,i,o,h}]`). Cubic and hold map directly; Elastic, Cubic Value overshoot, bones, meshes, constraints and IK have no Lottie equivalent and must be baked to keyframes on export.

## Open .riv format notes

All pointers are to MIT-licensed public code; summarized, not copied.

- **Official prose spec**: https://rive.app/docs/runtimes/advanced-topic/format . Little-endian. Primitive types: LEB128 varuint, 4-byte uint, string (varuint length + UTF-8), 32-bit float.
- **Header**: 4-byte fingerprint `RIVE`, then major version (varuint), minor version (varuint), file ID (varuint), then a Table of Contents: a zero-terminated list of property keys followed by a packed bit array giving 2 bits per property for its backing field type. The ToC lets an old runtime skip unknown properties. Properties known since the last major bump are "baselined" and not listed.
  - Reader: `include/rive/runtime_header.hpp` (fingerprint constant, `read()`, property-to-field map) https://github.com/rive-app/rive-runtime/blob/main/include/rive/runtime_header.hpp
- **Versioning**: runtimes accept exactly one major (currently 7); minors are forward/backward tolerant, unknown objects/properties become no-ops. Current runtime constants `majorVersion = 7`, `minorVersion = 4` in `include/rive/file.hpp` https://github.com/rive-app/rive-runtime/blob/main/include/rive/file.hpp
- **Body**: a flat stream of objects. Each object = varuint type key, then (property key, value) pairs, terminated by property key 0. Context is positional: objects after an Artboard belong to it; KeyFrames follow their LinearAnimation/KeyedObject/KeyedProperty. Parenting inside an artboard uses a `parentId` = index of the container within the artboard. Import logic uses an "ImportStack" in `src/file.cpp` https://github.com/rive-app/rive-runtime/blob/main/src/file.cpp
- **Binary reader**: `include/rive/core/binary_reader.hpp`, `src/core/binary_reader.cpp`; field codecs in `include/rive/core/field_types/` (bool, bytes, callback, color, double, fractional index, id, int, string, uint).
- **Type and property keys (generated)**: `include/rive/generated/` (381 files on main). One `*_base.hpp` per core type holds its `typeKey` and per-property `...PropertyKey` constants and default values, in folders `animation/`, `shapes/`, `shapes/paint/`, `bones/`, `constraints/`, `text/`, `layout/`, `viewmodel/`, `data_bind/`, `assets/`, `semantic/`, `scripted/`, `inputs/`. The master switch is `include/rive/generated/core_registry.hpp` (about 7k lines): `makeCoreInstance(typeKey)`, typed setters/getters by property key, `propertyFieldId(propertyKey)` (property -> field type, what the ToC needs), `objectSupportsProperty`, `propertyOwnerTypeKey`.
  https://github.com/rive-app/rive-runtime/tree/main/include/rive/generated
- **Core definition JSON ("core defs")**: the human-readable source of truth, one JSON per type with `name`, `key {int, string}`, `extends`, and `properties` each having `type`, `initialValue`, `key {int, string, alternates}`, flags such as `animates`, `bindable`, `runtime`. Example facts: Node = type 2, x = 13, y = 14; Shape = type 3.
  - **Important (verified 2026-10-18)**: `dev/defs/` is **no longer on `main`** of rive-runtime. It existed (371 JSON files) up to commit `845a82a9` (2026-08-21) and was removed in `d4fe1022` (2026-08-25). A comment in `dev/core_generator/lib/src/configuration.dart` says canonical defs now live with the (private) editor source. Use the last public snapshot: https://github.com/rive-app/rive-runtime/tree/845a82a9b67136e0b37272170504659a8ab4ca67/dev/defs (e.g. `dev/defs/node.json`, `dev/defs/shapes/shape.json`). The docs page still links the older rive-cpp tree `dev/defs` at commit 4512406.
  - Generator (Dart) that turns defs into the C++ headers: `dev/core_generator/` + `dev/generate_core.sh`.
- **Web runtime**: https://github.com/rive-app/rive-wasm (MIT, branch `master`) wraps the C++ runtime as WASM; useful for a `.riv` preview in Anima without reimplementing a reader.
- **Text form**: RML (src 39) is an XML 1:1 of the object model (element = type, attribute = property, ids like `0:12`, colors ARGB hex, rotation in radians, timing in frames at 60 fps default). The compiler lives only in the closed Rive CLI; the format description is public docs.
- Uncertain: whether Rive will keep publishing generated headers on main long-term; whether `.rev` (editor backup) format is documented anywhere (not found; treat as closed).

## AI-agent gap

What Rive offers today (all verified in docs, 2026-10-18):

1. **In-editor AI Agent** (src 36): chat panel that writes Luau scripts, layouts, view models and some animation. Paid plans; billed in USD credits (Voyager $20/seat/mo, Enterprise $40/seat/mo, top-ups; BYO API key on Voyager per src 2). Pricing page says Free has "Agent with limits" while the agent doc says Cadet and up (conflict, uncertain).
2. **MCP server inside the desktop editor** (src 37): Streamable HTTP at `http://127.0.0.1:9791/mcp`, desktop app on macOS/Windows only, needs the app open with a file and artboard. Tools cover artboards, hierarchy query/select/edit/reparent/delete, shapes/paths/layouts/components, linear animations, keyframes, interpolation, state machines/states/transitions/conditions, view models/bindings, Luau/WGSL edit + diagnostics + tests. Docs mention an "End Prompt" step before changes apply (unclear wording, uncertain). No Linux.
3. **Rive CLI + RML** (src 38, 39): `rive create` scaffolds a text project (`rive.yaml`, `scene.rml`, `AGENTS.md`, `CLAUDE.md`); `rive <dir>` live preview; `--verify`, `inspect --json`, `schema <Type> [--animatable|--bindable]`, `docs`, headless `--screenshot`, `--bench`, simulated `--pointer`/`--key`/`--advance`, `--data` set and `--data-dump` read back, `--test` for Luau tests, `push`/`pull` to the cloud file, `lsp`. `--publish` output is watermarked unless the bound file is on Cadet+.
4. **Scripting in-file** (Luau + WGSL) with test scripts; public runtime APIs to drive state machines and view models.

What is missing or weak (opportunities for Anima):

- **No Lottie export** anywhere in Rive (pricing grid lists RIV, REV, MP4, GIF, PNG seq, WebM; only third-party converters exist, src 43). Lottie **import** is Enterprise-only.
- **Closed, cloud-bound authoring**: files live in Rive's cloud; local `.rev` backup is paid; RML compiler and MCP server are closed binaries; clean exports require an account + paid plan.
- **MCP only in a running GUI desktop app** on Mac/Windows. No headless MCP, no Linux, no CI-friendly MCP. The CLI is headless but goes through RML text files rather than a structured edit API.
- **No documented undo/transaction semantics or diff/patch API** for agent edits (the Debug panel has an "AI changes" tab; behaviour not documented, uncertain).
- **No public REST API for the editor/files**; the `.riv` doc says a file-ID API is "planned". (An `openapi.json` is listed in llms.txt; contents not inspected, uncertain.)
- **No first-class visual verification loop inside MCP** (screenshots exist in the CLI only).
- **No open editor document format**: `.rev` undocumented; core defs JSON was pulled from the public repo in Aug 2026.

Anima's angle: an open, local-first document format (JSON or similar, diffable), a headless core (`packages/headless` already exists) exposed as both MCP and CLI on all OSes, deterministic render-to-PNG for agent self-checks, transactional edits with undo, and Lottie as the primary export.

## Pricing and paywalls (rive.app/pricing, read 2026-10-18)

Plans: Free $0; Cadet $9/seat/mo yearly ($17 monthly per docs), 3 seats max; Voyager $32/seat/mo yearly ($39 monthly), 25 seats max; Enterprise $120/seat/mo ($1,440/yr), for orgs with $10M+ revenue.

- **Free**: editor + CLI, unlimited personal files, 3 collaborative files, 1 project, all design/animation/state machine/data binding/scripting features, realtime collaboration, `.riv` export **with a Rive splash screen**, MP4/GIF/WebM/PNG seq export (grid shows check; video export doc says paid, conflict, uncertain), 10 MB asset import limit, no revision history.
- **Cadet adds**: splash-screen removal, unlimited files and projects, revision history, deleted-file recovery, folders and tags, early access, `.rev` backup export, 100 MB assets.
- **Voyager adds**: Libraries, CDN-hosted assets and share links, hosted embed links, batch exporting, Rive support in community, agent with advanced models, $20/seat credits, top-ups, BYO agent API key.
- **Enterprise adds**: Lottie import, SSO, SOC2, custom S3 bucket, subteam workspaces, org-wide permissions, dedicated Slack/CSM, custom runtime work, $40/seat credits.

Takeaway: Rive gates *distribution* (clean export, backups, history, libraries, hosting), not *authoring* features. None of the core vector/animation tooling is paywalled.

## Feature matrix

See `features.csv` (columns: feature, area, priority, original, clone, notes, source_url). Total 130 rows. Must: 45, should: 31, could: 45, skip: 9.

## Out of scope (cannot or should not be cloned)

- Rive's cloud: accounts, workspaces, realtime multiplayer, CDN hosting, embed links, marketplace, community.
- Rive's renderer and runtimes as products (MIT, but Anima's goal is Lottie, not `.riv` playback parity).
- The in-editor agent credits model and LLM provider deals.
- Enterprise services (SSO, SOC2, S3, Slack support).
- Cloud video renderer (Anima can render locally instead).
- Rive brand, UI chrome, icons, marketplace content and tutorials.
- `.rev` editor format (undocumented, closed).

## Size

Screens 24, flows 6, entities about 20. Hard parts: a robust vector path engine (boolean ops for shape builder, stroke geometry, trim/dash), timeline + bezier easing graph editor UX, Lottie exporter fidelity (gradients, trim paths, masks, easing mapping, baking non-Lottie features), undo/redo over a property-keyed document, and the agent-facing headless API. Full Rive parity: XL (rescope). Anima MVP slice (design tools + timeline + easing + Lottie export + agent API): M to L.
