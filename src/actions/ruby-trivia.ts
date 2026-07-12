import type {
  Action,
  ActionExample,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import {
  executeRubyTriviaOp,
  normalizeRubyTriviaOp,
  RUBY_TRIVIA_OPS,
} from "../admin-ops.js";
import { isRubyAgent } from "../character.js";

function readOp(options?: Record<string, unknown>): string | undefined {
  const parameters = options?.parameters;
  if (parameters && typeof parameters === "object") {
    const record = parameters as Record<string, unknown>;
    for (const key of ["op", "operation", "action", "subaction"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  for (const key of ["op", "operation", "action", "subaction"]) {
    const value = options?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Single LLM tool surface for admin ops — keeps action planner small, handlers typed in admin-ops.ts. */
export const rubyTriviaAction: Action = {
  name: "RUBY_TRIVIA",
  description:
    "Ruby Trivia platform operator. Player/game questions: op=poll_happenings (recent activity, signups, badges, live queue), op=get_community / op=get_community_difficulty (where players struggle). Game up/down only: op=health. Never expose API URLs, hosts, ports, or model names in public chat.",
  similes: [
    "RUBY_ADMIN",
    "TRIVIA_PULSE",
    "PUBLISH_DAILY",
    "RUBY_TRIVIA_ADMIN",
    "RUBY_PLATFORM",
    "trivia admin",
    "ruby trivia",
  ],
  parameters: [
    {
      name: "op",
      description: `Admin operation: ${RUBY_TRIVIA_OPS.join(", ")}`,
      required: true,
      schema: {
        type: "string",
        enum: [...RUBY_TRIVIA_OPS],
      },
    },
  ],
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "how are players doing on trivia?" },
      } as ActionExample,
      {
        name: "{{agentName}}",
        content: {
          text: "pulling the latest player pulse.",
          action: "RUBY_TRIVIA",
        },
      } as ActionExample,
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "pulse the trivia platform" },
      } as ActionExample,
      {
        name: "{{agentName}}",
        content: {
          text: "pulling the latest happenings now.",
          action: "RUBY_TRIVIA",
        },
      } as ActionExample,
    ],
  ],
  validate: async (runtime: IAgentRuntime) => isRubyAgent(runtime),
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    const op = normalizeRubyTriviaOp(readOp(options));
    if (!op) {
      const text = `RUBY_TRIVIA requires op. Supported: ${RUBY_TRIVIA_OPS.join(", ")}.`;
      if (callback) await callback({ text });
      return { success: false, text };
    }

    const result = await executeRubyTriviaOp(runtime, op, options);
    return result;
  },
};
