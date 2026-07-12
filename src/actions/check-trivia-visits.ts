import type {
  Action,
  ActionExample,
  ActionResult,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { executeRubyTriviaOp } from "../admin-ops.js";
import { isRubyAgent } from "../character.js";

/** Compat alias for older prompts — delegates to RUBY_TRIVIA op=health. */
export const checkTriviaVisitsAction: Action = {
  name: "CHECK_TRIVIA_VISITS",
  description:
    "Check whether Ruby Trivia game services are online. Public-safe status only — no URLs or infra details. For player activity use RUBY_TRIVIA op=poll_happenings; for struggle signals use op=get_community.",
  similes: [
    "CHECK_TRIVIA",
    "TRIVIA_STATUS",
    "TRIVIA_HEALTH",
    "check_trivia_visits",
    "trivia visits",
  ],
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "can you check trivia visits?" },
      } as ActionExample,
      {
        name: "{{agentName}}",
        content: {
          text: "Ruby Trivia is online. Game services are responding.",
          action: "CHECK_TRIVIA_VISITS",
        },
      } as ActionExample,
    ],
  ],
  validate: async (runtime: IAgentRuntime) => isRubyAgent(runtime),
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
  ): Promise<ActionResult> => {
    return executeRubyTriviaOp(runtime, "health");
  },
};
