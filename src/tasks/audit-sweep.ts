import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { runAuditSweepCycle, summarizeCycle } from "../audit-sweep.js";
import { resolveRubyTriviaConfig } from "../config.js";

const LOG_PREFIX = "[AuditSweep]";
/** Longest first-run delay of the three tasks - housekeeping yields to authoring on boot. */
const FIRST_RUN_DELAY_MS = 5 * 60_000;

/**
 * Re-judges warned-but-playable questions on a slow cadence.
 *
 * Replaces the systemd timer Odi rejected in ruby-trivia#130 ("no llm on the server, only the
 * agent"). Same job, correct home: the model call happens here, and the server only ever sees a
 * batch of decided actions on `/api/admin/audit/actions`.
 */
export function startAuditSweepTask(runtime: IAgentRuntime): () => void {
  const config = resolveRubyTriviaConfig(runtime);
  if (!config.auditSweepEnabled) {
    logger.info({ reason: "RUBY_AUDIT_SWEEP_ENABLED=0" }, `${LOG_PREFIX} task not started`);
    return () => {};
  }
  if (!config.analyticsSecret) {
    logger.info({ reason: "missing RUBY_ANALYTICS_SECRET" }, `${LOG_PREFIX} task not started`);
    return () => {};
  }

  logger.info(
    {
      intervalMinutes: config.auditSweepIntervalMinutes,
      perCycle: config.auditSweepPerCycle,
      dryRun: config.auditSweepDryRun,
      firstRunDelayMs: FIRST_RUN_DELAY_MS,
    },
    `${LOG_PREFIX} task scheduled`,
  );

  const intervalMs = config.auditSweepIntervalMinutes * 60_000;
  const tick = () => {
    logger.info({ dryRun: config.auditSweepDryRun }, `${LOG_PREFIX} tick`);
    runAuditSweepCycle(runtime, config)
      .then((result) => {
        if (result.errors.length > 0) {
          runtime.logger?.warn({ errors: result.errors }, `${LOG_PREFIX} cycle had errors`);
        }
        logger.info({ summary: summarizeCycle(result) }, `${LOG_PREFIX} cycle done`);
      })
      .catch((error) => {
        runtime.logger?.error({ error }, `${LOG_PREFIX} scheduled cycle failed`);
      });
  };

  const initialTick = setTimeout(tick, FIRST_RUN_DELAY_MS);
  const interval = setInterval(tick, intervalMs);
  if (typeof interval.unref === "function") {
    interval.unref();
  }

  return () => {
    clearTimeout(initialTick);
    clearInterval(interval);
    logger.info({}, `${LOG_PREFIX} task stopped`);
  };
}
