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
  formatBullpostSuggestions,
  normalizeBullpostTheme,
  suggestBullposts,
} from "../bullposts.js";
import { generateBullpostWithLlm } from "../bullpost-authoring.js";
import { isRubyAgent } from "../character.js";
import { resolveRubyTriviaConfig } from "../config.js";

function readParam(
  options: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  const parameters = options?.parameters;
  if (parameters && typeof parameters === "object") {
    const record = parameters as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }
  }
  for (const key of keys) {
    const value = options?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function readCount(options?: Record<string, unknown>): number {
  const raw = readParam(options, ["count", "n", "limit"]);
  if (!raw) return 1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 1;
}

function readBool(options: Record<string, unknown> | undefined, keys: string[]): boolean | null {
  const raw = readParam(options, keys);
  if (raw == null) return null;
  const v = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return null;
}

export const suggestBullpostAction: Action = {
  name: "SUGGEST_BULLPOST",
  description:
    "Generate on-brand $RUBY bullposts with the LLM (few-shot from the marketing bank). Use for tweets, posts, bullposts, promo copy. Themes: intro, family, challenge, categories, token, learning. Default: LLM drafts. Set bankOnly=true to pull verbatim bank posts.",
  similes: [
    "RUBY_BULLPOST",
    "BULLPOST",
    "SUGGEST_TWEET",
    "RUBY_TWEET",
    "promo post",
    "bull post",
    "suggest bullpost",
    "draft ruby post",
  ],
  parameters: [
    {
      name: "theme",
      description:
        "Optional theme: intro | family | challenge | categories | token | learning | any",
      required: false,
      schema: {
        type: "string",
        enum: [
          "intro",
          "family",
          "challenge",
          "categories",
          "token",
          "learning",
          "any",
        ],
      },
    },
    {
      name: "count",
      description: "How many posts to generate (1–5, default 1)",
      required: false,
      schema: { type: "number" },
    },
    {
      name: "bankOnly",
      description: "If true, return verbatim bank posts instead of LLM drafts",
      required: false,
      schema: { type: "boolean" },
    },
  ],
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "suggest a few $RUBY bullposts" },
      } as ActionExample,
      {
        name: "{{agentName}}",
        content: {
          text: "drafting fresh bullposts from the $RUBY voice bank.",
          action: "SUGGEST_BULLPOST",
        },
      } as ActionExample,
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "draft a family trivia tweet for RUBY" },
      } as ActionExample,
      {
        name: "{{agentName}}",
        content: {
          text: "writing a family-theme bullpost now.",
          action: "SUGGEST_BULLPOST",
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
    if (!isRubyAgent(runtime)) {
      return {
        success: false,
        text: "SUGGEST_BULLPOST is only available on the Ruby agent.",
      };
    }

    const theme = normalizeBullpostTheme(readParam(options, ["theme", "topic"]));
    const count = Math.min(Math.max(readCount(options), 1), 5);
    const bankOnly = readBool(options, ["bankOnly", "fromBank"]) === true;
    const config = resolveRubyTriviaConfig(runtime);

    if (bankOnly) {
      const posts = suggestBullposts({ count, theme });
      const text = formatBullpostSuggestions(posts);
      if (callback) await callback({ text });
      return {
        success: true,
        text,
        data: {
          theme,
          mode: "bank",
          posts: posts.map((post) => ({
            id: post.id,
            theme: post.theme,
            text: post.text,
          })),
        },
      };
    }

    const generated: Array<{ theme: string; text: string; exampleIds: string[] }> =
      [];
    for (let i = 0; i < count; i += 1) {
      const draft = await generateBullpostWithLlm(runtime, {
        theme,
        debug: config.bullpostDebug,
      });
      if (draft) {
        generated.push({
          theme: draft.theme,
          text: draft.text,
          exampleIds: draft.exampleIds,
        });
      }
    }

    if (generated.length === 0) {
      // Fail soft: bank fallback so the operator still gets copy.
      const posts = suggestBullposts({ count, theme });
      const text =
        "LLM draft unavailable — here are bank posts instead:\n\n" +
        formatBullpostSuggestions(posts);
      if (callback) await callback({ text });
      return {
        success: true,
        text,
        data: { theme, mode: "bank-fallback", count: posts.length },
      };
    }

    const blocks = generated.map(
      (post, index) =>
        `--- bullpost ${index + 1}/${generated.length} · ${post.theme} · llm ---\n${post.text}`,
    );
    const text = `Here are ${generated.length} fresh LLM $RUBY bullpost(s):\n\n${blocks.join("\n\n")}`;
    if (callback) await callback({ text });
    return {
      success: true,
      text,
      data: { theme, mode: "llm", posts: generated },
    };
  },
};
