import type { IAgentRuntime } from "@elizaos/core";
import { logger, parseJSONObjectFromText } from "@elizaos/core";
import { rubyAdminFetch, rubyHealthFetch } from "./admin-client.js";
import {
  buildAuditActions,
  buildSweepPrompt,
  isSweepVerdict,
  summarizeCycle,
  type AuditQuestionItem,
  type AuditSweepCycleResult,
  type SweepJudgement,
} from "./audit-sweep-policy.js";
import type { RubyTriviaConfig } from "./config.js";

/**
 * Sweeps questions the pre-insert audit flagged but let through.
 *
 * WHY this exists: `preInsertAudit` on the trivia server rejects criticals outright, but warnings
 * (verbose_options, missing_explanation, near-duplicate distractors...) insert with
 * `needs_review = 1` and stay PLAYABLE. Nothing ever came back for them, so warned questions
 * accumulate in the live bank indefinitely. A real one shipped to an X poll and did not fit the
 * buttons - that is what this closes.
 *
 * WHY it lives in the agent and not a server cron: Odi's rule, stated when he closed
 * ruby-trivia#130 - "no llm on the server, only the agent." That PR was a systemd timer on the
 * trivia box shelling out to Ollama. Same job, correct home.
 *
 * The server keeps the deterministic half (audit codes, severity, the `/audit/*` routes). This adds
 * only the judgement a rule cannot make: is this warning actually a problem for a player?
 *
 * Decision rules live in `audit-sweep-policy.ts` so they are testable without a runtime.
 */

const LOG_PREFIX = "[AuditSweep]";
const DEBUG_RAW_CHARS = 400;

export { buildAuditActions, buildSweepPrompt, summarizeCycle };
export type { AuditQuestionItem, AuditSweepCycleResult, SweepJudgement };

function previewText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function logDebug(debug: boolean, data: Record<string, unknown>, message: string): void {
  if (debug) logger.info(data, `${LOG_PREFIX} ${message}`);
}

/**
 * Fast judge model over Ollama, same shape as judgeQuestion / judgeMadlib.
 *
 * FAIL-CLOSED, unlike the authoring judges. Those approve on failure because the cost of a missed
 * draft is nothing. Here the cost of acting on a bad judgement is hiding a good question from live
 * players, so an unreachable or confused judge means "leave it exactly as it is" - `judgeOk: false`
 * causes `buildAuditActions` to drop the row entirely.
 */
export async function judgeFlaggedQuestion(
  item: AuditQuestionItem,
  judgeModel: string,
  ollamaBaseUrl: string,
  debug: boolean,
): Promise<SweepJudgement> {
  if (!judgeModel.trim()) {
    return { verdict: "keep", reason: "judge disabled", judgeOk: false };
  }

  try {
    const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: judgeModel,
        messages: [{ role: "user", content: buildSweepPrompt(item) }],
        stream: false,
        format: "json",
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, judgeModel, id: item.id },
        `${LOG_PREFIX} judge HTTP error - leaving question untouched`,
      );
      return { verdict: "keep", reason: "judge unreachable", judgeOk: false };
    }

    const body = (await response.json()) as { message?: { content?: string } };
    const raw = body.message?.content ?? "";
    logDebug(debug, { id: item.id, rawPreview: previewText(raw, DEBUG_RAW_CHARS) }, "judge response");

    const parsed = parseJSONObjectFromText(raw);
    const verdict = parsed?.verdict;
    const reason = typeof parsed?.reason === "string" ? parsed.reason : "no reason given";

    if (isSweepVerdict(verdict)) {
      return { verdict, reason, judgeOk: true };
    }

    logger.warn(
      { id: item.id, verdictRaw: verdict, raw: previewText(raw, 200) },
      `${LOG_PREFIX} unrecognised verdict - leaving question untouched`,
    );
    return { verdict: "keep", reason: "unrecognised verdict", judgeOk: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      { error: message, judgeModel, id: item.id },
      `${LOG_PREFIX} judge call failed - leaving question untouched`,
    );
    return { verdict: "keep", reason: `judge error: ${message}`, judgeOk: false };
  }
}

type AuditPage = { items?: AuditQuestionItem[]; hasMore?: boolean };

async function fetchFlagged(
  runtime: IAgentRuntime,
  max: number,
): Promise<{ items: AuditQuestionItem[]; error?: string }> {
  const query = new URLSearchParams({
    needsReview: "true",
    status: "active",
    minSeverity: "warning",
    limit: String(max),
  });
  const result = await rubyAdminFetch<AuditPage>(
    runtime,
    "GET",
    `/api/admin/audit/questions?${query.toString()}`,
  );
  if (!result.ok) return { items: [], error: result.message };
  return { items: result.data.items ?? [] };
}

/**
 * One sweep. Skips quietly when the admin API or health is unavailable, exactly like the authoring
 * cycles - a sweep that cannot reach the server is not an error worth waking anyone for.
 */
export async function runAuditSweepCycle(
  runtime: IAgentRuntime,
  config: Pick<
    RubyTriviaConfig,
    | "analyticsSecret"
    | "auditSweepPerCycle"
    | "auditSweepDebug"
    | "auditSweepDryRun"
    | "questionJudgeModel"
  >,
): Promise<AuditSweepCycleResult> {
  const debug = config.auditSweepDebug;
  const result: AuditSweepCycleResult = {
    scanned: 0,
    hidden: 0,
    kept: 0,
    flaggedForHuman: 0,
    skipped: 0,
    errors: [],
  };

  if (!config.analyticsSecret) {
    result.errors.push("missing analytics secret");
    return result;
  }

  const health = await rubyHealthFetch(runtime);
  if (!health.ok) {
    logger.info({ reason: health.message }, `${LOG_PREFIX} trivia API unavailable - skipping cycle`);
    result.errors.push(health.message);
    return result;
  }

  const { items, error } = await fetchFlagged(runtime, config.auditSweepPerCycle);
  if (error) {
    logger.warn({ error }, `${LOG_PREFIX} could not list flagged questions`);
    result.errors.push(error);
    return result;
  }
  if (items.length === 0) {
    logger.info({}, `${LOG_PREFIX} nothing flagged - bank is clean`);
    return result;
  }

  const ollamaBaseUrl = (
    process.env.ZEROLLAMA_API_ENDPOINT ||
    process.env.OLLAMA_BASE_URL ||
    "http://localhost:11434"
  ).replace(/\/+$/, "");

  const judged: { item: AuditQuestionItem; judgement: SweepJudgement }[] = [];
  for (const item of items) {
    result.scanned += 1;
    const judgement = await judgeFlaggedQuestion(
      item,
      config.questionJudgeModel,
      ollamaBaseUrl,
      debug,
    );
    judged.push({ item, judgement });
    if (!judgement.judgeOk) {
      result.skipped += 1;
      continue;
    }
    if (judgement.verdict === "hide") result.hidden += 1;
    else if (judgement.verdict === "needs_human") result.flaggedForHuman += 1;
    else result.kept += 1;
  }

  const actions = buildAuditActions(judged, LOG_PREFIX);
  if (actions.length === 0) {
    logger.info({ ...result }, `${LOG_PREFIX} cycle complete - no actions needed`);
    return result;
  }

  const path = config.auditSweepDryRun
    ? "/api/admin/audit/actions?dryRun=true"
    : "/api/admin/audit/actions";
  const posted = await rubyAdminFetch<unknown>(runtime, "POST", path, { actions });
  if (!posted.ok) {
    logger.warn({ error: posted.message }, `${LOG_PREFIX} action batch failed`);
    result.errors.push(posted.message);
    // The counts described intent, not outcome - do not report work that did not happen.
    result.hidden = 0;
    result.flaggedForHuman = 0;
    result.skipped = result.scanned;
    return result;
  }

  logger.info(
    { ...result, dryRun: config.auditSweepDryRun },
    `${LOG_PREFIX} cycle complete - ${summarizeCycle(result)}`,
  );
  return result;
}
