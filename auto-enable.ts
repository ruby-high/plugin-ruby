import type { PluginAutoEnableContext } from "@elizaos/core";

function isFeatureEnabled(
  config: PluginAutoEnableContext["config"],
  key: string,
): boolean {
  const feature = (config?.features as Record<string, unknown> | undefined)?.[
    key
  ];
  if (feature === true) return true;
  if (feature && typeof feature === "object" && feature !== null) {
    return (feature as Record<string, unknown>).enabled !== false;
  }
  return false;
}

function agentNamedRuby(config: PluginAutoEnableContext["config"]): boolean {
  const agents = (
    config?.agents as { list?: Array<{ name?: string }> } | undefined
  )?.list;
  if (!Array.isArray(agents)) return false;
  return agents.some((entry) => entry?.name?.trim().toLowerCase() === "ruby");
}

/** Enable when the agent is named Ruby or `config.features.ruby` is on. */
export function shouldEnable(ctx: PluginAutoEnableContext): boolean {
  if (ctx.env.RUBY_PLUGIN_ENABLED?.trim() === "1") return true;
  if (isFeatureEnabled(ctx.config, "ruby")) return true;
  // Config name is stable during plugin resolution (runtime character may not be hydrated yet).
  return agentNamedRuby(ctx.config);
}
