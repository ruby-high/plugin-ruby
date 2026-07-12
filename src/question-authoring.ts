/**
 * Periodic dynamic question authoring for Ruby Trivia.
 *
 * WHY not the full agent loop:
 * - Structured one-shot LLM + POST is cheaper and avoids trajectory limits.
 * - Pulse already owns platform polling; authoring runs on its own slower cadence.
 */
import type { IAgentRuntime } from "@elizaos/core";
import { logger, ModelType, parseJSONObjectFromText } from "@elizaos/core";
import { rubyAdminFetch, rubyHealthFetch } from "./admin-client.js";
import type { RubyTriviaConfig } from "./config.js";
import {
  DEFAULT_JUDGE_DISTRACTOR_RETRIES,
  resolveAnalyticsSecretWithSource,
} from "./config.js";
import {
  loadAuthoringSlotIndex,
  saveAuthoringSlotIndex,
} from "./question-authoring-state.js";
import {
  isTriviaCategory,
  TRIVIA_CATEGORIES,
  TRIVIA_DIFFICULTIES,
  type TriviaCategory,
  type TriviaDifficulty,
} from "./trivia-taxonomy.js";
import type { QuestionListResponse } from "./types/domain.js";

export type {
  TriviaCategory,
  TriviaDifficulty,
} from "./trivia-taxonomy.js";
export {
  TRIVIA_CATEGORIES,
  TRIVIA_DIFFICULTIES,
} from "./trivia-taxonomy.js";

export type AuthoringTarget = {
  category: TriviaCategory;
  difficulty: TriviaDifficulty;
};

export type DraftQuestion = {
  category: TriviaCategory;
  difficulty: TriviaDifficulty;
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation?: string;
};

export type AuthoringCycleResult = {
  attempted: number;
  created: number;
  skipped: number;
  errors: string[];
};

export type JudgeVerdict = "approve" | "hide" | "revise_distractors";

export type JudgeResult = {
  verdict: JudgeVerdict;
  reason: string;
  /** Whether the judge call itself succeeded (false = network/parse failure). */
  judgeOk: boolean;
};

const LOG_PREFIX = "[QuestionAuthoring]";
const PREVIEW_CHARS = 120;
const DEBUG_RAW_CHARS = 400;

const TOTAL_SLOTS = TRIVIA_CATEGORIES.length * TRIVIA_DIFFICULTIES.length;

function previewText(text: string, max = PREVIEW_CHARS): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function logDebug(
  debug: boolean,
  context: Record<string, unknown>,
  msg: string,
) {
  if (!debug) return;
  logger.info(context, `${LOG_PREFIX} ${msg}`);
}

/** Flat rotation across all category × difficulty pairs. */
export function slotToTarget(slot: number): AuthoringTarget {
  const normalized = ((slot % TOTAL_SLOTS) + TOTAL_SLOTS) % TOTAL_SLOTS;
  const categoryIndex = Math.floor(normalized / TRIVIA_DIFFICULTIES.length);
  const difficultyIndex = normalized % TRIVIA_DIFFICULTIES.length;
  return {
    category: TRIVIA_CATEGORIES[categoryIndex]!,
    difficulty: TRIVIA_DIFFICULTIES[difficultyIndex]!,
  };
}

/**
 * Pick distinct authoring targets for one cycle.
 * Every 3rd slot biases toward a weak community category when provided.
 */
export function pickAuthoringTargets(params: {
  count: number;
  slotIndex: number;
  weakCategories?: string[];
}): { targets: AuthoringTarget[]; nextSlotIndex: number } {
  const count = Math.max(1, params.count);
  const weak = (params.weakCategories ?? []).filter(isTriviaCategory);
  const targets: AuthoringTarget[] = [];
  let slot = params.slotIndex;

  for (let i = 0; i < count; i++) {
    let target = slotToTarget(slot);
    const weakBiased = weak.length > 0 && slot % 3 === 0;
    if (weakBiased) {
      target = {
        category: weak[slot % weak.length]!,
        difficulty: target.difficulty,
      };
    }
    targets.push(target);
    slot += 1;
  }

  return { targets, nextSlotIndex: slot % TOTAL_SLOTS };
}

export function buildQuestionAuthoringPrompt(params: {
  target: AuthoringTarget;
  existingSamples: string[];
}): string {
  const samples =
    params.existingSamples.length > 0
      ? `Avoid duplicating these existing prompts:\n${params.existingSamples.map((q) => `- ${q}`).join("\n")}\n`
      : "";

  return `Write one original Ruby Trivia multiple-choice question.

Category: ${params.target.category}
Difficulty: ${params.target.difficulty}

Rules:
- Exactly one question string and exactly four answer options.
- correctIndex is 0–3 (which option is correct).
- Wrong answers must be plausible same-type distractors (e.g. countries for country questions, not food items).
- No trick questions, no "all of the above", no true/false phrasing.
- easy = common knowledge; medium = thoughtful recall; hard = specific expertise.
- explanation is one short sentence teaching why the answer is right.
${samples}
Return ONLY JSON:
{
  "question": "...",
  "options": ["...", "...", "...", "..."],
  "correctIndex": 0,
  "explanation": "..."
}`;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const items = value.map((item) => readString(item));
  if (items.some((item) => !item)) return null;
  return items as [string, string, string, string];
}

function readCorrectIndex(value: unknown): 0 | 1 | 2 | 3 | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > 3) return null;
  return value as 0 | 1 | 2 | 3;
}

/** Parse and validate LLM JSON into a draft question payload. */
export function parseGeneratedQuestion(
  raw: string,
  target: AuthoringTarget,
): DraftQuestion | null {
  const parsed = parseJSONObjectFromText(raw);
  if (!parsed) return null;

  const question = readString(parsed.question);
  const options = readStringArray(parsed.options);
  const correctIndex = readCorrectIndex(parsed.correctIndex);
  const explanation = readString(parsed.explanation) ?? undefined;

  if (!question || !options || correctIndex === null) return null;

  const uniqueOptions = new Set(options.map((o) => o.toLowerCase()));
  if (uniqueOptions.size !== 4) return null;
  if (options[correctIndex] === undefined) return null;

  return {
    category: target.category,
    difficulty: target.difficulty,
    question,
    options: options as [string, string, string, string],
    correctIndex,
    explanation,
  };
}

export function buildJudgePrompt(draft: DraftQuestion): string {
  const optionLines = draft.options
    .map(
      (opt, i) =>
        `${i + 1}. ${opt}${i === draft.correctIndex ? " (marked correct)" : ""}`,
    )
    .join("\n");

  return `You are a trivia question fact-checker and quality judge.

Question:
${draft.question}

Options:
${optionLines}

Explanation: ${draft.explanation ?? "(none)"}

Tasks:
1. Is the marked correct answer actually correct? (factual accuracy check)
2. Are all wrong options plausible same-type distractors? (not obviously wrong or from a different domain)
3. Does the explanation support the marked correct answer — not a different option?
4. Is the question coherent, readable English with no encoding garbage?

Return ONLY this JSON (no other text):
{"verdict":"approve|hide|revise_distractors","reason":"one sentence"}

- approve: factually correct, explanation matches, distractors plausible
- hide: factual error, invented content, explanation contradicts answer, or incoherent
- revise_distractors: correct answer and explanation OK but one or more distractors are implausible`;
}

/**
 * Call a fast judge model (Ollama) to verify factual accuracy and distractor quality
 * before a draft is submitted to the question bank.
 *
 * WHY direct fetch instead of runtime.useModel: we want a *different* model than the
 * generation model (gemma4-26b judge vs eliza-1:9b author), and we don't want to reconfigure the
 * runtime model map just for one-off judging.
 */
export async function judgeQuestion(
  draft: DraftQuestion,
  judgeModel: string,
  ollamaBaseUrl: string,
  debug: boolean,
): Promise<JudgeResult> {
  if (!judgeModel.trim()) {
    return { verdict: "approve", reason: "judge disabled", judgeOk: true };
  }

  const prompt = buildJudgePrompt(draft);

  try {
    const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: judgeModel,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        format: "json",
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, judgeModel },
        `${LOG_PREFIX} judge HTTP error — approving to avoid blocking`,
      );
      return {
        verdict: "approve",
        reason: "judge unreachable",
        judgeOk: false,
      };
    }

    const body = (await response.json()) as {
      message?: { content?: string };
    };
    const raw = body.message?.content ?? "";

    logDebug(
      debug,
      { judgeModel, rawPreview: previewText(raw, 200) },
      "judge response",
    );

    const parsed = parseJSONObjectFromText(raw);
    const verdict = parsed?.verdict;
    const reason =
      typeof parsed?.reason === "string" ? parsed.reason : "no reason given";

    if (
      verdict === "approve" ||
      verdict === "hide" ||
      verdict === "revise_distractors"
    ) {
      return { verdict, reason, judgeOk: true };
    }

    logger.warn(
      { judgeModel, verdictRaw: verdict, raw: previewText(raw, 200) },
      `${LOG_PREFIX} judge returned unrecognised verdict — approving`,
    );
    return {
      verdict: "approve",
      reason: "unrecognised verdict",
      judgeOk: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      { error: message, judgeModel },
      `${LOG_PREFIX} judge call failed — approving to avoid blocking`,
    );
    return {
      verdict: "approve",
      reason: `judge error: ${message}`,
      judgeOk: false,
    };
  }
}

async function fetchExistingSamples(
  runtime: IAgentRuntime,
  target: AuthoringTarget,
): Promise<string[]> {
  const query = new URLSearchParams({
    category: target.category,
    difficulty: target.difficulty,
  });
  const result = await rubyAdminFetch<QuestionListResponse>(
    runtime,
    "GET",
    `/api/admin/questions?${query.toString()}`,
  );
  if (!result.ok) return [];
  return result.data.questions
    .slice(0, 6)
    .map((q) => q.question)
    .filter(Boolean);
}

async function generateDraft(
  runtime: IAgentRuntime,
  target: AuthoringTarget,
  existingSamples: string[],
  debug: boolean,
): Promise<{ draft: DraftQuestion | null; raw: string | null }> {
  const prompt = buildQuestionAuthoringPrompt({ target, existingSamples });
  logDebug(
    debug,
    { category: target.category, difficulty: target.difficulty },
    "calling LLM",
  );
  const raw = await runtime.useModel(ModelType.TEXT_SMALL, { prompt });
  if (typeof raw !== "string" || !raw.trim()) {
    logger.warn(
      { category: target.category, difficulty: target.difficulty },
      `${LOG_PREFIX} LLM returned empty response`,
    );
    return { draft: null, raw: null };
  }
  logDebug(
    debug,
    {
      category: target.category,
      difficulty: target.difficulty,
      rawChars: raw.length,
      rawPreview: previewText(raw, DEBUG_RAW_CHARS),
    },
    "LLM response",
  );
  return { draft: parseGeneratedQuestion(raw, target), raw };
}

async function createDraft(
  runtime: IAgentRuntime,
  draft: DraftQuestion,
): Promise<
  { ok: true; id: string } | { ok: false; message: string; status?: number }
> {
  const result = await rubyAdminFetch<{ question: { id: string } }>(
    runtime,
    "POST",
    "/api/admin/questions",
    draft,
  );
  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      status: result.status,
    };
  }
  return { ok: true, id: result.data.question.id };
}

/**
 * Run one authoring cycle — generate and POST dynamic questions.
 * Skips quietly when admin API or health is unavailable.
 */
export async function runQuestionAuthoringCycle(
  runtime: IAgentRuntime,
  config: Pick<
    RubyTriviaConfig,
    | "analyticsSecret"
    | "questionsPerCycle"
    | "questionAuthoringDebug"
    | "questionJudgeModel"
  >,
  weakCategories?: string[],
): Promise<AuthoringCycleResult> {
  const debug = config.questionAuthoringDebug;
  const judgeModel = config.questionJudgeModel;
  const ollamaBaseUrl = (
    process.env.ZEROLLAMA_API_ENDPOINT ||
    process.env.OLLAMA_BASE_URL ||
    "http://localhost:11434"
  ).replace(/\/+$/, "");

  const result: AuthoringCycleResult = {
    attempted: 0,
    created: 0,
    skipped: 0,
    errors: [],
  };

  if (!config.analyticsSecret) {
    result.skipped += 1;
    result.errors.push("admin API not configured");
    logger.info(
      { reason: "missing analytics secret" },
      `${LOG_PREFIX} cycle skipped`,
    );
    return result;
  }

  const health = await rubyHealthFetch(runtime);
  if (!health.ok) {
    result.skipped += 1;
    result.errors.push("trivia backend unreachable");
    logger.warn(
      { reason: "health check failed" },
      `${LOG_PREFIX} cycle skipped`,
    );
    return result;
  }

  const slotIndex = loadAuthoringSlotIndex(runtime);
  const { targets, nextSlotIndex } = pickAuthoringTargets({
    count: config.questionsPerCycle,
    slotIndex,
    weakCategories,
  });

  logger.info(
    {
      slotIndex,
      nextSlotIndex,
      targets,
      weakCategories: weakCategories ?? [],
      questionsPerCycle: config.questionsPerCycle,
      judgeModel: judgeModel || "(disabled)",
    },
    `${LOG_PREFIX} cycle starting`,
  );

  for (const target of targets) {
    result.attempted += 1;
    try {
      logger.info(
        { category: target.category, difficulty: target.difficulty },
        `${LOG_PREFIX} drafting question`,
      );

      const existingSamples = await fetchExistingSamples(runtime, target);
      logger.info(
        {
          category: target.category,
          difficulty: target.difficulty,
          existingSampleCount: existingSamples.length,
        },
        `${LOG_PREFIX} loaded existing samples`,
      );

      let { draft, raw } = await generateDraft(
        runtime,
        target,
        existingSamples,
        debug,
      );

      if (!draft) {
        logger.warn(
          {
            category: target.category,
            difficulty: target.difficulty,
            rawPreview: raw ? previewText(raw, DEBUG_RAW_CHARS) : null,
          },
          `${LOG_PREFIX} parse failed — retrying LLM once`,
        );
        ({ draft, raw } = await generateDraft(
          runtime,
          target,
          existingSamples,
          debug,
        ));
      }

      if (!draft) {
        const message = `failed to parse question for ${target.category}/${target.difficulty}`;
        result.errors.push(message);
        logger.warn(
          {
            category: target.category,
            difficulty: target.difficulty,
            rawPreview: raw ? previewText(raw, DEBUG_RAW_CHARS) : null,
          },
          `${LOG_PREFIX} parse failed after retry`,
        );
        continue;
      }

      // --- Judge loop ---
      // Run a fast judge model before submitting. On hide → drop. On revise_distractors →
      // regenerate up to DEFAULT_JUDGE_DISTRACTOR_RETRIES times before dropping.
      let judgeVerdict: JudgeVerdict = "approve";
      let judgeAttempt = 0;
      const maxDistractorRetries = DEFAULT_JUDGE_DISTRACTOR_RETRIES;

      while (judgeAttempt <= maxDistractorRetries) {
        const judgeResult = await judgeQuestion(
          draft,
          judgeModel,
          ollamaBaseUrl,
          debug,
        );

        logger.info(
          {
            category: target.category,
            difficulty: target.difficulty,
            verdict: judgeResult.verdict,
            reason: judgeResult.reason,
            judgeOk: judgeResult.judgeOk,
            judgeAttempt,
            judgeModel: judgeModel || "(disabled)",
          },
          `${LOG_PREFIX} judge result`,
        );

        judgeVerdict = judgeResult.verdict;

        if (judgeResult.verdict === "approve") break;

        if (judgeResult.verdict === "hide") {
          // Hard reject — factual error, invented content, or incoherent.
          break;
        }

        // revise_distractors — regenerate and re-judge
        if (judgeAttempt < maxDistractorRetries) {
          logger.info(
            {
              category: target.category,
              difficulty: target.difficulty,
              attempt: judgeAttempt + 1,
              reason: judgeResult.reason,
            },
            `${LOG_PREFIX} distractor revision — regenerating`,
          );
          const next = await generateDraft(
            runtime,
            target,
            existingSamples,
            debug,
          );
          if (next.draft) {
            draft = next.draft;
          }
        }
        judgeAttempt += 1;
      }

      if (judgeVerdict === "hide") {
        result.skipped += 1;
        logger.warn(
          {
            category: target.category,
            difficulty: target.difficulty,
            questionPreview: previewText(draft.question),
          },
          `${LOG_PREFIX} judge rejected question — skipping`,
        );
        continue;
      }

      if (judgeVerdict === "revise_distractors") {
        result.skipped += 1;
        logger.warn(
          {
            category: target.category,
            difficulty: target.difficulty,
            questionPreview: previewText(draft.question),
          },
          `${LOG_PREFIX} distractor revisions exhausted — skipping`,
        );
        continue;
      }

      logger.info(
        {
          category: target.category,
          difficulty: target.difficulty,
          questionPreview: previewText(draft.question),
          correctIndex: draft.correctIndex,
        },
        `${LOG_PREFIX} draft approved — posting to admin API`,
      );

      const created = await createDraft(runtime, draft);
      if (!created.ok) {
        if (created.status === 409) {
          result.skipped += 1;
          logger.info(
            {
              category: target.category,
              difficulty: target.difficulty,
              questionPreview: previewText(draft.question),
            },
            `${LOG_PREFIX} duplicate text — skipped (409)`,
          );
          continue;
        }
        if (created.status === 422) {
          result.skipped += 1;
          logger.warn(
            {
              category: target.category,
              difficulty: target.difficulty,
              questionPreview: previewText(draft.question),
              message: created.message,
            },
            `${LOG_PREFIX} server audit gate rejected draft (422) — skipping`,
          );
          continue;
        }
        result.errors.push(created.message);
        const secretDebug =
          created.status === 403
            ? resolveAnalyticsSecretWithSource(runtime)
            : null;
        logger.warn(
          {
            category: target.category,
            difficulty: target.difficulty,
            status: created.status,
            message: created.message,
            ...(secretDebug
              ? {
                  analyticsSecret: secretDebug.secret,
                  analyticsSecretSource: secretDebug.source,
                  analyticsSecretLength: secretDebug.secret?.length ?? 0,
                }
              : {}),
          },
          `${LOG_PREFIX} admin API rejected draft`,
        );
        continue;
      }

      result.created += 1;
      logger.info(
        {
          id: created.id,
          category: target.category,
          difficulty: target.difficulty,
          questionPreview: previewText(draft.question),
        },
        `${LOG_PREFIX} created dynamic question`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown authoring error";
      result.errors.push(message);
      logger.error(
        {
          error,
          category: target.category,
          difficulty: target.difficulty,
        },
        `${LOG_PREFIX} target failed`,
      );
    }
  }

  saveAuthoringSlotIndex(runtime, nextSlotIndex);
  logger.info(
    {
      attempted: result.attempted,
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
      nextSlotIndex,
    },
    `${LOG_PREFIX} cycle complete`,
  );
  return result;
}
