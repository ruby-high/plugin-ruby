import type { IAgentRuntime } from "@elizaos/core";

/**
 * Rotation cursor across mad-lib themes — mirrors question-authoring-state.ts.
 * WHY persist: a fresh cursor each boot would re-author the same first themes forever; rotating
 * spreads coverage across the theme list over successive cycles.
 */
export const RUBY_MADLIB_THEME_INDEX = "RUBY_MADLIB_THEME_INDEX";

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

export function loadMadlibThemeIndex(runtime: IAgentRuntime): number {
  return readIntSetting(runtime, RUBY_MADLIB_THEME_INDEX);
}

export function saveMadlibThemeIndex(
  runtime: IAgentRuntime,
  themeIndex: number,
): void {
  if (typeof runtime.setSetting !== "function") return;
  runtime.setSetting(RUBY_MADLIB_THEME_INDEX, String(themeIndex));
}
