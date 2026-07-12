import type { IAgentRuntime, Provider, ProviderResult } from "@elizaos/core";
import { isRubyAgent } from "../character.js";
import {
  formatDomainCatalog,
  formatObjectRoutingGuide,
} from "../domain-catalog.js";
import { formatCachedObjectViews } from "../domain-views.js";
import { getStaleRefreshOps } from "../platform-cache.js";
import {
  RUBY_TRIVIA_PULSE_SERVICE_TYPE,
  type RubyTriviaPulseService,
} from "../services/ruby-trivia-pulse.js";
import { formatQuestionTaxonomyGuide } from "../trivia-taxonomy.js";

/**
 * API noun catalog + structured listing/detail views (no duplicate counts — those live in RUBY_PLATFORM).
 *
 * WHY inject catalog every turn:
 * - LLM cannot read docs/API-OBJECTS.md at runtime; op routing must be in prompt context.
 */
export const rubyObjectsProvider: Provider = {
  name: "RUBY_OBJECTS",
  description:
    "Ruby Trivia domain object catalog, op routing, and structured cached views.",
  get: async (runtime: IAgentRuntime): Promise<ProviderResult> => {
    if (!isRubyAgent(runtime)) {
      return { text: "" };
    }

    const pulse = runtime.getService<RubyTriviaPulseService>(
      RUBY_TRIVIA_PULSE_SERVICE_TYPE,
    );
    const cache = pulse?.getPlatformCache();

    const sections = [
      formatObjectRoutingGuide(),
      formatQuestionTaxonomyGuide(),
      formatDomainCatalog(),
      cache
        ? formatCachedObjectViews(cache)
        : "[RUBY OBJECTS — structured views]\nCache not ready — pulse has not run yet.",
    ];

    const staleRefreshOps = cache ? getStaleRefreshOps(cache) : [];

    return {
      text: sections.join("\n\n"),
      values: {
        objectCatalogLoaded: true,
        cachedViewsReady: Boolean(cache?.happenings.data),
        staleRefreshOps: staleRefreshOps.join(", "),
      },
    };
  },
};
