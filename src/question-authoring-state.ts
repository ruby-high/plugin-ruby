import type { IAgentRuntime } from "@elizaos/core";

/** Rotation cursor across category × difficulty slots. */
export const RUBY_AUTHORING_SLOT_INDEX = "RUBY_AUTHORING_SLOT_INDEX";

function readIntSetting(runtime: IAgentRuntime, key: string): number {
  const value = runtime.getSetting(key);
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

export function loadAuthoringSlotIndex(runtime: IAgentRuntime): number {
  return readIntSetting(runtime, RUBY_AUTHORING_SLOT_INDEX);
}

export function saveAuthoringSlotIndex(
  runtime: IAgentRuntime,
  slotIndex: number,
): void {
  if (typeof runtime.setSetting !== "function") return;
  runtime.setSetting(RUBY_AUTHORING_SLOT_INDEX, String(slotIndex));
}
