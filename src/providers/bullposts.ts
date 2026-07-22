import type { IAgentRuntime, Provider, ProviderResult } from "@elizaos/core";
import {
  BULLPOST_BANK,
  BULLPOST_STYLE_RULES,
  BULLPOST_THEMES,
} from "../bullposts.js";
import { isRubyAgent } from "../character.js";

/** Injects $RUBY bullpost voice so Ruby can draft social copy without inventing off-brand fluff. */
export const rubyBullpostsProvider: Provider = {
  name: "RUBY_BULLPOSTS",
  description:
    "On-brand $RUBY bullpost style + themes. Use SUGGEST_BULLPOST to pull ready drafts.",
  get: async (runtime: IAgentRuntime): Promise<ProviderResult> => {
    if (!isRubyAgent(runtime)) {
      return { text: "" };
    }

    const sample = BULLPOST_BANK[0]?.text.split("\n").slice(0, 4).join("\n") ?? "";
    const rules = BULLPOST_STYLE_RULES.map((rule) => `• ${rule}`).join("\n");

    return {
      text: `[RUBY BULLPOSTS]
When asked for tweets, bullposts, promo/social drafts, or "$RUBY copy":
- Prefer action SUGGEST_BULLPOST (theme + count) — LLM drafts few-shot from the bank
- Background: every RUBY_BULLPOST_INTERVAL_MINUTES (default 30) a fresh LLM draft posts to Discord
- Themes: ${BULLPOST_THEMES.join(", ")} (${BULLPOST_BANK.length} posts in bank)
- Style rules:
${rules}
- Sample cadence:
${sample}
…
- Public chat: never invent APY/price promises; never paste API secrets or internal hosts`,
      values: {
        bullpostCount: BULLPOST_BANK.length,
        bullpostThemes: BULLPOST_THEMES.join(","),
      },
    };
  },
};
