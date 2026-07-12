/**
 * Domain object registry — maps API nouns to RUBY_TRIVIA ops and cache policy.
 *
 * WHY code registry (not just docs/API-OBJECTS.md):
 * - RUBY_OBJECTS provider injects this catalog every turn.
 * - suggestOpForKinds drives stale-slice refresh hints in platform-cache.ts.
 * - Single source of truth keeps docs and runtime routing aligned.
 */
import type { DomainObjectKind, DomainObjectMeta } from "./types/domain.js";

/** Registry of all Ruby Trivia API nouns — drives RUBY_OBJECTS provider and op routing. */
export const DOMAIN_OBJECTS: readonly DomainObjectMeta[] = [
  {
    kind: "service_health",
    layer: "platform",
    label: "ServiceHealth",
    summary: "Liveness of trivia API and AI assist (public replies sanitized).",
    rubyOp: "health",
    cached: true,
    cacheTtlMinutes: 5,
  },
  {
    kind: "platform_happenings",
    layer: "platform",
    label: "PlatformHappenings",
    summary:
      "Unified activity feed — signups, dailies, badges, crew, live state.",
    rubyOp: "poll_happenings",
    cached: true,
    cacheTtlMinutes: 5,
  },
  {
    kind: "happening_timeline_item",
    layer: "platform",
    label: "HappeningTimelineItem",
    summary: "One human-readable moment in the happenings feed.",
    rubyOp: "poll_happenings",
    cached: true,
    cacheTtlMinutes: 5,
  },
  {
    kind: "live_snapshot",
    layer: "platform",
    label: "LiveSnapshot",
    summary: "Current live matchmaking pressure (queue + active rooms).",
    rubyOp: "poll_happenings",
    cached: true,
    cacheTtlMinutes: 5,
  },
  {
    kind: "live_room",
    layer: "platform",
    label: "LiveRoom",
    summary: "One active or waiting live trivia room.",
    rubyOp: "poll_happenings",
    cached: true,
    cacheTtlMinutes: 5,
  },
  {
    kind: "community_overview",
    layer: "community",
    label: "CommunityOverview",
    summary: "Bundled community health — overview, friction, weak categories.",
    rubyOp: "get_community",
    cached: true,
    cacheTtlMinutes: 15,
  },
  {
    kind: "community_difficulty",
    layer: "community",
    label: "CommunityDifficulty",
    summary: "SM-2 aggregates — accuracy by tier + weak categories.",
    rubyOp: "get_community_difficulty",
    cached: true,
    cacheTtlMinutes: 15,
  },
  {
    kind: "weak_category",
    layer: "community",
    label: "WeakCategory",
    summary: "Category the community retains poorly (low easiness).",
    rubyOp: "get_community_difficulty",
    cached: true,
    cacheTtlMinutes: 15,
  },
  {
    kind: "user",
    layer: "players",
    label: "User",
    summary: "Registered player with progression summary.",
    rubyOp: "list_users",
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "user_knowledge_profile",
    layer: "players",
    label: "UserKnowledgeProfile",
    summary: "One player's learning gaps for remediation.",
    rubyOp: "get_user_knowledge",
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "sm2_row",
    layer: "players",
    label: "Sm2Row",
    summary: "Spaced-repetition state for one user × question pair.",
    rubyOp: "get_user_knowledge",
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "question",
    layer: "content",
    label: "Question",
    summary: "Trivia prompt (static bank or agent-authored dynamic row).",
    rubyOp: "list_questions",
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "question_bank",
    layer: "content",
    label: "QuestionBank",
    summary:
      "Merged static + dynamic inventory (materialized by list_questions).",
    rubyOp: "list_questions",
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "published_daily",
    layer: "dailies",
    label: "PublishedDaily",
    summary: "Agent-curated daily quiz for a date (community or per-user).",
    rubyOp: "list_dailies",
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "daily_publish_result",
    layer: "dailies",
    label: "DailyPublishResult",
    summary: "Outcome of publish_daily (breakdown + warnings).",
    rubyOp: "publish_daily",
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "daily_revoke_result",
    layer: "dailies",
    label: "DailyRevokeResult",
    summary: "Outcome of revoke_daily — returns to auto daily.",
    rubyOp: "revoke_daily",
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "achievement_definition",
    layer: "achievements",
    label: "AchievementDefinition",
    summary: "Data-driven badge rule (trigger + JSON condition).",
    rubyOp: "list_achievements",
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "achievement_group",
    layer: "achievements",
    label: "AchievementGroup",
    summary: "Mastery cluster — meta-badge when all members earned.",
    rubyOp: "list_achievement_groups",
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "earned_badge",
    layer: "achievements",
    label: "EarnedBadge",
    summary: "Badge awarded to a user (runtime or manual award).",
    rubyOp: "award_achievement",
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "active_challenge",
    layer: "achievements",
    label: "ActiveChallenge",
    summary: "Today's assigned daily order for one user.",
    rubyOp: "list_challenges",
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "user_achievement_stats",
    layer: "achievements",
    label: "UserAchievementStats",
    summary:
      "Lifetime counters per user × game (evaluation context, no list endpoint).",
    rubyOp: null,
    cached: false,
    cacheTtlMinutes: null,
  },
  {
    kind: "agent_doc",
    layer: "meta",
    label: "AgentDoc",
    summary: "Shipped product history as markdown (changelog).",
    rubyOp: "get_changelog",
    cached: false,
    cacheTtlMinutes: null,
  },
] as const;

const KIND_INDEX = new Map(DOMAIN_OBJECTS.map((entry) => [entry.kind, entry]));

export function getDomainObjectMeta(
  kind: DomainObjectKind,
): DomainObjectMeta | undefined {
  return KIND_INDEX.get(kind);
}

/** Compact catalog for LLM — one line per noun with op + cache hint. */
export function formatDomainCatalog(): string {
  const lines = [
    "[RUBY OBJECTS — catalog]",
    "Layer | Noun | Op | Cached | Summary",
  ];
  for (const entry of DOMAIN_OBJECTS) {
    const op = entry.rubyOp ?? "—";
    const cached = entry.cached
      ? `yes (${entry.cacheTtlMinutes}m)`
      : "no — use RUBY_TRIVIA";
    lines.push(
      `${entry.layer} | ${entry.label} | ${op} | ${cached} | ${entry.summary}`,
    );
  }
  return lines.join("\n");
}

/** Map natural question themes to the best read op. */
export function formatObjectRoutingGuide(): string {
  return `[RUBY OBJECTS — routing]
| Question | Read from | Write via |
| Is the game up? | RUBY_PLATFORM health / CHECK_TRIVIA_VISITS | — |
| How are players doing? | RUBY_PLATFORM happenings (counts + highlights) | — |
| Where do players struggle? | RUBY_PLATFORM weak categories · RUBY_OBJECTS WeakCategory detail | — |
| Live rooms / timeline shape | RUBY_OBJECTS structured views | — |
| Drill into one player | get_user_knowledge (weak categories, sm2Sample, learnGoals) | publish_daily (user), assign_challenges |
| Change content | list_questions, list_categories | create_question, create_category, hide_question, audit_* |
| QA / punch-up | list_audit_questions, get_audit_summary | audit_actions, audit_replace, audit_validate |
| Locale gaps | list_locale_coverage, list_audit_questions?missingField=locale | create_question with language/locale |
| Bot / farm signal | get_device_fingerprints | — |
| What shipped / contract | get_changelog, get_openapi | — |
| Change today's quiz | list_dailies | publish_daily (5–20 IDs), revoke_daily |
| Badges / orders | list_achievements, list_challenges, list_achievement_groups | create_achievement, create_achievement_group, assign_challenges, award_achievement |
| What shipped? | get_changelog | — |
Sacred default: no publish → auto pickDaily unchanged.
Public chat: summaries only — never URLs, hosts, or model names.`;
}

export function suggestOpForKinds(kinds: DomainObjectKind[]): string[] {
  const ops = new Set<string>();
  for (const kind of kinds) {
    const meta = KIND_INDEX.get(kind);
    if (meta?.rubyOp) ops.add(meta.rubyOp);
  }
  return [...ops];
}
