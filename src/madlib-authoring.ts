/**
 * Periodic mad-lib authoring for Ruby Trivia.
 *
 * Sibling of question-authoring.ts, same shape and same reasons:
 * - Structured one-shot LLM + POST is cheaper than the full agent loop and avoids trajectory limits.
 * - Runs on its own slow cadence, separate from pulse polling.
 *
 * A mad lib is a short story with typed, indexed blanks the player fills in without seeing the
 * story: "The {1:adjective} {2:noun} sprinted toward the {3:place}." The comedy is tight prose
 * around wide-open blanks — so authoring is generate → validate structure → judge → POST.
 *
 * NOTE: the server route `/api/admin/madlibs` does not exist yet. This module is complete and
 * correct in shape; `createDraft` is the single seam that lights up when that route + templates
 * table ship on the trivia server. Until then the authoring task ships DISABLED by default.
 */
import type { IAgentRuntime } from "@elizaos/core";
import { logger, ModelType, parseJSONObjectFromText } from "@elizaos/core";
import { rubyAdminFetch, rubyHealthFetch } from "./admin-client.js";
import type { RubyTriviaConfig } from "./config.js";
import { DEFAULT_JUDGE_DISTRACTOR_RETRIES } from "./config.js";
import {
  loadMadlibThemeIndex,
  saveMadlibThemeIndex,
} from "./madlib-authoring-state.js";
import {
  blanksForLength,
  isMadlibBlankType,
  MADLIB_BLANK_TYPES,
  MADLIB_LENGTHS,
  MADLIB_MAX_BLANKS,
  MADLIB_MIN_BLANKS,
  MADLIB_THEMES,
  type MadlibBlankType,
  type MadlibLength,
  type MadlibTheme,
} from "./madlib-taxonomy.js";

export type {
  MadlibTheme,
  MadlibBlankType,
  MadlibLength,
} from "./madlib-taxonomy.js";
export { MADLIB_THEMES, MADLIB_BLANK_TYPES } from "./madlib-taxonomy.js";

export type MadlibTarget = {
  theme: MadlibTheme;
  length: MadlibLength;
};

export type MadlibBlank = {
  index: number;
  type: MadlibBlankType;
  hint?: string;
};

export type DraftMadlib = {
  theme: MadlibTheme;
  length: MadlibLength;
  title: string;
  text: string;
  blanks: MadlibBlank[];
};

export type MadlibAuthoringCycleResult = {
  attempted: number;
  created: number;
  skipped: number;
  errors: string[];
};

export type JudgeVerdict = "approve" | "hide" | "revise";

export type JudgeResult = {
  verdict: JudgeVerdict;
  reason: string;
  /** Whether the judge call itself succeeded (false = network/parse failure). */
  judgeOk: boolean;
};

const LOG_PREFIX = "[MadlibAuthoring]";
const PREVIEW_CHARS = 120;
const DEBUG_RAW_CHARS = 400;
const MIN_TEXT_WORDS = 20;

/** `{1:adjective}` — indexed AND typed so two adjectives in one story stay distinguishable. */
const PLACEHOLDER_RE = /\{(\d+):([a-z-]+)\}/g;
const ANY_BRACE_RE = /\{[^}]*\}/g;
/** A bare "a"/"an" right before a blank breaks on vowel answers ("a enormous"). Use "a/an". */
const BARE_ARTICLE_BEFORE_BLANK_RE = /(^|[^/\w])(an?)\s+\{\d+:/i;
/** Deterministic backstop; the judge is the real safety net. This gets read aloud on stream. */
const UNSAFE_RE =
  /\b(sex|sexual|porn|nude|rape|suicide|heroin|cocaine|nigg|fagg|retard)\w*/i;

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

/** Flat rotation across themes; each cycle continues where the last left off. */
export function pickMadlibTargets(params: {
  count: number;
  themeIndex: number;
}): { targets: MadlibTarget[]; nextThemeIndex: number } {
  const count = Math.max(1, params.count);
  const targets: MadlibTarget[] = [];
  let index = params.themeIndex;

  for (let i = 0; i < count; i++) {
    const theme = MADLIB_THEMES[index % MADLIB_THEMES.length]!;
    // Cycle lengths short → medium → long so a run isn't all one size.
    const length = MADLIB_LENGTHS[i % MADLIB_LENGTHS.length]!;
    targets.push({ theme, length });
    index += 1;
  }

  return { targets, nextThemeIndex: index % MADLIB_THEMES.length };
}

export function buildMadlibAuthoringPrompt(params: {
  target: MadlibTarget;
  existingTitles: string[];
}): string {
  const target = blanksForLength(params.target.length);
  const avoid =
    params.existingTitles.length > 0
      ? `Avoid reusing these existing titles:\n${params.existingTitles.map((t) => `- ${t}`).join("\n")}\n`
      : "";

  return `Write one original mad lib story template for a party game.

Theme: ${params.target.theme}
Length: ${params.target.length} (about ${target} blanks)

A mad lib is a short story with words removed. Players are asked for a word of each type WITHOUT
seeing the story, then the finished story is read aloud.

Rules:
- Write a real SHORT STORY with a beginning and a turn — not a list of sentences with holes.
  At least four words of prose between blanks; aim for 20+ words total.
- Each blank in the text is written EXACTLY {N:type}: a number, a colon, a type. Correct: {1:adjective}
  Wrong: {adjective}, {1: adjective}, [1:adjective].
- Number blanks 1..N, in order, no gaps, no repeats.
- "type" is one of: ${MADLIB_BLANK_TYPES.join(", ")}
- Use ${MADLIB_MIN_BLANKS}-${MADLIB_MAX_BLANKS} blanks (about ${target}).
- Write "a/an" (never a bare "a") directly before a blank — the player might type "enormous" or
  "apple", and "a enormous machine" reads wrong.
- Put a blank only where ANY word of that type fits — never a sentence that only works with one answer.
- Family-safe: no sex, drugs, slurs, gore, or real living people portrayed badly.
- "blanks" lists every placeholder in the text — same index, same type — and nothing else.
- Title: 2-5 words, no quotes, no emoji.
${avoid}
Return ONLY JSON:
{
  "title": "The Haunted Arcade",
  "text": "Last night I found a/an {1:adjective} machine, and a {2:noun} was eating {3:food} beside it.",
  "blanks": [
    { "index": 1, "type": "adjective", "hint": "describes a spooky place" },
    { "index": 2, "type": "noun" },
    { "index": 3, "type": "food" }
  ]
}`;
}

export type ParsedPlaceholder = { index: number; type: string; start: number; end: number };

/** Extract `{n:type}` placeholders in document order. Also used by the game renderer. */
export function parsePlaceholders(text: string): ParsedPlaceholder[] {
  const found: ParsedPlaceholder[] = [];
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    found.push({
      index: Number(match[1]),
      type: match[2]!,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  return found;
}

function proseWordCount(text: string): number {
  return text.replace(PLACEHOLDER_RE, " ").split(/\s+/).filter(Boolean).length;
}

/**
 * Deterministic structure check — the pre-insert CI, agent-side.
 * Returns a list of human-readable problems; empty means the template is structurally playable.
 * (When `/api/admin/madlibs` ships, the server should enforce the same rules on POST.)
 */
export function validateMadlibStructure(
  text: string,
  blanks: MadlibBlank[],
): string[] {
  const errors: string[] = [];
  const placeholders = parsePlaceholders(text);

  const wellFormed = new Set(placeholders.map((p) => text.slice(p.start, p.end)));
  const malformed = (text.match(ANY_BRACE_RE) ?? []).filter((raw) => !wellFormed.has(raw));
  if (malformed.length > 0) {
    errors.push(`malformed placeholder(s): ${malformed.slice(0, 3).join(", ")}`);
  }

  if (placeholders.length < MADLIB_MIN_BLANKS) {
    errors.push(`too few blanks (${placeholders.length} < ${MADLIB_MIN_BLANKS})`);
  } else if (placeholders.length > MADLIB_MAX_BLANKS) {
    errors.push(`too many blanks (${placeholders.length} > ${MADLIB_MAX_BLANKS})`);
  }

  const seen = new Map<number, number>();
  for (const p of placeholders) seen.set(p.index, (seen.get(p.index) ?? 0) + 1);
  for (const [index, count] of seen) {
    if (count > 1) errors.push(`blank index ${index} used ${count} times`);
  }
  if (placeholders.length > 0) {
    const indices = [...seen.keys()].sort((a, b) => a - b);
    if (!indices.every((n, i) => n === i + 1)) {
      errors.push(`blank indices must be 1..${indices.length}; got ${indices.join(", ")}`);
    }
  }

  for (const p of placeholders) {
    if (!isMadlibBlankType(p.type)) errors.push(`unknown blank type "${p.type}"`);
  }

  const textKeys = placeholders.map((p) => `${p.index}:${p.type}`).sort();
  const blankKeys = blanks.map((b) => `${b.index}:${b.type}`).sort();
  if (textKeys.join("|") !== blankKeys.join("|")) {
    errors.push(`blanks[] does not match text placeholders`);
  }

  if (proseWordCount(text) < MIN_TEXT_WORDS) {
    errors.push(`too little prose (< ${MIN_TEXT_WORDS} words)`);
  }

  if (BARE_ARTICLE_BEFORE_BLANK_RE.test(text)) {
    errors.push(`bare article before a blank — use "a/an"`);
  }

  if (UNSAFE_RE.test(`${text}`)) {
    errors.push(`unsafe content`);
  }

  return errors;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBlanks(value: unknown): MadlibBlank[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const blanks: MadlibBlank[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;
    const index = record.index;
    const type = record.type;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 1) return null;
    if (typeof type !== "string" || !isMadlibBlankType(type)) return null;
    const hint = readString(record.hint) ?? undefined;
    blanks.push({ index, type, hint });
  }
  return blanks;
}

/** Parse + structurally validate LLM JSON into a draft template. */
export function parseGeneratedMadlib(
  raw: string,
  target: MadlibTarget,
): { draft: DraftMadlib | null; errors: string[] } {
  const parsed = parseJSONObjectFromText(raw);
  if (!parsed) return { draft: null, errors: ["not valid JSON"] };

  const title = readString(parsed.title);
  const text = readString(parsed.text);
  const blanks = readBlanks(parsed.blanks);

  if (!title) return { draft: null, errors: ["missing title"] };
  if (!text) return { draft: null, errors: ["missing text"] };
  if (!blanks) return { draft: null, errors: ["missing or malformed blanks[]"] };

  const errors = validateMadlibStructure(text, blanks);
  if (errors.length > 0) return { draft: null, errors };

  return {
    draft: { theme: target.theme, length: target.length, title, text, blanks },
    errors: [],
  };
}

export function buildMadlibJudgePrompt(draft: DraftMadlib): string {
  const blankLines = draft.blanks
    .map((b) => `${b.index}. ${b.type}${b.hint ? ` (hint: ${b.hint})` : ""}`)
    .join("\n");

  return `You are judging a mad lib story template for a family party game. Players supply a word for
each blank WITHOUT seeing the story, then it is read aloud. Blanks are written {N:type}.

Title: ${draft.title}
Text: ${draft.text}
Blanks:
${blankLines}

Judge what a structural check cannot:
1. Is this an actual story with a beginning and a turn, or filler around holes?
2. Would ANY reasonable word of that type work in each blank? A blank that needs one specific word is bad.
3. Anything crude, cruel, or sexual by implication — even if no single word is banned. Be strict; it's read aloud.
4. Is it actually funny / worth reading out loud?

Return ONLY this JSON (no other text):
{"verdict":"approve|hide|revise","reason":"one sentence"}

- approve: reads as a story, blanks are open, safe, and worth reading aloud
- hide: unsafe, incoherent, or a blank that cannot work
- revise: sound idea but flat prose or a weak blank placement worth regenerating`;
}

/**
 * Fast judge model (Ollama) — same approach and same fail-open policy as judgeQuestion:
 * a judge that is unreachable or returns garbage approves rather than blocking the pipeline.
 * WHY direct fetch, not runtime.useModel: we want a specific, different judge model.
 */
export async function judgeMadlib(
  draft: DraftMadlib,
  judgeModel: string,
  ollamaBaseUrl: string,
  debug: boolean,
): Promise<JudgeResult> {
  if (!judgeModel.trim()) {
    return { verdict: "approve", reason: "judge disabled", judgeOk: true };
  }

  const prompt = buildMadlibJudgePrompt(draft);

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
      return { verdict: "approve", reason: "judge unreachable", judgeOk: false };
    }

    const body = (await response.json()) as { message?: { content?: string } };
    const raw = body.message?.content ?? "";
    logDebug(debug, { judgeModel, rawPreview: previewText(raw, 200) }, "judge response");

    const parsed = parseJSONObjectFromText(raw);
    const verdict = parsed?.verdict;
    const reason = typeof parsed?.reason === "string" ? parsed.reason : "no reason given";

    if (verdict === "approve" || verdict === "hide" || verdict === "revise") {
      return { verdict, reason, judgeOk: true };
    }

    logger.warn(
      { judgeModel, verdictRaw: verdict, raw: previewText(raw, 200) },
      `${LOG_PREFIX} judge returned unrecognised verdict — approving`,
    );
    return { verdict: "approve", reason: "unrecognised verdict", judgeOk: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      { error: message, judgeModel },
      `${LOG_PREFIX} judge call failed — approving to avoid blocking`,
    );
    return { verdict: "approve", reason: `judge error: ${message}`, judgeOk: false };
  }
}

type MadlibListResponse = { madlibs?: Array<{ title?: string }> };

async function fetchExistingTitles(
  runtime: IAgentRuntime,
  target: MadlibTarget,
): Promise<string[]> {
  const query = new URLSearchParams({ theme: target.theme });
  const result = await rubyAdminFetch<MadlibListResponse>(
    runtime,
    "GET",
    `/api/admin/madlibs?${query.toString()}`,
  );
  // Route may not exist yet — an error here is expected and non-fatal; author without avoid-list.
  if (!result.ok) return [];
  return (result.data.madlibs ?? [])
    .slice(0, 6)
    .map((m) => m.title ?? "")
    .filter(Boolean);
}

async function generateDraft(
  runtime: IAgentRuntime,
  target: MadlibTarget,
  existingTitles: string[],
  debug: boolean,
): Promise<{ draft: DraftMadlib | null; errors: string[]; raw: string | null }> {
  const prompt = buildMadlibAuthoringPrompt({ target, existingTitles });
  logDebug(debug, { theme: target.theme, length: target.length }, "calling LLM");
  const raw = await runtime.useModel(ModelType.TEXT_SMALL, { prompt });
  if (typeof raw !== "string" || !raw.trim()) {
    logger.warn({ theme: target.theme }, `${LOG_PREFIX} LLM returned empty response`);
    return { draft: null, errors: ["empty LLM response"], raw: null };
  }
  logDebug(
    debug,
    { theme: target.theme, rawChars: raw.length, rawPreview: previewText(raw, DEBUG_RAW_CHARS) },
    "LLM response",
  );
  const { draft, errors } = parseGeneratedMadlib(raw, target);
  return { draft, errors, raw };
}

async function createDraft(
  runtime: IAgentRuntime,
  draft: DraftMadlib,
): Promise<{ ok: true; id: string } | { ok: false; message: string; status?: number }> {
  const result = await rubyAdminFetch<{ madlib: { id: string } }>(
    runtime,
    "POST",
    "/api/admin/madlibs",
    draft,
  );
  if (!result.ok) return { ok: false, message: result.message, status: result.status };
  return { ok: true, id: result.data.madlib.id };
}

/**
 * Run one authoring cycle — generate, judge, and POST mad-lib templates.
 * Skips quietly when the admin API or health is unavailable, exactly like question authoring.
 */
export async function runMadlibAuthoringCycle(
  runtime: IAgentRuntime,
  config: Pick<
    RubyTriviaConfig,
    "analyticsSecret" | "madlibsPerCycle" | "madlibAuthoringDebug" | "madlibJudgeModel"
  >,
): Promise<MadlibAuthoringCycleResult> {
  const debug = config.madlibAuthoringDebug;
  const judgeModel = config.madlibJudgeModel;
  const ollamaBaseUrl = (
    process.env.ZEROLLAMA_API_ENDPOINT ||
    process.env.OLLAMA_BASE_URL ||
    "http://localhost:11434"
  ).replace(/\/+$/, "");

  const result: MadlibAuthoringCycleResult = {
    attempted: 0,
    created: 0,
    skipped: 0,
    errors: [],
  };

  if (!config.analyticsSecret) {
    result.skipped += 1;
    result.errors.push("admin API not configured");
    logger.info({ reason: "missing analytics secret" }, `${LOG_PREFIX} cycle skipped`);
    return result;
  }

  const health = await rubyHealthFetch(runtime);
  if (!health.ok) {
    result.skipped += 1;
    result.errors.push("trivia backend unreachable");
    logger.warn({ reason: "health check failed" }, `${LOG_PREFIX} cycle skipped`);
    return result;
  }

  const themeIndex = loadMadlibThemeIndex(runtime);
  const { targets, nextThemeIndex } = pickMadlibTargets({
    count: config.madlibsPerCycle,
    themeIndex,
  });

  logger.info(
    {
      themeIndex,
      nextThemeIndex,
      targets,
      madlibsPerCycle: config.madlibsPerCycle,
      judgeModel: judgeModel || "(disabled)",
    },
    `${LOG_PREFIX} cycle starting`,
  );

  for (const target of targets) {
    result.attempted += 1;
    try {
      const existingTitles = await fetchExistingTitles(runtime, target);
      let { draft, errors, raw } = await generateDraft(runtime, target, existingTitles, debug);

      if (!draft) {
        logger.warn(
          { theme: target.theme, errors, rawPreview: raw ? previewText(raw, DEBUG_RAW_CHARS) : null },
          `${LOG_PREFIX} draft invalid — retrying LLM once`,
        );
        ({ draft, errors, raw } = await generateDraft(runtime, target, existingTitles, debug));
      }

      if (!draft) {
        const message = `failed to author a valid ${target.theme} mad lib: ${errors.join("; ")}`;
        result.errors.push(message);
        result.skipped += 1;
        logger.warn({ theme: target.theme, errors }, `${LOG_PREFIX} invalid after retry — skipping`);
        continue;
      }

      // --- Judge loop: approve → post, hide → drop, revise → regenerate up to N times ---
      let judgeVerdict: JudgeVerdict = "approve";
      let judgeAttempt = 0;
      const maxRevises = DEFAULT_JUDGE_DISTRACTOR_RETRIES;

      while (judgeAttempt <= maxRevises) {
        const judged = await judgeMadlib(draft, judgeModel, ollamaBaseUrl, debug);
        logger.info(
          {
            theme: target.theme,
            verdict: judged.verdict,
            reason: judged.reason,
            judgeOk: judged.judgeOk,
            judgeAttempt,
          },
          `${LOG_PREFIX} judge result`,
        );
        judgeVerdict = judged.verdict;

        if (judged.verdict === "approve" || judged.verdict === "hide") break;

        // revise — regenerate and re-judge
        if (judgeAttempt < maxRevises) {
          const next = await generateDraft(runtime, target, existingTitles, debug);
          if (next.draft) draft = next.draft;
        }
        judgeAttempt += 1;
      }

      if (judgeVerdict !== "approve") {
        result.skipped += 1;
        logger.warn(
          { theme: target.theme, verdict: judgeVerdict, titlePreview: previewText(draft.title) },
          `${LOG_PREFIX} judge did not approve — skipping`,
        );
        continue;
      }

      const created = await createDraft(runtime, draft);
      if (!created.ok) {
        if (created.status === 409) {
          result.skipped += 1;
          logger.info({ theme: target.theme }, `${LOG_PREFIX} duplicate — skipped (409)`);
          continue;
        }
        if (created.status === 422) {
          result.skipped += 1;
          logger.warn(
            { theme: target.theme, message: created.message },
            `${LOG_PREFIX} server audit gate rejected draft (422) — skipping`,
          );
          continue;
        }
        // 404 is expected until the /api/admin/madlibs route ships — surface it clearly.
        result.errors.push(created.message);
        logger.warn(
          { theme: target.theme, status: created.status, message: created.message },
          `${LOG_PREFIX} admin API rejected draft (route may not exist yet)`,
        );
        continue;
      }

      result.created += 1;
      logger.info(
        { id: created.id, theme: target.theme, titlePreview: previewText(draft.title) },
        `${LOG_PREFIX} created mad lib`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown authoring error";
      result.errors.push(message);
      logger.error({ error, theme: target.theme }, `${LOG_PREFIX} target failed`);
    }
  }

  saveMadlibThemeIndex(runtime, nextThemeIndex);
  logger.info(
    {
      attempted: result.attempted,
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
      nextThemeIndex,
    },
    `${LOG_PREFIX} cycle complete`,
  );
  return result;
}
