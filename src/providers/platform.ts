import type { IAgentRuntime, Provider, ProviderResult } from "@elizaos/core";
import { isRubyAgent } from "../character.js";
import {
  formatPlatformCacheForProvider,
  getStaleRefreshOps,
} from "../platform-cache.js";
import {
  RUBY_TRIVIA_PULSE_SERVICE_TYPE,
  type RubyTriviaPulseService,
} from "../services/ruby-trivia-pulse.js";

/**
 * Exposes the platform cache maintained by RubyTriviaPulseService.
 *
 * WHY a dedicated provider (not folded into RUBY_OBJECTS):
 * - Operators ask "what's happening?" every turn — counts need a stable, freshness-labelled block.
 * - OBJECTS carries taxonomy; PLATFORM carries the operational dashboard.
 */
export const rubyPlatformProvider: Provider = {
  name: "RUBY_PLATFORM",
  description:
    "Cached Ruby Trivia platform state (happenings, community struggle, health) with freshness guarantees.",
  get: async (runtime: IAgentRuntime): Promise<ProviderResult> => {
    if (!isRubyAgent(runtime)) {
      return { text: "" };
    }

    const pulse = runtime.getService<RubyTriviaPulseService>(
      RUBY_TRIVIA_PULSE_SERVICE_TYPE,
    );
    const cache = pulse?.getPlatformCache();
    if (!cache) {
      return {
        text: "[RUBY PLATFORM]\nCache not ready — pulse has not run yet.",
      };
    }

    const formatted = formatPlatformCacheForProvider(cache);
    return {
      text: formatted.text,
      values: {
        ...formatted.values,
        staleRefreshOps: getStaleRefreshOps(cache).join(", "),
      },
    };
  },
};
