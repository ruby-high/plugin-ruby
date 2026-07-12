/**
 * Domain view formatters — summary / listing / detail per API noun.
 *
 * WHY three view shapes:
 * - Summary: one-line answers ("how's the platform?").
 * - Listing: collection previews (max 5 items) for Discord-safe brevity.
 * - Detail: richer single-record fields (SM-2 seen/correct, publish breakdown).
 *
 * All formatters are public-safe — no URLs, hosts, or model names.
 */
import { formatHealthSummaryPublic } from "./admin-client.js";
import type { RubyPlatformCache } from "./platform-cache.js";
import type { CommunityDifficulty, CommunityOverview } from "./types/admin.js";
import type {
  AchievementDefinition,
  AchievementGroup,
  ActiveChallenge,
  AgentDoc,
  CachedTimelineItem,
  DailyListResponse,
  DailyRevokeResult,
  DifficultyTierRow,
  DomainObjectKind,
  LiveRoom,
  LiveSnapshot,
  PlatformHappenings,
  PublishDailyResult,
  Question,
  QuestionListResponse,
  TriviaHealthResponse,
  User,
  UserKnowledgeProfile,
  UserListResponse,
  WeakCategoryDetail,
} from "./types/domain.js";

const MAX_LIST_PREVIEW = 5; // WHY cap: Discord + prompt context; full lists via RUBY_TRIVIA op

function previewNames(users: User[]): string {
  const names = users
    .slice(0, MAX_LIST_PREVIEW)
    .map((u) => u.displayName || u.id)
    .filter(Boolean);
  return names.length > 0 ? ` — ${names.join(", ")}` : "";
}

/** One-line public-safe summary per domain noun. */
export function formatObjectSummary(
  kind: DomainObjectKind,
  data: unknown,
): string {
  switch (kind) {
    case "service_health":
      return formatHealthSummaryPublic(data as TriviaHealthResponse);
    case "platform_happenings": {
      const h = data as PlatformHappenings;
      const s = h.summary;
      const parts: string[] = [];
      if (s?.registrations) parts.push(`${s.registrations} signups`);
      if (s?.dailyCompletions)
        parts.push(`${s.dailyCompletions} daily completes`);
      if (s?.badgeEarns) parts.push(`${s.badgeEarns} badge earns`);
      if (h.live?.queueWaiting) {
        parts.push(`${h.live.queueWaiting} in live queue`);
      }
      return parts.length > 0
        ? `Platform activity: ${parts.join(", ")}.`
        : "No notable platform activity.";
    }
    case "happening_timeline_item": {
      const item = data as CachedTimelineItem;
      return item.summary || `${item.event} at ${item.at}`;
    }
    case "live_snapshot": {
      const live = data as LiveSnapshot;
      return `${live.queueWaiting} waiting, ${live.activeRooms} active rooms.`;
    }
    case "live_room": {
      const room = data as LiveRoom;
      return `Room ${room.roomId}: ${room.phase}, ${room.playerCount} players.`;
    }
    case "community_overview": {
      const weak = (data as CommunityOverview).weakCategories
        ?.slice(0, 3)
        .map((w) => w.category);
      return weak?.length
        ? `Community weak spots: ${weak.join(", ")}.`
        : "Community overview loaded.";
    }
    case "community_difficulty":
    case "weak_category":
      return formatWeakCategoriesSummary(data as CommunityDifficulty);
    case "user": {
      const u = data as User;
      return `${u.displayName} — level ${u.level}, ${u.totalTracked} tracked questions.`;
    }
    case "user_knowledge_profile": {
      const k = data as UserKnowledgeProfile;
      const weak = k.weakCategories?.join(", ") ?? "none flagged";
      return `Knowledge for ${k.user.displayName}: weak categories ${weak}.`;
    }
    case "sm2_row": {
      const row = data as {
        category: string;
        easiness: number;
        question_id: string;
      };
      return `${row.category} (easiness ${row.easiness.toFixed(1)}) — ${row.question_id}`;
    }
    case "question":
    case "question_bank": {
      const q = data as Question;
      return `[${q.difficulty}/${q.category}] ${q.question.slice(0, 80)}`;
    }
    case "published_daily": {
      const d = data as { date: string; scope: string; questionIds: string[] };
      return `${d.scope} daily ${d.date} — ${d.questionIds.length} questions.`;
    }
    case "daily_publish_result":
      return formatPublishSummary(data as PublishDailyResult);
    case "daily_revoke_result": {
      const r = data as DailyRevokeResult;
      return `Revoked; ~${r.affectedUsersEstimate} users may be affected.`;
    }
    case "achievement_definition": {
      const a = data as AchievementDefinition;
      return `${a.name} (${a.trigger})${a.earnedCount != null ? ` — ${a.earnedCount} earned` : ""}`;
    }
    case "achievement_group": {
      const g = data as AchievementGroup;
      const count = g.members?.length ?? g.memberIds?.length ?? 0;
      return `${g.name} — ${count} member badges.`;
    }
    case "earned_badge": {
      const awarded = (data as { awarded?: boolean }).awarded;
      return awarded
        ? "Badge awarded to player."
        : "Badge not awarded (may already be earned).";
    }
    case "active_challenge": {
      const c = data as ActiveChallenge;
      const label = c.name?.trim() || c.achievementId;
      return `${label}: ${c.progress}/${c.target} on ${c.assignedDate}.`;
    }
    case "user_achievement_stats":
      return "Lifetime achievement counters (evaluation context).";
    case "agent_doc": {
      const doc = data as AgentDoc;
      return `Changelog updated ${doc.updatedAt}.`;
    }
    default:
      return "Object loaded.";
  }
}

function formatWeakCategoriesSummary(payload: CommunityDifficulty): string {
  const weak = payload.weakCategories
    ?.slice(0, 3)
    .map(
      (entry) =>
        `${entry.category} (easiness ${entry.meanEasiness.toFixed(1)})`,
    );
  if (weak?.length) return `Community struggle: ${weak.join(", ")}.`;
  const byDifficulty = payload.byDifficulty
    ?.map((entry) => `${entry.difficulty} ${Math.round(entry.accuracy * 100)}%`)
    .join(", ");
  return byDifficulty
    ? `Accuracy by difficulty: ${byDifficulty}.`
    : "Difficulty breakdown loaded.";
}

function formatPublishSummary(payload: PublishDailyResult): string {
  const parts: string[] = [];
  if (payload.scope && payload.date) {
    parts.push(`Published ${payload.scope} daily for ${payload.date}.`);
  }
  if (payload.warnings?.length) {
    parts.push(`Warnings: ${payload.warnings.join("; ")}`);
  }
  return parts.length > 0 ? parts.join(" ") : "Daily publish completed.";
}

/** Listing view — collection index, public-safe. */
export function formatObjectListing(
  kind: DomainObjectKind,
  data: unknown,
): string {
  switch (kind) {
    case "happening_timeline_item": {
      const items = data as CachedTimelineItem[];
      if (items.length === 0) return "No timeline items.";
      return items
        .slice(0, MAX_LIST_PREVIEW)
        .map((item) => `• ${item.summary}`)
        .join("\n");
    }
    case "live_room": {
      const rooms = data as LiveRoom[];
      if (rooms.length === 0) return "No active live rooms.";
      return rooms
        .slice(0, MAX_LIST_PREVIEW)
        .map((r) => `• ${r.roomId}: ${r.phase}, ${r.playerCount} players`)
        .join("\n");
    }
    case "weak_category": {
      const weak = data as WeakCategoryDetail[];
      if (weak.length === 0) return "No weak categories flagged.";
      return weak
        .slice(0, MAX_LIST_PREVIEW)
        .map(
          (w) =>
            `• ${w.category} (easiness ${w.meanEasiness.toFixed(1)}${w.questions != null ? `, ${w.questions} questions` : ""})`,
        )
        .join("\n");
    }
    case "user": {
      const list = data as UserListResponse;
      return `Players ${list.offset + 1}–${list.offset + list.users.length} of ${list.total}${previewNames(list.users)}`;
    }
    case "sm2_row": {
      const rows = data as Array<{
        category: string;
        easiness: number;
        question_id: string;
      }>;
      if (rows.length === 0) return "No SM-2 rows.";
      return rows
        .slice(0, MAX_LIST_PREVIEW)
        .map(
          (r) =>
            `• ${r.category} easiness ${r.easiness.toFixed(1)} (${r.question_id})`,
        )
        .join("\n");
    }
    case "question":
    case "question_bank": {
      const list = data as QuestionListResponse;
      const preview = list.questions
        .slice(0, MAX_LIST_PREVIEW)
        .map((q) => `• [${q.difficulty}/${q.category}] ${q.id}`)
        .join("\n");
      return `Questions (${list.count} total):\n${preview || "—"}`;
    }
    case "published_daily": {
      const list = data as DailyListResponse;
      if (list.publishes.length === 0) return "No published dailies.";
      return list.publishes
        .slice(0, MAX_LIST_PREVIEW)
        .map(
          (d) =>
            `• ${d.date} ${d.scope}${d.userId ? ` (${d.userId})` : ""} — ${d.questionIds.length} Qs`,
        )
        .join("\n");
    }
    case "achievement_definition": {
      const list = data as { achievements: AchievementDefinition[] };
      return (
        list.achievements
          .slice(0, MAX_LIST_PREVIEW)
          .map((a) => `• ${a.name} (${a.id})`)
          .join("\n") || "No achievements."
      );
    }
    case "achievement_group": {
      const list = data as { groups: AchievementGroup[] };
      return (
        list.groups
          .slice(0, MAX_LIST_PREVIEW)
          .map((g) => `• ${g.name} (${g.id})`)
          .join("\n") || "No achievement groups."
      );
    }
    case "active_challenge": {
      const list = data as { challenges: ActiveChallenge[] };
      return (
        list.challenges
          .slice(0, MAX_LIST_PREVIEW)
          .map((c) => {
            const label = c.name?.trim() || c.achievementId;
            const done = c.completed ? " ✓" : "";
            return `• ${label}: ${c.progress}/${c.target}${done}`;
          })
          .join("\n") || "No active challenges."
      );
    }
    case "community_difficulty": {
      const diff = data as CommunityDifficulty;
      const tiers = diff.byDifficulty
        ?.map(
          (t: DifficultyTierRow) =>
            `• ${t.difficulty}: ${Math.round(t.accuracy * 100)}% (${t.attempts} attempts)`,
        )
        .join("\n");
      return tiers || "No difficulty tiers.";
    }
    default:
      return formatObjectSummary(kind, data);
  }
}

/** Detail view — single record with richer fields, public-safe. */
export function formatObjectDetail(
  kind: DomainObjectKind,
  data: unknown,
): string {
  switch (kind) {
    case "user": {
      const u = data as User;
      const parts = [
        `${u.displayName} (${u.id})`,
        `level ${u.level}, XP ${u.xp}`,
        `${u.totalTracked} tracked questions`,
      ];
      if (u.learnGoals?.trim()) parts.push(`goals: ${u.learnGoals.trim()}`);
      if (u.lastPlayedDate) parts.push(`last played ${u.lastPlayedDate}`);
      return parts.join(" · ");
    }
    case "question": {
      const q = data as Partial<Question> & { id: string; status?: string };
      if (q.status && !q.question) {
        return `${q.id} is now ${q.status}.`;
      }
      if (!q.question) {
        return q.id;
      }
      return `${q.id} [${q.difficulty}/${q.category}${q.language ? `/${q.language}` : ""}]: "${q.question}"${q.source ? ` (${q.source})` : ""}`;
    }
    case "sm2_row": {
      const row = data as {
        category: string;
        difficulty?: string;
        easiness: number;
        question_id: string;
        seen_count?: number;
        correct_count?: number;
        due_at?: string | null;
      };
      const seen = row.seen_count ?? 0;
      const correct = row.correct_count ?? 0;
      const due = row.due_at ? ` · due ${row.due_at}` : "";
      return `${row.question_id} · ${row.category}/${row.difficulty ?? "?"} · easiness ${row.easiness.toFixed(1)} · seen ${seen}, correct ${correct}${due}`;
    }
    case "happening_timeline_item": {
      const item = data as CachedTimelineItem;
      const who = item.displayName ?? "Someone";
      return `${who} · ${item.event} · ${item.at}: ${item.summary}`;
    }
    case "live_room": {
      const room = data as LiveRoom;
      return `${room.roomId} · ${room.phase} · ${room.playerCount} players · started ${room.createdAt}`;
    }
    case "weak_category": {
      const w = data as WeakCategoryDetail;
      return `${w.category} · mean easiness ${w.meanEasiness.toFixed(1)}${w.questions != null ? ` · ${w.questions} questions` : ""}`;
    }
    case "published_daily": {
      const d = data as {
        date: string;
        scope: string;
        questionIds: string[];
        notes?: string;
      };
      const preview = d.questionIds.slice(0, 5).join(", ");
      const more =
        d.questionIds.length > 5 ? ` +${d.questionIds.length - 5} more` : "";
      const notes = d.notes?.trim() ? ` · notes: ${d.notes.trim()}` : "";
      return `${d.scope} daily ${d.date} · ${d.questionIds.length} questions: ${preview}${more}${notes}`;
    }
    case "daily_publish_result": {
      const p = data as PublishDailyResult;
      let line = formatPublishSummary(p);
      if (p.difficultyBreakdown) {
        const breakdown = Object.entries(p.difficultyBreakdown)
          .map(([key, value]) => `${key}:${value}`)
          .join(", ");
        if (breakdown) line += ` Breakdown: ${breakdown}.`;
      }
      return line;
    }
    case "achievement_definition": {
      const a = data as AchievementDefinition;
      return `${a.name} (${a.id}) · ${a.trigger} · ${a.description}`;
    }
    case "user_knowledge_profile": {
      const k = data as UserKnowledgeProfile;
      const weak = k.weakCategories?.join(", ") ?? "none flagged";
      const due =
        k.dueQuestions?.length ?? k.profile?.dueQuestions?.length ?? 0;
      const goals = k.user.learnGoals?.trim();
      const goalsPart = goals ? ` · goals: ${goals}` : "";
      return `${k.user.displayName} · level ${k.user.level} · streak ${k.user.streak} · weak: ${weak} · ${due} due questions${goalsPart}`;
    }
    case "earned_badge": {
      const awarded = (data as { awarded?: boolean }).awarded;
      return awarded
        ? "Badge awarded to player."
        : "Badge not awarded (may already be earned).";
    }
    case "active_challenge": {
      const c = data as ActiveChallenge;
      const label = c.name?.trim() || c.achievementId;
      const status = c.completed ? "completed" : "in progress";
      return `${label} for ${c.userId} on ${c.assignedDate}: ${c.progress}/${c.target} (${status}, assigned by ${c.assignedBy})`;
    }
    case "agent_doc": {
      const doc = data as AgentDoc;
      const preview = doc.content.split("\n").slice(0, 3).join(" ");
      return `Changelog ${doc.updatedAt}: ${preview}`;
    }
    default:
      return formatObjectSummary(kind, data);
  }
}

/**
 * Structured listing/detail views for cached nouns — no counts duplicated from RUBY_PLATFORM.
 */
export function formatCachedObjectViews(
  cache: RubyPlatformCache,
  _now = Date.now(),
): string {
  const lines = [
    "[RUBY OBJECTS — structured views]",
    "Freshness and counts are in RUBY_PLATFORM. Below: listing/detail shapes only.",
  ];

  if (cache.happenings.data) {
    const h = cache.happenings.data;
    if (h.timeline.length > 0) {
      lines.push(
        `HappeningTimelineItem:\n${formatObjectListing("happening_timeline_item", h.timeline)}`,
      );
    }
    if (h.liveRooms.length > 0) {
      lines.push(`LiveRoom:\n${formatObjectListing("live_room", h.liveRooms)}`);
    }
  }

  if (cache.communityDifficulty.data) {
    const weak = cache.communityDifficulty.data.weakCategoriesDetailed;
    if (weak.length > 0) {
      lines.push(
        `WeakCategory:\n${formatObjectListing("weak_category", weak)}`,
      );
    }
    const tiers = cache.communityDifficulty.data.byDifficulty;
    if (tiers.length > 0) {
      lines.push(
        `CommunityDifficulty:\n${formatObjectListing("community_difficulty", { byDifficulty: tiers })}`,
      );
    }
  }

  if (lines.length === 2) {
    lines.push(
      "No structured listings yet — wait for pulse or use RUBY_TRIVIA.",
    );
  }

  return lines.join("\n");
}
