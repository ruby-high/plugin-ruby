import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { rubyAdminFetch } from "../admin-client.js";
import { resolveRubyTriviaConfig } from "../config.js";
import type { DailyListResponse } from "../types/domain.js";
import type { PublishDailyResult } from "../types/admin.js";

const LOG_PREFIX = "[DailyPublish]";
/** Run well after boot so pulse/question-authoring settle first, then daily after that. */
const FIRST_RUN_DELAY_MS = 5 * 60_000;
const TICK_INTERVAL_MS = 60 * 60_000;

type DailyPreviewResponse = {
  date: string;
  count: number;
  questionIds: string[];
};

function todayKeyUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Publish today's community daily (with an X poll question) if nobody has yet.
 *
 * WHY the agent does this proactively instead of waiting for an operator to call
 * publish_daily: the X poll scheduler (bot-gw) requires a community-scope publish with
 * pollQuestionId before it will post anything - without this task the poll silently sat on
 * "poll_not_ready" forever. The API also auto-publishes as a last-resort fallback
 * (resolveOrGenerateDailyPollQuestion), so this task is a courtesy, not a hard dependency -
 * failures here just mean the API's own fallback publishes instead.
 */
export async function runDailyPublishCheck(runtime: IAgentRuntime): Promise<void> {
  const config = resolveRubyTriviaConfig(runtime);
  if (!config.analyticsSecret) return;

  const date = todayKeyUtc();

  const listing = await rubyAdminFetch<DailyListResponse>(
    runtime,
    "GET",
    `/api/admin/daily?date=${encodeURIComponent(date)}&scope=community`,
  );
  if (!listing.ok) {
    logger.warn(
      { error: listing.message },
      `${LOG_PREFIX} could not check today's publish state`,
    );
    return;
  }

  const alreadyPublished = listing.data.publishes.some(
    (p) => p.date === date && p.scope === "community",
  );
  if (alreadyPublished) return;

  const preview = await rubyAdminFetch<DailyPreviewResponse>(
    runtime,
    "GET",
    `/api/admin/audit/daily-preview?date=${encodeURIComponent(date)}`,
  );
  if (!preview.ok || preview.data.questionIds.length < 5) {
    logger.warn(
      { error: !preview.ok ? preview.message : "too few candidate questions" },
      `${LOG_PREFIX} could not build a daily preview - leaving publish to API auto-fallback`,
    );
    return;
  }

  const questionIds = preview.data.questionIds;
  const pollQuestionId = questionIds[0];

  const result = await rubyAdminFetch<PublishDailyResult>(
    runtime,
    "POST",
    "/api/admin/daily/publish",
    {
      date,
      scope: "community",
      questionIds,
      pollQuestionId,
      notes: "auto-published by plugin-ruby daily-publish task",
    },
  );

  if (!result.ok) {
    // 409 (already exists) is a benign race with another agent/process publishing first.
    if (result.status === 409) return;
    logger.error({ error: result.message }, `${LOG_PREFIX} publish_daily failed`);
    return;
  }

  logger.info(
    { date, pollQuestionId, questionCount: questionIds.length },
    `${LOG_PREFIX} published today's community daily`,
  );
}

/**
 * Hourly check task (cheap: one GET most hours; only publishes once per UTC day).
 * WHY hourly not daily: agent restarts / missed midnight ticks self-heal within the hour
 * instead of leaving the X poll starved until the next scheduled run.
 */
export function startDailyPublishTask(runtime: IAgentRuntime): () => void {
  const config = resolveRubyTriviaConfig(runtime);
  if (!config.analyticsSecret) {
    logger.info({ reason: "missing RUBY_ANALYTICS_SECRET" }, `${LOG_PREFIX} task not started`);
    return () => {};
  }

  logger.info(
    { firstRunDelayMs: FIRST_RUN_DELAY_MS, tickIntervalMs: TICK_INTERVAL_MS },
    `${LOG_PREFIX} task scheduled`,
  );

  const tick = () => {
    runDailyPublishCheck(runtime).catch((error) => {
      logger.error({ error }, `${LOG_PREFIX} scheduled check failed`);
    });
  };

  const initialTick = setTimeout(tick, FIRST_RUN_DELAY_MS);
  const interval = setInterval(tick, TICK_INTERVAL_MS);
  if (typeof interval.unref === "function") {
    interval.unref();
  }

  return () => {
    clearTimeout(initialTick);
    clearInterval(interval);
    logger.info({}, `${LOG_PREFIX} task stopped`);
  };
}
