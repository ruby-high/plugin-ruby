import type { IAgentRuntime, Plugin } from "@elizaos/core";
import { checkTriviaVisitsAction } from "./actions/check-trivia-visits.js";
import { rubyTriviaAction } from "./actions/ruby-trivia.js";
import { suggestBullpostAction } from "./actions/suggest-bullpost.js";
import { applyRubyCharacter, isRubyAgent } from "./character.js";
import { logZerollamaIntegrationOnInit } from "./zerollama-client.js";
import { logRubyTriviaConfigOnInit } from "./config.js";
import { rubyBullpostsProvider } from "./providers/bullposts.js";
import { rubyContextProvider } from "./providers/context.js";
import { rubyApiLimitsProvider } from "./providers/limits.js";
import { rubyObjectsProvider } from "./providers/objects.js";
import { rubyPlatformProvider } from "./providers/platform.js";
import { RubyTriviaPulseService } from "./services/ruby-trivia-pulse.js";
import { startPulseTask } from "./tasks/pulse.js";
import { startBullpostTask } from "./tasks/bullpost.js";
import { handleBullpostDiscordInteraction } from "./bullpost-tweet-handler.js";
import { startQuestionAuthoringTask } from "./tasks/question-authoring.js";
import { startMadlibAuthoringTask } from "./tasks/madlib-authoring.js";

export { checkTriviaVisitsAction } from "./actions/check-trivia-visits.js";
export { rubyTriviaAction } from "./actions/ruby-trivia.js";
export { suggestBullpostAction } from "./actions/suggest-bullpost.js";
export {
  applyRubyCharacter,
  getRubyCharacter,
  isRubyAgent,
  RUBY_CHARACTER_ID,
  resetRubyCharacterCache,
  rubyCharacter,
} from "./character.js";
export {
  resolveRubyTriviaApiUrl,
  resolveRubyTriviaConfig,
} from "./config.js";
export {
  loadRubyCharacterFromElizaConfig,
  resolveElizaConfigCandidates,
} from "./load-ruby-character.js";
export { rubyBullpostsProvider } from "./providers/bullposts.js";
export { rubyContextProvider } from "./providers/context.js";
export { rubyApiLimitsProvider } from "./providers/limits.js";
export { rubyObjectsProvider } from "./providers/objects.js";
export { rubyPlatformProvider } from "./providers/platform.js";
export {
  RUBY_TRIVIA_PULSE_SERVICE_TYPE,
  RubyTriviaPulseService,
} from "./services/ruby-trivia-pulse.js";

let stopPulseTask: (() => void) | null = null;
let stopQuestionAuthoringTask: (() => void) | null = null;
let stopMadlibAuthoringTask: (() => void) | null = null;
let stopBullpostTask: (() => void) | null = null;

/**
 * Ruby Trivia operator plugin.
 *
 * Lifecycle split:
 * - `services[]` — core registers RubyTriviaPulseService once (do not registerService again in init).
 * - `init` — apply character, start interval task only for agents named Ruby.
 * - `dispose` — clear interval so hot-reload does not leak timers.
 *
 * Provider order (context → limits → objects → platform → bullposts):
 * WHY: playbook → boundaries → taxonomy → live numbers → social drafts.
 */
export const rubyPlugin: Plugin = {
  name: "ruby",
  description:
    "Ruby agent plugin — loads the Ruby character from eliza config and adds Ruby Trivia integrations.",
  actions: [rubyTriviaAction, checkTriviaVisitsAction, suggestBullpostAction],
  providers: [
    rubyContextProvider,
    rubyApiLimitsProvider,
    rubyObjectsProvider,
    rubyPlatformProvider,
    rubyBullpostsProvider,
  ],
  services: [RubyTriviaPulseService],
  events: {
    DISCORD_INTERACTION: [handleBullpostDiscordInteraction],
  },
  init: async (_config, runtime: IAgentRuntime) => {
    applyRubyCharacter(runtime);
    if (!isRubyAgent(runtime)) return;

    logRubyTriviaConfigOnInit(runtime);
    void logZerollamaIntegrationOnInit();

    if (stopPulseTask) {
      stopPulseTask();
      stopPulseTask = null;
    }
    if (stopQuestionAuthoringTask) {
      stopQuestionAuthoringTask();
      stopQuestionAuthoringTask = null;
    }
    if (stopMadlibAuthoringTask) {
      stopMadlibAuthoringTask();
      stopMadlibAuthoringTask = null;
    }
    if (stopBullpostTask) {
      stopBullpostTask();
      stopBullpostTask = null;
    }

    stopPulseTask = startPulseTask(runtime);
    stopQuestionAuthoringTask = startQuestionAuthoringTask(runtime);
    stopMadlibAuthoringTask = startMadlibAuthoringTask(runtime);
    stopBullpostTask = startBullpostTask(runtime);
  },
  dispose: async () => {
    if (stopPulseTask) {
      stopPulseTask();
      stopPulseTask = null;
    }
    if (stopQuestionAuthoringTask) {
      stopQuestionAuthoringTask();
      stopQuestionAuthoringTask = null;
    }
    if (stopMadlibAuthoringTask) {
      stopMadlibAuthoringTask();
      stopMadlibAuthoringTask = null;
    }
    if (stopBullpostTask) {
      stopBullpostTask();
      stopBullpostTask = null;
    }
  },
};

export default rubyPlugin;
