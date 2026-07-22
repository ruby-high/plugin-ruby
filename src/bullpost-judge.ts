/**
 * Bullpost feel/quality judge — scores a draft and returns concrete revision notes.
 *
 * WHY a separate call: the authoring model is creative; a colder judge catches
 * flat cadence, buried brand, link-bait, and "same as last time" iterations so
 * the 30m cycle actually improves the day's thread.
 */
import { logger, parseJSONObjectFromText } from "@elizaos/core";
import { BULLPOST_STYLE_RULES } from "./bullposts.js";
import { resolveZerollamaApiBase, zerollamaChat } from "./zerollama-client.js";

const LOG_PREFIX = "[BullpostJudge]";

export type BullpostJudgeVerdict = "approve" | "revise";

export type BullpostJudgeResult = {
  verdict: BullpostJudgeVerdict;
  /** Overall 1–10 feel/quality. */
  score: number;
  punch: number;
  brand: number;
  clarity: number;
  uniqueness: number;
  /** Would someone RT/share this? 1–10. */
  shareability: number;
  /** One-sentence vibe read ("feels like…"). */
  feel: string;
  /** Name the hook pattern if present (challenge, surprise, tease, …). */
  hook: string;
  strengths: string[];
  improvements: string[];
  reason: string;
  judgeOk: boolean;
};

export function resolveBullpostJudgeModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.RUBY_BULLPOST_JUDGE_MODEL ||
    env.RUBY_QUESTION_JUDGE_MODEL ||
    env.ZEROLLAMA_LARGE_MODEL ||
    "eliza-1:9b"
  );
}

function clampScore(value: unknown, fallback = 5): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function buildBullpostJudgePrompt(opts: {
  draft: string;
  dayAspect?: string | null;
  previousPost?: string | null;
}): string {
  const rules = BULLPOST_STYLE_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");
  const aspect = opts.dayAspect?.trim() || "(none)";
  const previous = opts.previousPost?.trim();

  return `You are a tough but fair social editor judging a $RUBY / Ruby Trivia bullpost for X (Twitter).

STYLE RULES THE DRAFT MUST RESPECT:
${rules}

TODAY'S MARKETING POINT (must stay on this):
${aspect}

${
  previous
    ? `PREVIOUS SUGGESTED TWEET (this draft should iterate/improve — not clone):
---
${previous}
---
`
    : "This is the first draft of the day for this marketing point.\n"
}

DRAFT TO JUDGE:
---
${opts.draft.trim()}
---

Assess how the tweet FEELS (energy, cadence, brand heat, scroll-stop power) and whether it truly improves on the previous one when present.

SHARE / RT LENS (critical):
- Is there a clear HOOK in the first line (challenge, surprise, tease, stakes, tag-a-friend)?
- Would a normal person want to RT/share or reply — or is it brand wallpaper?
- If trivia is included: does it elevate the hook, or is it a forced quiz dump?

Return ONLY JSON:
{
  "verdict": "approve" | "revise",
  "score": 1-10,
  "punch": 1-10,
  "brand": 1-10,
  "clarity": 1-10,
  "uniqueness": 1-10,
  "shareability": 1-10,
  "hook": "challenge|surprise|tease|stakes|tag-friend|none|other short label",
  "feel": "one sentence vibe read",
  "strengths": ["short", "bullets"],
  "improvements": ["concrete revision notes the writer must apply"],
  "reason": "one sentence overall"
}

Scoring guide:
- 9–10: scroll-stopping, RT-worthy hook, on-brand, tight, clearly better than previous (if any)
- 7–8: solid, shippable with minor polish; clear hook someone might share
- 5–6: flat / generic / buried brand / weak share impulse — revise
- 1–4: off-voice, off-topic, linkbait, financial hype, near-duplicate, or quiz dump — revise

verdict=approve only if score >= 7 AND shareability >= 6 AND improvements are empty or trivial.
verdict=revise if score < 7 OR shareability < 6 OR uniqueness is weak vs previous OR brand/punch/clarity is weak.
Never invent URLs. Never suggest price/APY/moon language.`;
}

export function parseBullpostJudgeResponse(raw: string): BullpostJudgeResult {
  const parsed = parseJSONObjectFromText(raw) as Record<string, unknown> | null;
  if (!parsed) {
    return {
      verdict: "approve",
      score: 5,
      punch: 5,
      brand: 5,
      clarity: 5,
      uniqueness: 5,
      shareability: 5,
      feel: "unparseable judge output",
      hook: "none",
      strengths: [],
      improvements: ["Tighten punch and lead with $RUBY."],
      reason: "unparseable judge output",
      judgeOk: false,
    };
  }

  const score = clampScore(parsed.score);
  const punch = clampScore(parsed.punch, score);
  const brand = clampScore(parsed.brand, score);
  const clarity = clampScore(parsed.clarity, score);
  const uniqueness = clampScore(parsed.uniqueness, score);
  const shareability = clampScore(parsed.shareability, score);
  const hook =
    typeof parsed.hook === "string" && parsed.hook.trim()
      ? parsed.hook.trim()
      : "none";
  const improvements = asStringArray(parsed.improvements);
  const strengths = asStringArray(parsed.strengths);
  const feel =
    typeof parsed.feel === "string" && parsed.feel.trim()
      ? parsed.feel.trim()
      : "no feel given";
  const reason =
    typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : "no reason given";

  let verdict: BullpostJudgeVerdict =
    parsed.verdict === "revise" || parsed.verdict === "approve"
      ? parsed.verdict
      : score >= 7
        ? "approve"
        : "revise";

  // Enforce rubric even if the model is soft on verdict.
  if (score < 7 || shareability < 6 || improvements.length >= 2) {
    verdict = "revise";
  }
  if (score >= 8 && improvements.length === 0) {
    verdict = "approve";
  }

  return {
    verdict,
    score,
    punch,
    brand,
    clarity,
    uniqueness,
    shareability,
    feel,
    hook,
    strengths,
    improvements,
    reason,
    judgeOk: true,
  };
}

/** Compact notes for the next authoring prompt / campaign state. */
export function formatJudgeNotesForAuthor(judge: BullpostJudgeResult): string {
  const lines = [
    `Judge score ${judge.score}/10 (${judge.verdict}) — feel: ${judge.feel}`,
    `Shareability ${judge.shareability}/10 · hook: ${judge.hook}`,
    judge.reason ? `Reason: ${judge.reason}` : "",
    judge.strengths.length
      ? `Keep: ${judge.strengths.join("; ")}`
      : "",
    judge.improvements.length
      ? `Improve:\n${judge.improvements.map((i) => `- ${i}`).join("\n")}`
      : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export async function judgeBullpost(opts: {
  draft: string;
  dayAspect?: string | null;
  previousPost?: string | null;
  judgeModel?: string;
  debug?: boolean;
}): Promise<BullpostJudgeResult> {
  const model = opts.judgeModel || resolveBullpostJudgeModel();
  if (!model.trim()) {
    return {
      verdict: "approve",
      score: 7,
      punch: 7,
      brand: 7,
      clarity: 7,
      uniqueness: 7,
      shareability: 7,
      feel: "judge disabled",
      hook: "n/a",
      strengths: [],
      improvements: [],
      reason: "judge disabled",
      judgeOk: true,
    };
  }

  const prompt = buildBullpostJudgePrompt({
    draft: opts.draft,
    dayAspect: opts.dayAspect,
    previousPost: opts.previousPost,
  });

  const chat = await zerollamaChat({
    model,
    prompt,
    qosClass: "background",
    projectId: "eliza-ruby",
    projectName: "plugin-ruby-bullpost-judge",
    temperature: 0.1,
    timeoutMs: 90_000,
    format: "json",
  });

  if (!chat.ok) {
    logger.warn(
      { error: chat.error, model, apiBase: resolveZerollamaApiBase() },
      `${LOG_PREFIX} judge failed — soft-approving draft`,
    );
    return {
      verdict: "approve",
      score: 6,
      punch: 6,
      brand: 6,
      clarity: 6,
      uniqueness: 6,
      shareability: 6,
      feel: "judge unreachable",
      hook: "unknown",
      strengths: [],
      improvements: [],
      reason: chat.error,
      judgeOk: false,
    };
  }

  const result = parseBullpostJudgeResponse(chat.content);
  if (opts.debug) {
    logger.info(
      {
        model,
        verdict: result.verdict,
        score: result.score,
        shareability: result.shareability,
        hook: result.hook,
        feel: result.feel,
        improvements: result.improvements,
      },
      `${LOG_PREFIX} verdict`,
    );
  } else {
    logger.info(
      {
        model,
        verdict: result.verdict,
        score: result.score,
        shareability: result.shareability,
        hook: result.hook,
        feel: result.feel,
      },
      `${LOG_PREFIX} verdict`,
    );
  }
  return result;
}
