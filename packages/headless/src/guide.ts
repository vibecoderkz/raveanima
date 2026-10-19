/** Primer returned by the anima_guide MCP tool and `raveanima guide` (alias `anima guide`). Keep it short: agents read it every session. */
export const GUIDE = `# RaveAnima for agents

RaveAnima is a 2D vector design and animation editor. Everything (UI, CLI, MCP) runs the same commands.

## Coordinates
- Artboard: doc.width x doc.height px, origin top-left, y grows down.
- Shapes are centred on transform.x / transform.y. rotation is degrees clockwise. scaleX/scaleY are factors (1 = 100%).
- transform.originX/originY move the pivot (local coords; 0,0 = shape centre).
- Colours are hex strings: "#FF3B2E" or "#FF3B2E80" (with alpha).

## Nodes
group (clip: bottom child masks the rest), rect (width, height, cornerRadius), ellipse (width, height),
polygon (radius, sides), star (radius, innerRadius, points),
path (points: [{x,y,inX,inY,outX,outY}], closed, subpaths: [{points, closed}] for holes, fillRule "evenodd"),
text (text with \n, fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, align),
image (src data:/file/http, width, height).
Path handles are relative to their point. Common: name, opacity 0..1, visible, locked, fill, stroke,
blur (px), shadow {color, x, y, blur}. Shapes also have trimStart/trimEnd/trimOffset (0..1) for draw-on lines.
fill: "#hex" | null | {type:"linear",from:{x,y},to:{x,y},stops:[{offset,color}]} | {type:"radial",center,radius,stops}.
stroke: "#hex" | null | {paint, width, join:"round", cap:"round"}.

## Animation
anim.new creates a timeline and makes it active. keyframe.set {nodeId, prop, time, value, ease}.
Props: transform.x/y/rotation/scaleX/scaleY/originX/originY, opacity, width, height, cornerRadius,
radius, innerRadius, fill.color, stroke.width, stroke.paint.color, blur, shadow.x/y/blur/color,
trimStart, trimEnd, trimOffset, fontSize, letterSpacing, points (path morph: same point count).
Fast motion: anim.preset {nodeId, preset, time} with fadeIn, popIn, slideInUp/Left/Right/Down, bounce,
pulse, heartbeat, float, wiggle, shake, spin, blink, draw (trim), fadeOut, popOut.
ease (curve to the NEXT key): linear, hold, easeIn, easeOut, easeInOut, backIn, backOut, backInOut, {"cubic":[x1,y1,x2,y2]}.
Values not keyed stay at the rest pose. node.update edits the rest pose.

## Workflow
1. doc.new {width,height,background} (or doc_open)
2. command_batch with node.add steps (each returns {id}); ids are short: n1, n2...
3. anim.new, then keyframe.set steps
4. render_contact_sheet to see the motion, render_preview for one frame; fix and repeat
5. export: .anima (editable), .json (Lottie), .svg, .png, .mp4, .webm, .gif

Editing: node.copy / node.paste (fragments with animation), node.align, node.distribute,
node.convertToPath, path.setPoint / insertPoint / deletePoint, import.svg {svg} or the doc_import tool.

Tips: render_contact_sheet with mode "keys" never misses short events. Use command_batch for many steps (one undo step, atomic). doc.inspect lists ids and bounds.
Invalid params return a readable error naming the field; fix and retry.
`;
