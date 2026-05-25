import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAutoresearch } from "./autoresearch.js";
import { registerGoal } from "./goal.js";
import { registerLoop } from "./loop.js";

export function registerOrchestration(pi: ExtensionAPI): void {
  registerGoal(pi);
  registerLoop(pi);
  registerAutoresearch(pi);
}

export { registerAutoresearch, registerGoal, registerLoop };

export default function orchestrationExtension(pi: ExtensionAPI): void {
  registerOrchestration(pi);
}
