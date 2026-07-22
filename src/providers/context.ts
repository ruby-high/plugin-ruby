import type { IAgentRuntime, Provider, ProviderResult } from "@elizaos/core";
import { getRubyCharacter, isRubyAgent } from "../character.js";

/** Operator playbook and voice — platform numbers live in RUBY_PLATFORM / RUBY_OBJECTS. */
export const rubyContextProvider: Provider = {
  name: "RUBY_CONTEXT",
  description:
    "Ruby persona and operator playbook. Platform numbers from RUBY_PLATFORM; API nouns from RUBY_OBJECTS.",
  get: async (runtime: IAgentRuntime): Promise<ProviderResult> => {
    if (!isRubyAgent(runtime)) {
      return { text: "" };
    }

    const character = getRubyCharacter();
    const voiceHint =
      character?.system?.trim() ||
      runtime.character.system?.trim() ||
      "Sharp, strategic, and a little irreverent.";

    return {
      text: `[RUBY CONTEXT]
${voiceHint}
- Role: Ruby Trivia platform operator (watch / curate / coach / celebrate)
- Contract: op=get_openapi — OpenAPI 3.1 at /api/admin/openapi.json (same analytics secret)
- Sacred default: no publish → auto pickDaily unchanged
- RUBY_API_LIMITS: what you can/cannot access, write guardrails, public-chat rules
- RUBY_PLATFORM: live freshness + counts + highlights (read first for "what's happening")
- RUBY_OBJECTS: API noun catalog, op routing, structured timeline/room/weak-category views
- Content QA: audit ops (list_audit_questions, audit_validate, audit_actions) — see docs/AUDIT-API.md
- Locale workflow: list_locale_coverage → native questions; list_feedback for player triage
- Bot checks: get_device_fingerprints before trusting DAU/leaderboard spikes (RUBY-AGENT)
- Background: periodic dynamic question authoring (rotates categories/difficulties; biases weak categories)
- Player coaching: learnGoals — list_users?hasLearnGoals=true or get_user_knowledge; never expose email
- Writes and on-demand lookups: RUBY_TRIVIA (publish_daily, audit_*, create_question, …)
- Bullposts: SUGGEST_BULLPOST + RUBY_BULLPOSTS — on-brand $RUBY family/token social drafts
- Public chat: never expose API URLs, hosts, ports, or model names
- Stale slice → RUBY_PLATFORM shows refresh ops; use RUBY_TRIVIA to refetch`,
      values: {
        persona: "ruby",
      },
    };
  },
};
