import { z } from "zod";
import { isColor } from "./color.js";
import { isEase } from "./easing.js";

export const ColorSchema = z.string().refine(isColor, { message: "Colour must be #rgb, #rgba, #rrggbb or #rrggbbaa" });
const Num = z.number().finite();
const Vec = z.object({ x: Num, y: Num });
const Stop = z.object({ offset: Num, color: ColorSchema });

export const PaintSchema = z.union([
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("solid"), color: ColorSchema }),
  z.object({ type: z.literal("linear"), from: Vec, to: Vec, stops: z.array(Stop).min(1) }),
  z.object({ type: z.literal("radial"), center: Vec, radius: Num, stops: z.array(Stop).min(1) }),
]);

/** A paint, or a bare colour string as shorthand for a solid paint, or null for none. */
export const PaintInput = z
  .union([PaintSchema, ColorSchema, z.null()])
  .transform((v) => (v === null ? { type: "none" as const } : typeof v === "string" ? { type: "solid" as const, color: v } : v));

export const PathPointSchema = z.object({
  x: Num,
  y: Num,
  inX: Num.default(0),
  inY: Num.default(0),
  outX: Num.default(0),
  outY: Num.default(0),
});

export const TransformPatch = z.strictObject({
  x: Num.optional(),
  y: Num.optional(),
  rotation: Num.optional(),
  scaleX: Num.optional(),
  scaleY: Num.optional(),
  originX: Num.optional(),
  originY: Num.optional(),
});

export const StrokePatch = z.union([
  z.null(),
  ColorSchema,
  z.strictObject({
    paint: PaintInput.optional(),
    width: Num.min(0).optional(),
    join: z.enum(["miter", "round", "bevel"]).optional(),
    cap: z.enum(["butt", "round", "square"]).optional(),
  }),
]);

export const ShadowPatch = z.union([
  z.null(),
  z.strictObject({ color: ColorSchema.optional(), x: Num.optional(), y: Num.optional(), blur: Num.min(0).optional() }),
]);

const ContourSchema = z.object({ points: z.array(PathPointSchema), closed: z.boolean().default(true) });

/** Every editable node field. Fields that do not apply to the node type are rejected at run time. */
export const NodePatch = z.strictObject({
  name: z.string().optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  opacity: Num.min(0).max(1).optional(),
  transform: TransformPatch.optional(),
  fill: PaintInput.optional(),
  stroke: StrokePatch.optional(),
  width: Num.min(0).optional(),
  height: Num.min(0).optional(),
  cornerRadius: Num.min(0).optional(),
  radius: Num.min(0).optional(),
  innerRadius: Num.min(0).optional(),
  sides: z.number().int().min(3).optional(),
  points: z.union([z.number().int().min(2), z.array(PathPointSchema)]).optional(),
  closed: z.boolean().optional(),
  subpaths: z.array(ContourSchema).optional(),
  fillRule: z.enum(["nonzero", "evenodd"]).optional(),
  blur: Num.min(0).optional(),
  shadow: ShadowPatch.optional(),
  clip: z.boolean().optional(),
  trimStart: Num.min(0).max(1).optional(),
  trimEnd: Num.min(0).max(1).optional(),
  trimOffset: Num.optional(),
  text: z.string().optional(),
  fontFamily: z.string().min(1).optional(),
  fontSize: Num.positive().optional(),
  fontWeight: z.number().int().min(100).max(1000).optional(),
  lineHeight: Num.positive().optional(),
  letterSpacing: Num.optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  src: z.string().optional(),
});
export type NodePatchInput = z.input<typeof NodePatch>;

export const EaseSchema = z.custom<import("./types.js").Ease>(isEase, {
  message: 'Ease must be linear, hold, easeIn, easeOut, easeInOut, backIn, backOut, backInOut or {"cubic":[x1,y1,x2,y2]}',
});

export const NODE_TYPES = ["group", "rect", "ellipse", "polygon", "star", "path", "text", "image"] as const;
