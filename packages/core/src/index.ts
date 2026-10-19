export * from "./types.js";
export * from "./color.js";
export * from "./easing.js";
export * from "./doc.js";
export * from "./props.js";
export * from "./animation.js";
export * from "./geometry.js";
export * from "./render.js";
export * from "./lottie.js";
export * from "./schema.js";
export * from "./editor.js";
export * from "./commands.js";
export * from "./commands-edit.js";
export * from "./svg-import.js";
export * from "./statemachine.js";
export * from "./commands-sm.js";
export * from "./embed.js";

import { coreCommands } from "./commands.js";
import { editCommands } from "./commands-edit.js";
import { smCommands } from "./commands-sm.js";
import { Editor } from "./editor.js";
import type { AnimaDocument } from "./types.js";

export const ANIMA_VERSION = "0.2.0";
/** Product name shown to people. Internal ids (`anima` CLI alias, `.anima` files, MCP tool names, bridge) keep the old name. */
export const PRODUCT_NAME = "RaveAnima";
export const ATTRIBUTION = "Developed by Dias Zhumagaliyev: https://dias.now · hello@dias.now";

/** An editor with every built-in command registered. */
export function createEditor(doc?: AnimaDocument): Editor {
  return new Editor([...coreCommands, ...editCommands, ...smCommands], doc);
}
