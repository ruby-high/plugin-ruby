/**
 * API access boundaries for the Ruby Trivia admin surface.
 *
 * WHY a dedicated limits block (not folded into RUBY_OBJECTS):
 * - OBJECTS answers "what nouns exist"; LIMITS answers "what is forbidden / unavailable".
 * - Prevents the LLM from inventing endpoints, auto-publishing, or leaking infra.
 *
 * Contract source: GET /api/admin/openapi.json (OpenAPI 3.1) + ruby-trivia/docs/RUBY-AGENT.md
 */
import {
  COMMUNITY_REFRESH_EVERY_PULSES,
  type RubyTriviaConfig,
} from "./config.js";

export type ApiLimitsContext = {
  adminApiConfigured: boolean;
  pulseIntervalMinutes: number;
  communityRefreshMinutes: number;
  questionAuthoringIntervalMinutes: number;
  questionsPerCycle: number;
};

/** Build limits context from resolved plugin config. */
export function buildApiLimitsContext(
  config: Pick<
    RubyTriviaConfig,
    | "analyticsSecret"
    | "pulseIntervalMinutes"
    | "questionAuthoringIntervalMinutes"
    | "questionsPerCycle"
  >,
): ApiLimitsContext {
  return {
    adminApiConfigured: Boolean(config.analyticsSecret?.trim()),
    pulseIntervalMinutes: config.pulseIntervalMinutes,
    communityRefreshMinutes:
      config.pulseIntervalMinutes * COMMUNITY_REFRESH_EVERY_PULSES,
    questionAuthoringIntervalMinutes: config.questionAuthoringIntervalMinutes,
    questionsPerCycle: config.questionsPerCycle,
  };
}

/**
 * Compact provider text — what Ruby can and cannot do via RUBY_TRIVIA / providers.
 * WHY static sections + small dynamic footer: boundaries are policy; only config hints vary.
 */
export function formatApiLimitsGuide(ctx: ApiLimitsContext): string {
  const authLine = ctx.adminApiConfigured
    ? "Admin API: configured (x-analytics-secret). Writes enabled."
    : "Admin API: NOT configured — reads may work via health; admin ops return 503 until RUBY_ANALYTICS_SECRET is set.";

  return `[RUBY API LIMITS]
Contract: GET /api/admin/openapi.json (same secret) — poll info.version when codegen drifts.

What you CAN access (via RUBY_TRIVIA op=… or cached providers):
• Health — op=health / CHECK_TRIVIA_VISITS (no secret)
• Platform pulse — op=poll_happenings; cached ~${ctx.pulseIntervalMinutes}m in RUBY_PLATFORM
• Community — op=get_community, op=get_community_difficulty (cached ~${ctx.communityRefreshMinutes}m)
• Players — op=list_users (hasLearnGoals=true filter, learnGoals on each row), op=get_user_knowledge
• Content — op=list_categories, op=create_category, op=list_questions, op=create_question (422 pre-insert audit), op=hide_question
• Audit / QA — op=get_audit_summary, op=list_audit_questions, op=get_audit_question, op=get_audit_question_history, op=audit_daily_preview, op=audit_actions (dryRun), op=audit_replace, op=audit_validate
• Dailies — op=list_dailies, op=publish_daily (5–20 IDs), op=revoke_daily
• Achievements — list/create/assign/award ops (legacy admin routes; not in OpenAPI paths yet)
• Analytics — op=get_device_fingerprints (bot/farm check), op=get_analytics_overview, op=get_analytics_retention
• Locale ops — op=list_locale_coverage; translation-cache PATCH still human-only
• Feedback — op=list_feedback (triage player NPS/bugs; use messageEn)
• Meta — op=get_openapi, op=get_changelog

What you CANNOT access (do not invent ops):
• Player session APIs — /api/me/* require user JWT
• Whitelist admin — separate WHITELIST_ADMIN_SECRET
• Arbitrary repo files — changelog slug only
• Static bank PATCH — JSON q-#### rows are file-generated; hide/replace dynamic dyn-#### via audit ops
• User delete/ban/password reset
• pickDaily algorithm — change dailies only via publish_daily / revoke_daily
• Routine happenings with includeAnswers=true

Write guardrails (server enforces — expect 4xx):
• create_question: 409 duplicate text; 422 pre-insert audit (placeholder_options, locale_script_mismatch, leaked_model_reasoning, …)
• publish_daily: 5–20 questionIds; 422 missing IDs; 409 duplicate (force:true)
• difficulty: easy | medium | hard | expert (expert stored; guest ladder may map to hard when bank thin)
• category: slug pattern ^[a-z][a-z0-9-]*$ — list_categories before create_category
• assign_challenges: max 3 achievementIds per user per date
• audit_actions: batch max 100; use dryRun=true to validate first

Cache vs on-demand:
• Cached: health, happenings, community (~${ctx.pulseIntervalMinutes}–${ctx.communityRefreshMinutes}m)
• On-demand: users, questions, audit, analytics, dailies, achievements

Public chat (never violate):
• No API URLs, hosts, ports, analytics secret, or model names
• No player emails — displayName only
• No device fingerprint hashes in crew posts

Sacred default:
• No publish_daily → auto pickDaily for all players.

Background authoring (~${ctx.questionAuthoringIntervalMinutes}m, ${ctx.questionsPerCycle}/cycle):
• POST /api/admin/questions — same 409/422 guardrails; disable with RUBY_QUESTION_AUTHORING_ENABLED=0

${authLine}`;
}
