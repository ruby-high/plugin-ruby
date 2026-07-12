import type { IAgentRuntime } from "@elizaos/core";
import { resolveRubyTriviaConfig } from "../config.js";
import type { RubyTriviaPulseService } from "../services/ruby-trivia-pulse.js";
import { RUBY_TRIVIA_PULSE_SERVICE_TYPE } from "../services/ruby-trivia-pulse.js";

/**
 * Wall-clock pulse scheduler — lives outside the service because elizaOS services
 * do not own intervals; plugin init/dispose manages the timer lifecycle.
 */
export function startPulseTask(runtime: IAgentRuntime): () => void {
  const config = resolveRubyTriviaConfig(runtime);
  if (!config.pulseEnabled || !config.analyticsSecret) {
    return () => {};
  }

  const intervalMs = config.pulseIntervalMinutes * 60_000;
  const tick = () => {
    const service = runtime.getService<RubyTriviaPulseService>(
      RUBY_TRIVIA_PULSE_SERVICE_TYPE,
    );
    if (!service) return;
    service.runPulse().catch((error) => {
      runtime.logger.error(
        { error },
        "[plugin-ruby] Scheduled pulse task failed",
      );
    });
  };

  // Defer first tick so service registration finishes before getService().
  const initialTick = setTimeout(tick, 0);
  const interval = setInterval(tick, intervalMs);
  if (typeof interval.unref === "function") {
    // Do not keep the process alive solely for pulse on CLI one-shots.
    interval.unref();
  }

  return () => {
    clearTimeout(initialTick);
    clearInterval(interval);
  };
}
