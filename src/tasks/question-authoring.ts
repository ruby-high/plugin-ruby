import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { resolveRubyTriviaConfig } from "../config.js";
import { runQuestionAuthoringCycle } from "../question-authoring.js";
import type { RubyTriviaPulseService } from "../services/ruby-trivia-pulse.js";
import { RUBY_TRIVIA_PULSE_SERVICE_TYPE } from "../services/ruby-trivia-pulse.js";

const LOG_PREFIX = "[QuestionAuthoring]";
const FIRST_RUN_DELAY_MS = 2 * 60_000;

/**
 * Slower cadence than pulse — drafts new dynamic bank rows via LLM + admin API.
 */
export function startQuestionAuthoringTask(runtime: IAgentRuntime): () => void {
  const config = resolveRubyTriviaConfig(runtime);
  if (!config.questionAuthoringEnabled) {
    logger.info({ reason: "RUBY_QUESTION_AUTHORING_ENABLED=0" }, `${LOG_PREFIX} task not started`);
    return () => {};
  }
  if (!config.analyticsSecret) {
    logger.info({ reason: "missing RUBY_ANALYTICS_SECRET" }, `${LOG_PREFIX} task not started`);
    return () => {};
  }

  logger.info(
    {
      intervalMinutes: config.questionAuthoringIntervalMinutes,
      questionsPerCycle: config.questionsPerCycle,
      firstRunDelayMs: FIRST_RUN_DELAY_MS,
      debug: config.questionAuthoringDebug,
    },
    `${LOG_PREFIX} task scheduled`,
  );

  const intervalMs = config.questionAuthoringIntervalMinutes * 60_000;
  const tick = () => {
    logger.info(
      { intervalMinutes: config.questionAuthoringIntervalMinutes },
      `${LOG_PREFIX} tick`,
    );

    const pulse = runtime.getService<RubyTriviaPulseService>(
      RUBY_TRIVIA_PULSE_SERVICE_TYPE,
    );
    const weakCategories =
      pulse?.getPlatformCache().communityDifficulty.data?.weakCategories ?? [];

    runQuestionAuthoringCycle(runtime, config, weakCategories).catch((error) => {
      runtime.logger.error(
        { error },
        `${LOG_PREFIX} scheduled cycle failed`,
      );
    });
  };

  // Defer first tick so service registration finishes and pulse/cache is warm.
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
