import type { IAgentRuntime, Provider, ProviderResult } from "@elizaos/core";
import { buildApiLimitsContext, formatApiLimitsGuide } from "../api-limits.js";
import { isRubyAgent } from "../character.js";
import { resolveRubyTriviaConfig } from "../config.js";

/**
 * Exposes admin API access boundaries — what Ruby can and cannot do.
 *
 * WHY separate from RUBY_OBJECTS:
 * - Catalog describes nouns; limits describe forbidden paths and guardrails.
 * - Stops the LLM from inventing /api/me endpoints, auto-publishing, or leaking infra.
 */
export const rubyApiLimitsProvider: Provider = {
  name: "RUBY_API_LIMITS",
  description:
    "Ruby Trivia admin API boundaries — accessible ops, forbidden paths, write guardrails, public-chat rules.",
  get: async (runtime: IAgentRuntime): Promise<ProviderResult> => {
    if (!isRubyAgent(runtime)) {
      return { text: "" };
    }

    const config = resolveRubyTriviaConfig(runtime);
    const ctx = buildApiLimitsContext(config);

    return {
      text: formatApiLimitsGuide(ctx),
      values: {
        adminApiConfigured: ctx.adminApiConfigured,
        pulseIntervalMinutes: ctx.pulseIntervalMinutes,
        communityRefreshMinutes: ctx.communityRefreshMinutes,
        questionAuthoringIntervalMinutes: ctx.questionAuthoringIntervalMinutes,
        questionsPerCycle: ctx.questionsPerCycle,
      },
    };
  },
};
