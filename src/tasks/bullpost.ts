import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { runBullpostCycle } from "../bullpost-authoring.js";
import { resolveRubyTriviaConfig } from "../config.js";

const LOG_PREFIX = "[BullpostTask]";
/** Let Discord connector finish ready before first suggestion. */
const FIRST_RUN_DELAY_MS = 2 * 60_000;

/**
 * Periodic $RUBY bullpost suggestions to Discord — LLM drafts seeded by the marketing bank.
 */
export function startBullpostTask(runtime: IAgentRuntime): () => void {
  const config = resolveRubyTriviaConfig(runtime);
  if (!config.bullpostEnabled) {
    logger.info(
      { reason: "RUBY_BULLPOST_ENABLED=0" },
      `${LOG_PREFIX} task not started`,
    );
    return () => {};
  }
  if (!config.discordChannelId || !config.discordAnnounceEnabled) {
    logger.info(
      { reason: "discord announce unavailable" },
      `${LOG_PREFIX} task not started`,
    );
    return () => {};
  }

  logger.info(
    {
      intervalMinutes: config.bullpostIntervalMinutes,
      firstRunDelayMs: FIRST_RUN_DELAY_MS,
      channelId: config.discordChannelId,
      debug: config.bullpostDebug,
      siteUrl: config.bullpostSiteUrl,
    },
    `${LOG_PREFIX} task scheduled`,
  );

  const intervalMs = config.bullpostIntervalMinutes * 60_000;
  let inFlight = false;

  const tick = () => {
    if (inFlight) {
      logger.debug(`${LOG_PREFIX} already in flight — skipping`);
      return;
    }
    inFlight = true;
    logger.info(
      { intervalMinutes: config.bullpostIntervalMinutes },
      `${LOG_PREFIX} tick`,
    );

    // Re-resolve so env toggles apply without full process restart when possible.
    const latest = resolveRubyTriviaConfig(runtime);
    runBullpostCycle(runtime, latest)
      .catch((error) => {
        runtime.logger.error({ error }, `${LOG_PREFIX} cycle failed`);
      })
      .finally(() => {
        inFlight = false;
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
