/**
 * RUBY_TRIVIA op handlers — one function per admin endpoint.
 *
 * WHY separate from the action:
 * - Pulse and future callers can share executeRubyTriviaOp without the action wrapper.
 *
 * WHY cache-first on read ops:
 * - Pulse already populated RubyPlatformCache; fresh slices skip redundant API calls.
 *
 * WHY userFacingText + verifiedUserFacing on every result:
 * - elizaOS echoes tool output verbatim only when opted in; prevents infra leaking to Discord.
 */
import type {
  ActionResult,
  IAgentRuntime,
  ProviderDataRecord,
} from "@elizaos/core";
import { buildAuditListQuery } from "./admin-audit-query.js";
import {
  formatHealthSummary,
  formatHealthSummaryPublic,
  formatServiceUnavailablePublic,
  getHappeningsTimeline,
  rubyAdminFetch,
  rubyHealthFetch,
  summarizeAuditList,
  summarizeCommunity,
  summarizeCommunityDifficulty,
  summarizeHappenings,
  summarizeOpenApiMeta,
  summarizePublishResult,
} from "./admin-client.js";
import { resolveRubyTriviaConfig } from "./config.js";
import {
  formatObjectDetail,
  formatObjectListing,
  formatObjectSummary,
} from "./domain-views.js";
import { isCacheSliceFresh } from "./platform-cache.js";
import {
  loadPulseState,
  resolveSinceParam,
  savePulseCursor,
} from "./pulse-state.js";
import {
  RUBY_TRIVIA_PULSE_SERVICE_TYPE,
  type RubyTriviaPulseService,
} from "./services/ruby-trivia-pulse.js";
import type {
  CommunityDifficulty,
  CommunityOverview,
  PlatformHappenings,
  PublishDailyResult,
} from "./types/admin.js";
import type {
  DailyListResponse,
  DailyRevokeResult,
  QuestionListResponse,
  UserKnowledgeApiResponse,
  UserKnowledgeProfile,
  UserListResponse,
} from "./types/domain.js";

export type RubyTriviaOp =
  | "health"
  | "poll_happenings"
  | "get_community"
  | "get_community_difficulty"
  | "list_users"
  | "get_user_knowledge"
  | "list_questions"
  | "create_question"
  | "hide_question"
  | "list_dailies"
  | "publish_daily"
  | "revoke_daily"
  | "list_achievements"
  | "create_achievement"
  | "award_achievement"
  | "list_achievement_groups"
  | "create_achievement_group"
  | "list_challenges"
  | "assign_challenges"
  | "get_changelog"
  | "get_openapi"
  | "list_categories"
  | "create_category"
  | "get_audit_summary"
  | "list_audit_questions"
  | "get_audit_question"
  | "get_audit_question_history"
  | "audit_daily_preview"
  | "audit_actions"
  | "audit_replace"
  | "audit_validate"
  | "get_device_fingerprints"
  | "get_analytics_overview"
  | "get_analytics_retention"
  | "list_locale_coverage"
  | "list_feedback";

export const RUBY_TRIVIA_OPS: readonly RubyTriviaOp[] = [
  "health",
  "poll_happenings",
  "get_community",
  "get_community_difficulty",
  "list_users",
  "get_user_knowledge",
  "list_questions",
  "create_question",
  "hide_question",
  "list_dailies",
  "publish_daily",
  "revoke_daily",
  "list_achievements",
  "create_achievement",
  "award_achievement",
  "list_achievement_groups",
  "create_achievement_group",
  "list_challenges",
  "assign_challenges",
  "get_changelog",
  "get_openapi",
  "list_categories",
  "create_category",
  "get_audit_summary",
  "list_audit_questions",
  "get_audit_question",
  "get_audit_question_history",
  "audit_daily_preview",
  "audit_actions",
  "audit_replace",
  "audit_validate",
  "get_device_fingerprints",
  "get_analytics_overview",
  "get_analytics_retention",
  "list_locale_coverage",
  "list_feedback",
] as const;

function readParam(
  options: Record<string, unknown> | undefined,
  key: string,
): unknown {
  const parameters = options?.parameters;
  if (parameters && typeof parameters === "object" && key in parameters) {
    return (parameters as Record<string, unknown>)[key];
  }
  return options?.[key];
}

function readString(
  options: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = readParam(options, key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(
  options: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = readParam(options, key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readBoolean(
  options: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = readParam(options, key);
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

function auditQueryReader(
  options: Record<string, unknown> | undefined,
): {
  readString: (key: string) => string | undefined;
  readNumber: (key: string) => number | undefined;
  readBoolean: (key: string) => boolean | undefined;
} {
  return {
    readString: (key) => readString(options, key),
    readNumber: (key) => readNumber(options, key),
    readBoolean: (key) => readBoolean(options, key),
  };
}

function readRequestBody(
  options: Record<string, unknown> | undefined,
): unknown {
  const body = readParam(options, "body");
  if (body && typeof body === "object") return body;
  return undefined;
}

function readStringArray(
  options: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  const value = readParam(options, key);
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildQuery(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/** Strip email before operator-facing payloads — public chat uses displayName only. */
function stripUserEmail<T extends { email?: string }>(
  user: T,
): Omit<T, "email"> {
  const { email: _email, ...rest } = user;
  return rest;
}

function sanitizePublicFailureMessage(text: string): string {
  if (
    /secret|403|503|http|localhost|127\.0\.0\.1|ECONNREFUSED|\/api\/|analytics/i.test(
      text,
    )
  ) {
    return "Couldn't fetch Ruby Trivia data right now. Try again shortly.";
  }
  return text;
}

function failure(
  text: string,
  data?: ProviderDataRecord,
  userFacingText?: string,
): ActionResult {
  const publicText = userFacingText ?? sanitizePublicFailureMessage(text);
  return {
    success: false,
    text,
    userFacingText: publicText,
    verifiedUserFacing: true,
    data,
  };
}

function success(
  text: string,
  data?: ProviderDataRecord,
  userFacingText?: string,
): ActionResult {
  const publicText = userFacingText ?? text;
  return {
    success: true,
    text,
    userFacingText: publicText,
    verifiedUserFacing: true,
    data,
  };
}

function getPulseService(
  runtime: IAgentRuntime,
): RubyTriviaPulseService | null {
  if (typeof runtime.getService !== "function") return null;
  return (
    runtime.getService<RubyTriviaPulseService>(
      RUBY_TRIVIA_PULSE_SERVICE_TYPE,
    ) ?? null
  );
}

export async function executeRubyTriviaOp(
  runtime: IAgentRuntime,
  op: RubyTriviaOp,
  options?: Record<string, unknown>,
): Promise<ActionResult> {
  const config = resolveRubyTriviaConfig(runtime);

  switch (op) {
    case "health": {
      const pulse = getPulseService(runtime);
      const cached = pulse?.getPlatformCache().health;
      if (cached && isCacheSliceFresh(cached) && cached.summary) {
        return success(
          cached.summary,
          { fromCache: true, health: cached.data },
          cached.summary,
        );
      }
      const result = await rubyHealthFetch(runtime);
      if (!result.ok) {
        return failure(
          `Could not reach Ruby Trivia at ${config.baseUrl}/api/health: ${result.message}`,
          { error: result },
          formatServiceUnavailablePublic(),
        );
      }
      const text = formatHealthSummary(config.baseUrl, result.data);
      return success(
        text,
        {
          healthUrl: `${config.baseUrl}/api/health`,
          payload: result.data,
        },
        formatHealthSummaryPublic(result.data),
      );
    }

    case "poll_happenings": {
      const explicitSince = readString(options, "since");
      const pulse = getPulseService(runtime);
      const cached = pulse?.getPlatformCache().happenings;
      if (
        !explicitSince &&
        cached &&
        isCacheSliceFresh(cached) &&
        cached.summary
      ) {
        return success(
          cached.summary,
          {
            fromCache: true,
            happenings: cached.data,
            generatedAt: cached.data?.generatedAt,
          },
          cached.summary,
        );
      }
      const state = loadPulseState(runtime);
      const since =
        readString(options, "since") ??
        resolveSinceParam(state.lastGeneratedAt);
      const limit = readNumber(options, "limit") ?? 200;
      const result = await rubyAdminFetch<PlatformHappenings>(
        runtime,
        "GET",
        `/api/admin/happenings${buildQuery({ since, limit })}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      if (result.data.generatedAt) {
        savePulseCursor(runtime, result.data.generatedAt);
      }
      const summary = summarizeHappenings(result.data);
      const listing = formatObjectListing(
        "happening_timeline_item",
        getHappeningsTimeline(result.data)
          .slice(0, 5)
          .map((item) => ({
            kind: item.kind,
            at: item.at,
            event: item.event,
            displayName: item.displayName,
            summary: item.summary,
          })),
      );
      const text = `${summary}\n${listing}`;
      return success(
        text,
        {
          happenings: result.data,
          generatedAt: result.data.generatedAt,
        },
        summary,
      );
    }

    case "get_community": {
      const pulse = getPulseService(runtime);
      const cached = pulse?.getPlatformCache().community;
      if (cached && isCacheSliceFresh(cached) && cached.summary) {
        return success(
          cached.summary,
          {
            fromCache: true,
            community: cached.data,
          },
          cached.summary,
        );
      }
      const since = readString(options, "since");
      const result = await rubyAdminFetch<CommunityOverview>(
        runtime,
        "GET",
        `/api/admin/community${buildQuery({ since })}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const summary = summarizeCommunity(result.data);
      return success(
        summary,
        {
          community: result.data,
        },
        formatObjectSummary("community_overview", result.data),
      );
    }

    case "get_community_difficulty": {
      const pulse = getPulseService(runtime);
      const cached = pulse?.getPlatformCache().communityDifficulty;
      if (cached && isCacheSliceFresh(cached) && cached.summary) {
        return success(
          cached.summary,
          {
            fromCache: true,
            difficulty: cached.data,
          },
          cached.summary,
        );
      }
      const result = await rubyAdminFetch<CommunityDifficulty>(
        runtime,
        "GET",
        "/api/admin/community/difficulty",
      );
      if (!result.ok) return failure(result.message, { error: result });
      const summary = summarizeCommunityDifficulty(result.data);
      const listing = formatObjectListing("community_difficulty", result.data);
      return success(
        `${summary}\n${listing}`,
        {
          difficulty: result.data,
        },
        summary,
      );
    }

    case "list_users": {
      const limit = readNumber(options, "limit") ?? 50;
      const offset = readNumber(options, "offset") ?? 0;
      const hasLearnGoals = readBoolean(options, "hasLearnGoals");
      const result = await rubyAdminFetch<UserListResponse>(
        runtime,
        "GET",
        `/api/admin/users${buildQuery({
          limit,
          offset,
          ...(hasLearnGoals === true ? { hasLearnGoals: true } : {}),
        })}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const users = {
        ...result.data,
        users: result.data.users.map(stripUserEmail),
      };
      const listing = formatObjectListing("user", users);
      return success(listing, { users }, listing);
    }

    case "get_user_knowledge": {
      const userId = readString(options, "userId");
      if (!userId) return failure("get_user_knowledge requires userId.");
      const result = await rubyAdminFetch<UserKnowledgeApiResponse>(
        runtime,
        "GET",
        `/api/admin/users/${encodeURIComponent(userId)}/knowledge`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const knowledge: UserKnowledgeProfile = {
        user: stripUserEmail(result.data.user),
        profile: result.data.profile,
        weakCategories: result.data.profile.weakCategories.map(
          (w) => w.category,
        ),
        sm2Sample: result.data.sm2Sample,
        dueQuestions: result.data.dueQuestions,
      };
      const summary = formatObjectSummary("user_knowledge_profile", knowledge);
      const detail = formatObjectDetail("user_knowledge_profile", knowledge);
      const listing = formatObjectListing("sm2_row", knowledge.sm2Sample ?? []);
      const text = listing ? `${detail}\n${listing}` : detail;
      return success(text, { knowledge }, summary);
    }

    case "list_questions": {
      const result = await rubyAdminFetch<QuestionListResponse>(
        runtime,
        "GET",
        `/api/admin/questions${buildQuery({
          category: readString(options, "category"),
          difficulty: readString(options, "difficulty"),
          source: readString(options, "source"),
          status: readString(options, "status"),
          language: readString(options, "language"),
          culture: readString(options, "culture"),
          translationSuitable: readBoolean(options, "translationSuitable"),
        })}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const listing = formatObjectListing("question_bank", result.data);
      return success(listing, { questions: result.data }, listing);
    }

    case "create_question": {
      const body = {
        category: readString(options, "category"),
        difficulty: readString(options, "difficulty"),
        question: readString(options, "question"),
        options: readStringArray(options, "options"),
        correctIndex: readNumber(options, "correctIndex"),
        explanation: readString(options, "explanation"),
        language: readString(options, "language"),
        locale: readString(options, "locale"),
        culture: readString(options, "culture"),
        translationSuitable: readBoolean(options, "translationSuitable"),
      };
      if (
        !body.category ||
        !body.difficulty ||
        !body.question ||
        !body.options ||
        body.options.length !== 4 ||
        body.correctIndex === undefined
      ) {
        return failure(
          "create_question requires category, difficulty, question, options[4], correctIndex.",
        );
      }
      const result = await rubyAdminFetch<{ question: { id: string } }>(
        runtime,
        "POST",
        "/api/admin/questions",
        body,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const question = { ...body, id: result.data.question.id };
      const detail = formatObjectDetail("question", question);
      return success(detail, { question: result.data.question }, detail);
    }

    case "hide_question": {
      const id = readString(options, "id") ?? readString(options, "questionId");
      if (!id) return failure("hide_question requires id.");
      const result = await rubyAdminFetch<{ id: string; status: string }>(
        runtime,
        "PATCH",
        `/api/admin/questions/${encodeURIComponent(id)}`,
        { status: "hidden" },
      );
      if (!result.ok) return failure(result.message, { error: result });
      const detail = formatObjectDetail("question", result.data);
      return success(detail, { question: result.data }, detail);
    }

    case "list_dailies": {
      const result = await rubyAdminFetch<DailyListResponse>(
        runtime,
        "GET",
        `/api/admin/daily${buildQuery({
          date: readString(options, "date"),
          scope: readString(options, "scope"),
          userId: readString(options, "userId"),
          gameId: readString(options, "gameId"),
        })}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const listing = formatObjectListing("published_daily", result.data);
      return success(listing, { publishes: result.data }, listing);
    }

    case "publish_daily": {
      const body = {
        date: readString(options, "date"),
        scope: readString(options, "scope"),
        questionIds: readStringArray(options, "questionIds"),
        notes: readString(options, "notes"),
        force: readBoolean(options, "force") ?? false,
        userId: readString(options, "userId"),
      };
      if (!body.date || !body.scope || !body.questionIds?.length) {
        return failure("publish_daily requires date, scope, and questionIds.");
      }
      const result = await rubyAdminFetch<PublishDailyResult>(
        runtime,
        "POST",
        "/api/admin/daily/publish",
        body,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const summary = summarizePublishResult(result.data);
      const detail = formatObjectDetail("daily_publish_result", result.data);
      return success(detail, { publish: result.data }, summary);
    }

    case "revoke_daily": {
      const date = readString(options, "date");
      const scope = readString(options, "scope");
      if (!date || !scope) {
        return failure("revoke_daily requires date and scope.");
      }
      const result = await rubyAdminFetch<DailyRevokeResult>(
        runtime,
        "DELETE",
        `/api/admin/daily/publish${buildQuery({
          date,
          scope,
          userId: readString(options, "userId"),
          gameId: readString(options, "gameId"),
        })}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const summary = formatObjectSummary("daily_revoke_result", result.data);
      const detail = formatObjectDetail("daily_revoke_result", result.data);
      return success(detail, { revoke: result.data }, summary);
    }

    case "list_achievements": {
      const result = await rubyAdminFetch<{
        achievements: Array<Record<string, unknown>>;
      }>(
        runtime,
        "GET",
        `/api/admin/achievements${buildQuery({
          gameId: readString(options, "gameId"),
        })}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const listing = formatObjectListing(
        "achievement_definition",
        result.data,
      );
      return success(listing, { achievements: result.data }, listing);
    }

    case "create_achievement": {
      const body = readParam(options, "body");
      const payload =
        body && typeof body === "object"
          ? body
          : {
              id: readString(options, "id"),
              gameId: readString(options, "gameId"),
              name: readString(options, "name"),
              description: readString(options, "description"),
              icon: readString(options, "icon"),
              trigger: readString(options, "trigger"),
              condition: readParam(options, "condition"),
              tier: readNumber(options, "tier"),
              groupId: readString(options, "groupId"),
              hidden: readBoolean(options, "hidden"),
              sortOrder: readNumber(options, "sortOrder"),
            };
      const result = await rubyAdminFetch<{ id: string; createdAt: string }>(
        runtime,
        "POST",
        "/api/admin/achievements",
        payload,
      );
      if (!result.ok) return failure(result.message, { error: result });
      return success(`Created achievement ${result.data.id}.`, {
        achievement: result.data,
      });
    }

    case "award_achievement": {
      const id =
        readString(options, "id") ?? readString(options, "achievementId");
      const userId = readString(options, "userId");
      if (!id || !userId) {
        return failure("award_achievement requires id and userId.");
      }
      const result = await rubyAdminFetch<{ awarded: boolean }>(
        runtime,
        "POST",
        `/api/admin/achievements/${encodeURIComponent(id)}/award`,
        { userId },
      );
      if (!result.ok) return failure(result.message, { error: result });
      const awardedText = result.data.awarded
        ? `Awarded achievement ${id} to ${userId}.`
        : `Achievement ${id} was not awarded to ${userId} (may already be earned).`;
      const detail = formatObjectDetail("earned_badge", {
        awarded: result.data.awarded,
      });
      return success(awardedText, { award: result.data }, detail);
    }

    case "list_achievement_groups": {
      const result = await rubyAdminFetch<{
        groups: Array<Record<string, unknown>>;
      }>(runtime, "GET", "/api/admin/achievement-groups");
      if (!result.ok) return failure(result.message, { error: result });
      const listing = formatObjectListing("achievement_group", result.data);
      return success(listing, { groups: result.data }, listing);
    }

    case "create_achievement_group": {
      const body = readParam(options, "body");
      const payload =
        body && typeof body === "object"
          ? body
          : {
              id: readString(options, "id"),
              gameId: readString(options, "gameId"),
              name: readString(options, "name"),
              description: readString(options, "description"),
              masteryBadgeId: readString(options, "masteryBadgeId"),
              memberIds: readStringArray(options, "memberIds"),
            };
      const result = await rubyAdminFetch<{ id: string; createdAt: string }>(
        runtime,
        "POST",
        "/api/admin/achievement-groups",
        payload,
      );
      if (!result.ok) return failure(result.message, { error: result });
      return success(`Created achievement group ${result.data.id}.`, {
        group: result.data,
      });
    }

    case "list_challenges": {
      const result = await rubyAdminFetch<{
        challenges: Array<Record<string, unknown>>;
      }>(
        runtime,
        "GET",
        `/api/admin/challenges${buildQuery({
          userId: readString(options, "userId"),
          date: readString(options, "date"),
        })}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const listing = formatObjectListing("active_challenge", result.data);
      return success(listing, { challenges: result.data }, listing);
    }

    case "assign_challenges": {
      const body = {
        userId: readString(options, "userId"),
        date: readString(options, "date"),
        achievementIds: readStringArray(options, "achievementIds"),
      };
      if (!body.userId || !body.date || !body.achievementIds?.length) {
        return failure(
          "assign_challenges requires userId, date, and achievementIds.",
        );
      }
      const result = await rubyAdminFetch<{
        assigned: number;
        date: string;
        userId: string;
      }>(runtime, "POST", "/api/admin/challenges/assign", body);
      if (!result.ok) return failure(result.message, { error: result });
      return success(
        `Assigned ${result.data.assigned} challenge(s) to ${result.data.userId} for ${result.data.date}.`,
        { assignment: result.data },
      );
    }

    case "get_changelog": {
      const result = await rubyAdminFetch<{
        slug: string;
        path: string;
        content: string;
        updatedAt: string;
      }>(runtime, "GET", "/api/admin/changelog");
      if (!result.ok) return failure(result.message, { error: result });
      const summary = formatObjectSummary("agent_doc", result.data);
      const preview = result.data.content.split("\n").slice(0, 8).join("\n");
      return success(
        `${summary}\n${preview}`,
        { changelog: result.data },
        summary,
      );
    }

    case "get_openapi": {
      const result = await rubyAdminFetch<{
        info?: { version?: string; "x-audit-api-version"?: number };
        paths?: Record<string, unknown>;
      }>(runtime, "GET", "/api/admin/openapi.json");
      if (!result.ok) return failure(result.message, { error: result });
      const summary = summarizeOpenApiMeta(result.data);
      return success(summary, { openapi: result.data }, summary);
    }

    case "list_categories": {
      const result = await rubyAdminFetch<{
        categories: Array<Record<string, unknown>>;
      }>(runtime, "GET", "/api/admin/categories");
      if (!result.ok) return failure(result.message, { error: result });
      const listing = formatObjectListing("question_bank", {
        count: result.data.categories.length,
        questions: result.data.categories.map((cat) => ({
          id: String(cat.id ?? ""),
          category: String(cat.id ?? ""),
          difficulty: "—",
          question: String(cat.label ?? cat.id ?? ""),
        })),
      });
      return success(
        `${result.data.categories.length} categories.\n${listing}`,
        { categories: result.data },
        `${result.data.categories.length} trivia categories loaded.`,
      );
    }

    case "create_category": {
      const body = readRequestBody(options) ?? {
        id: readString(options, "id"),
        label: readString(options, "label"),
        icon: readString(options, "icon"),
      };
      if (!body || typeof body !== "object" || !("id" in body)) {
        return failure("create_category requires id (and optional label, icon).");
      }
      const result = await rubyAdminFetch<{ category: Record<string, unknown> }>(
        runtime,
        "POST",
        "/api/admin/categories",
        body,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const id = String(result.data.category.id ?? "category");
      return success(`Created category ${id}.`, { category: result.data.category });
    }

    case "get_audit_summary": {
      const path = `/api/admin/audit/summary${buildAuditListQuery(auditQueryReader(options))}`;
      const result = await rubyAdminFetch<Record<string, unknown>>(
        runtime,
        "GET",
        path,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const audit = result.data.audit as { needsReview?: number } | undefined;
      const summary = audit?.needsReview
        ? `Audit summary — ${audit.needsReview} need review.`
        : "Audit summary loaded.";
      return success(summary, { auditSummary: result.data }, summary);
    }

    case "list_audit_questions": {
      const path = `/api/admin/audit/questions${buildAuditListQuery(auditQueryReader(options))}`;
      const result = await rubyAdminFetch<{
        items?: unknown[];
        hasMore?: boolean;
        dbTotal?: number;
      }>(runtime, "GET", path);
      if (!result.ok) return failure(result.message, { error: result });
      const summary = summarizeAuditList(result.data);
      return success(summary, { auditQuestions: result.data }, summary);
    }

    case "get_audit_question": {
      const id = readString(options, "id") ?? readString(options, "questionId");
      if (!id) return failure("get_audit_question requires id.");
      const result = await rubyAdminFetch<Record<string, unknown>>(
        runtime,
        "GET",
        `/api/admin/audit/questions/${encodeURIComponent(id)}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      return success(`Audit detail for ${id} loaded.`, {
        auditQuestion: result.data,
      });
    }

    case "get_audit_question_history": {
      const id = readString(options, "id") ?? readString(options, "questionId");
      if (!id) return failure("get_audit_question_history requires id.");
      const result = await rubyAdminFetch<Record<string, unknown>>(
        runtime,
        "GET",
        `/api/admin/audit/questions/${encodeURIComponent(id)}/history`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      return success(`Audit history for ${id} loaded.`, {
        auditHistory: result.data,
      });
    }

    case "audit_daily_preview": {
      const path = `/api/admin/audit/daily-preview${buildQuery({
        locale: readString(options, "locale"),
        date: readString(options, "date"),
        userId: readString(options, "userId"),
      })}`;
      const result = await rubyAdminFetch<Record<string, unknown>>(
        runtime,
        "GET",
        path,
      );
      if (!result.ok) return failure(result.message, { error: result });
      return success("Daily locale preview loaded.", {
        dailyPreview: result.data,
      });
    }

    case "audit_actions": {
      const dryRun = readBoolean(options, "dryRun");
      const body = readRequestBody(options);
      if (!body) {
        return failure("audit_actions requires body with actions[].");
      }
      const path = `/api/admin/audit/actions${buildQuery({
        ...(dryRun === true ? { dryRun: true } : {}),
      })}`;
      const result = await rubyAdminFetch<Record<string, unknown>>(
        runtime,
        "POST",
        path,
        body,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const applied = result.data.applied;
      const summary =
        typeof applied === "number"
          ? `Audit actions applied: ${applied}.`
          : "Audit actions completed.";
      return success(summary, { auditActions: result.data }, summary);
    }

    case "audit_replace": {
      const body = readRequestBody(options);
      if (!body) {
        return failure("audit_replace requires body with replacesQuestionId + replacement.");
      }
      const result = await rubyAdminFetch<Record<string, unknown>>(
        runtime,
        "POST",
        "/api/admin/audit/questions/replace",
        body,
      );
      if (!result.ok) return failure(result.message, { error: result });
      return success("Audit replace completed.", { auditReplace: result.data });
    }

    case "audit_validate": {
      const body = readRequestBody(options);
      if (!body) {
        return failure("audit_validate requires draft question body.");
      }
      const result = await rubyAdminFetch<{
        reject?: boolean;
        needsReview?: boolean;
        issues?: unknown[];
      }>(runtime, "POST", "/api/admin/audit/validate", body);
      if (!result.ok) return failure(result.message, { error: result });
      const issueCount = result.data.issues?.length ?? 0;
      const summary = result.data.reject
        ? `Pre-insert audit would reject (${issueCount} issue(s)).`
        : result.data.needsReview
          ? `Pre-insert audit needs review (${issueCount} issue(s)).`
          : "Pre-insert audit clean.";
      return success(summary, { auditValidate: result.data }, summary);
    }

    case "get_device_fingerprints": {
      const fields = readString(options, "fields");
      const result = await rubyAdminFetch<Record<string, unknown>>(
        runtime,
        "GET",
        `/api/analytics/device-fingerprints${buildQuery({
          since: readString(options, "since"),
          minUsers: readNumber(options, "minUsers"),
          fields: fields === "multiAccount" ? "multiAccount" : undefined,
        })}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const multi = Array.isArray(result.data.multiAccountFingerprints)
        ? result.data.multiAccountFingerprints.length
        : 0;
      return success(
        `Device fingerprints loaded — ${multi} multi-account cluster(s).`,
        { deviceFingerprints: result.data },
        `Fingerprint check complete (${multi} multi-account signals).`,
      );
    }

    case "get_analytics_overview": {
      const result = await rubyAdminFetch<Record<string, unknown>>(
        runtime,
        "GET",
        `/api/analytics/overview${buildQuery({ since: readString(options, "since") })}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      return success("Analytics overview loaded.", {
        analyticsOverview: result.data,
      });
    }

    case "get_analytics_retention": {
      const result = await rubyAdminFetch<Record<string, unknown>>(
        runtime,
        "GET",
        `/api/analytics/retention${buildQuery({ since: readString(options, "since") })}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      return success("Analytics retention loaded.", {
        analyticsRetention: result.data,
      });
    }

    case "list_locale_coverage": {
      const result = await rubyAdminFetch<Record<string, unknown>>(
        runtime,
        "GET",
        "/api/admin/locale-coverage",
      );
      if (!result.ok) return failure(result.message, { error: result });
      return success("Locale coverage loaded.", {
        localeCoverage: result.data,
      });
    }

    case "list_feedback": {
      const result = await rubyAdminFetch<Record<string, unknown>>(
        runtime,
        "GET",
        `/api/admin/feedback${buildQuery({
          type: readString(options, "type"),
          limit: readNumber(options, "limit"),
        })}`,
      );
      if (!result.ok) return failure(result.message, { error: result });
      const submissions = Array.isArray(result.data.submissions)
        ? result.data.submissions.length
        : 0;
      return success(
        `${submissions} feedback submission(s) loaded.`,
        { feedback: result.data },
        `${submissions} feedback items loaded.`,
      );
    }

    default:
      return failure(`Unsupported Ruby Trivia op: ${op satisfies never}`);
  }
}

export function normalizeRubyTriviaOp(value: unknown): RubyTriviaOp | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return (RUBY_TRIVIA_OPS as readonly string[]).includes(normalized)
    ? (normalized as RubyTriviaOp)
    : null;
}
