import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { resolveRubyTriviaConfig } from "../config.js";
import { runMadlibAuthoringCycle } from "../madlib-authoring.js";

const LOG_PREFIX = "[MadlibAuthoring]";
const FIRST_RUN_DELAY_MS = 3 * 60_000;

/**
 * Slower cadence than question authoring — drafts mad-lib templates via LLM + admin API.
 *
 * Ships DISABLED by default: the `/api/admin/madlibs` route does not exist yet, so an enabled
 * cycle would just 404 each POST. Opt in with RUBY_MADLIB_AUTHORING_ENABLED=1 once that route
 * and the templates table land on the trivia server.
 */
export function startMadlibAuthoringTask(runtime: IAgentRuntime): () => void {
  const config = resolveRubyTriviaConfig(runtime);
  if (!config.madlibAuthoringEnabled) {
    logger.info(
      { reason: "RUBY_MADLIB_AUTHORING_ENABLED not set (default off)" },
      `${LOG_PREFIX} task not started`,
    );
    return () => {};
  }
  if (!config.analyticsSecret) {
    logger.info({ reason: "missing RUBY_ANALYTICS_SECRET" }, `${LOG_PREFIX} task not started`);
    return () => {};
  }

  logger.info(
    {
      intervalMinutes: config.madlibAuthoringIntervalMinutes,
      madlibsPerCycle: config.madlibsPerCycle,
      firstRunDelayMs: FIRST_RUN_DELAY_MS,
      debug: config.madlibAuthoringDebug,
    },
    `${LOG_PREFIX} task scheduled`,
  );

  const intervalMs = config.madlibAuthoringIntervalMinutes * 60_000;
  const tick = () => {
    logger.info(
      { intervalMinutes: config.madlibAuthoringIntervalMinutes },
      `${LOG_PREFIX} tick`,
    );
    runMadlibAuthoringCycle(runtime, config).catch((error) => {
      runtime.logger.error({ error }, `${LOG_PREFIX} scheduled cycle failed`);
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
