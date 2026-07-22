/**
 * LLM bullpost authoring — few-shot from the marketing bank, then invent a new post.
 *
 * Daily flow:
 * 1) Firecrawl the marketing site every 24h → marketing points → pick one aspect for the day
 * 2) Every 30m Discord suggestion iterates on that aspect, using the previous suggestion as context
 *
 * WHY not only rotate the bank: operators want fresh copy every cycle; the bank is
 * the voice gold-standard, not a finite playlist.
 */
import type { IAgentRuntime } from "@elizaos/core";
import { logger, ModelType } from "@elizaos/core";
import { zerollamaChat } from "./zerollama-client.js";
import {
  sendBullpostSuggestionMessage,
} from "./bullpost-discord.js";
import {
  isBullpostFingerprintLocked,
  fingerprintBullpostText,
  registerPendingBullpostTweet,
} from "./bullpost-tweet-store.js";
import { attachDiscordMessageToTweetRecord } from "./bullpost-tweet-handler.js";
import {
  formatJudgeNotesForAuthor,
  judgeBullpost,
  type BullpostJudgeResult,
} from "./bullpost-judge.js";
import {
  fetchTriviaSnacksForBullpost,
  formatTriviaSnacksForPrompt,
  type TriviaSnack,
} from "./bullpost-trivia.js";
import {
  BULLPOST_BANK,
  BULLPOST_STYLE_RULES,
  BULLPOST_THEMES,
  normalizeBullpostTheme,
  suggestBullposts,
  type BullpostTheme,
} from "./bullposts.js";
import type { RubyTriviaConfig } from "./config.js";
import {
  ensureDailyBullpostBrief,
  recordBullpostIteration,
} from "./bullpost-daily-brief.js";
import type { BullpostCampaignState } from "./bullpost-campaign-state.js";

const LOG_PREFIX = "[BullpostAuthoring]";

export type GeneratedBullpost = {
  text: string;
  theme: BullpostTheme;
  exampleIds: string[];
  dayAspect: string | null;
  iteration: number;
  judge: BullpostJudgeResult | null;
  judgeNotes: string | null;
  draftAttempts: number;
};

function previewText(text: string, max = 160): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

/** Strip model chatter / fences; keep the post body. */
export function cleanGeneratedBullpost(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;

  text = text.replace(/^(here(?:'s| is).*?:\s*)/i, "");
  text = text.replace(/^bullpost\s*\d*\s*[:.-]\s*/i, "");

  const fence = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fence?.[1]?.trim()) {
    text = fence[1].trim();
  }

  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { text?: unknown; post?: unknown };
      const candidate = parsed.text ?? parsed.post;
      if (typeof candidate === "string" && candidate.trim()) {
        text = candidate.trim();
      }
    } catch {
      // keep as-is
    }
  }

  text = text
    .replace(/\u2013/g, "—")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length < 40) return null;
  if (text.length > 1200) {
    text = `${text.slice(0, 1190).trim()}…`;
  }

  if (/\b(apy|guaranteed\s+returns?|moon(?:shot)?|100x)\b/i.test(text)) {
    return null;
  }

  return text;
}

export function buildBullpostPrompt(opts: {
  theme: BullpostTheme;
  examples: Array<{ id: string; text: string }>;
  dayAspect?: string | null;
  previousPost?: string | null;
  iteration?: number;
  /** Critique from the previous cycle's judge (or this cycle's revise pass). */
  judgeNotes?: string | null;
  /** When set, this is a forced revision pass against a specific draft. */
  reviseDraft?: string | null;
  /** Optional real bank trivia the writer may weave in. */
  triviaSnacks?: TriviaSnack[];
}): string {
  const themeLine =
    opts.theme === "any"
      ? "Voice lane (optional color): any on-brand angle."
      : `Voice lane (optional color): ${opts.theme}.`;

  const exampleBlock = opts.examples
    .map((ex, i) => `EXAMPLE ${i + 1} (id=${ex.id}):\n${ex.text.trim()}`)
    .join("\n\n");

  const rules = BULLPOST_STYLE_RULES.map((rule, i) => `${i + 1}. ${rule}`).join(
    "\n",
  );

  const aspect = opts.dayAspect?.trim();
  const previous = opts.previousPost?.trim();
  const iteration = opts.iteration ?? 0;

  const judgeNotes = opts.judgeNotes?.trim();
  const reviseDraft = opts.reviseDraft?.trim();

  const critiqueBlock = judgeNotes
    ? `EDITOR / JUDGE NOTES (obey these — this is how you improve):
${judgeNotes}
`
    : "";

  const reviseBlock = reviseDraft
    ? `REVISE THIS DRAFT (do not start from scratch — lift what works, fix the judge notes):
---
${reviseDraft}
---
`
    : "";

  const dayBlock = aspect
    ? `TODAY'S SELECTED MARKETING POINT (stay on this — do not switch topics):
${aspect}

${
  previous
    ? `PREVIOUS SUGGESTED TWEET (iteration ${iteration} — improve / iterate, do not repeat verbatim):
---
${previous}
---

ITERATION GOAL:
- Keep the same core marketing point.
- Feel sharper than the previous tweet — more punch, clearer brand lead, fresher beat.
- Not a clone with swapped adjectives.`
    : `This is the FIRST suggestion of the day for this marketing point. Establish it clearly and memorably.`
}

${critiqueBlock}${reviseBlock}`
    : `No daily website aspect loaded — invent a strong on-brand $RUBY post from the examples.

${critiqueBlock}${reviseBlock}`;

  const triviaBlock = formatTriviaSnacksForPrompt(opts.triviaSnacks ?? []);

  const shareBlock = `SHARE / RT CONSIDERATIONS (write for the timeline, not a brochure):
- First line must hook: challenge, surprising beat, fill-in tease, stakes, or "tag someone who…" energy.
- Ask yourself: why would someone RT or share this with a friend/family member?
- Prefer one vivid beat over three soft claims.
- A reply-bait closer is good when it fits (parents vs kids, "wrong answers only", "drop your guess").
- Still zero links. Still no price/APY/moon talk.`;

  return `You write $RUBY bullposts for Ruby Trivia — a family-friendly trivia game with a community token.

STYLE RULES:
${rules}

${themeLine}

${shareBlock}

${dayBlock}

${triviaBlock}

Study these gold-standard examples. Match their cadence, energy, and structure — but write a NEW original post. Do not copy sentences verbatim.

${exampleBlock}

OUTPUT RULES:
- Return ONLY the post text ready to paste.
- No title line, no markdown fences, no "here's a draft".
- Include $RUBY or RUBY and at least one 💎 when it fits naturally.
- 3–8 short lines/paragraphs. Em dashes (—) not en-dashes.
- Zero URLs/links. No price, APY, or investment promises.
- Optimize for RT/share: clear hook + one reason to pass it along.
- Trivia from the bank is optional — include at most one snack, and only if it sharpens the hook.
- This is about the RUBY trivia game / $RUBY community token — NOT the Ruby programming language.`;
}

function resolveBullpostModel(): string {
  // Drafting is the main consumer — prefer LARGE (eliza-1:9b) over SMALL/2b.
  return (
    process.env.RUBY_BULLPOST_MODEL ||
    process.env.ZEROLLAMA_LARGE_MODEL ||
    process.env.OLLAMA_LARGE_MODEL ||
    "eliza-1:9b"
  );
}

async function callBullpostLlm(
  runtime: IAgentRuntime,
  prompt: string,
  debug: boolean,
): Promise<string | null> {
  const model = resolveBullpostModel();

  try {
    if (typeof runtime.useModel === "function") {
      const raw = await runtime.useModel(
        ModelType.TEXT_LARGE,
        {
          prompt,
          providerOptions: {
            zerollama: {
              qos_class: "background",
              project_id: "eliza-ruby",
              project_name: "plugin-ruby-bullpost",
            },
          },
        },
        "zerollama",
      );
      if (typeof raw === "string" && raw.trim()) {
        if (debug) {
          logger.info(
            { model, chars: raw.length, path: "useModel+providerOptions.zerollama" },
            `${LOG_PREFIX} draft ok`,
          );
        }
        return raw;
      }
    }
  } catch (error) {
    logger.warn(
      { error },
      `${LOG_PREFIX} useModel failed — trying direct zerollama chat`,
    );
  }

  const chat = await zerollamaChat({
    model,
    prompt,
    qosClass: "background",
    projectId: "eliza-ruby",
    projectName: "plugin-ruby-bullpost",
    temperature: 0.85,
    timeoutMs: 120_000,
  });
  if (chat.ok) {
    if (debug) {
      logger.info(
        { model, enhanced: chat.enhanced, chars: chat.content.length },
        `${LOG_PREFIX} zerollama chat ok`,
      );
    }
    return chat.content;
  }
  logger.warn(
    { model, error: chat.error },
    `${LOG_PREFIX} zerollama chat failed`,
  );
  return null;
}

export async function generateBullpostWithLlm(
  runtime: IAgentRuntime,
  options: {
    theme?: string | null;
    exampleCount?: number;
    debug?: boolean;
    dayAspect?: string | null;
    previousPost?: string | null;
    iteration?: number;
    previousJudgeNotes?: string | null;
    /** Max authoring attempts including the first draft (default 2 = draft + one revise). */
    maxAttempts?: number;
  } = {},
): Promise<GeneratedBullpost | null> {
  const theme = normalizeBullpostTheme(options.theme);
  const examples = suggestBullposts({
    count: options.exampleCount ?? 3,
    theme: theme === "any" ? "any" : theme,
  });

  if (examples.length === 0) {
    logger.warn(`${LOG_PREFIX} bullpost bank empty`);
    return null;
  }

  const maxAttempts = Math.max(1, Math.min(3, options.maxAttempts ?? 2));
  const exampleIds = examples.map((ex) => ex.id);
  const mappedExamples = examples.map((ex) => ({ id: ex.id, text: ex.text }));

  let triviaSnacks: TriviaSnack[] = [];
  try {
    triviaSnacks = await fetchTriviaSnacksForBullpost(runtime, {
      dayAspect: options.dayAspect,
      count: 4,
    });
  } catch (error) {
    logger.warn({ error }, `${LOG_PREFIX} trivia snack fetch failed — drafting without`);
  }

  let best: {
    text: string;
    judge: BullpostJudgeResult | null;
    notes: string | null;
  } | null = null;
  let attempts = 0;
  let reviseDraft: string | null = null;
  let judgeNotesForPrompt = options.previousJudgeNotes ?? null;

  while (attempts < maxAttempts) {
    attempts += 1;
    const prompt = buildBullpostPrompt({
      theme,
      examples: mappedExamples,
      dayAspect: options.dayAspect,
      previousPost: options.previousPost,
      iteration: options.iteration,
      judgeNotes: judgeNotesForPrompt,
      reviseDraft,
      triviaSnacks,
    });

    if (options.debug) {
      logger.info(
        {
          theme,
          exampleIds,
          attempt: attempts,
          dayAspect: options.dayAspect
            ? previewText(options.dayAspect, 80)
            : null,
          hasPrevious: Boolean(options.previousPost),
          hasCritique: Boolean(judgeNotesForPrompt),
          revising: Boolean(reviseDraft),
        },
        `${LOG_PREFIX} calling LLM`,
      );
    }

    const raw = await callBullpostLlm(runtime, prompt, options.debug === true);
    if (!raw) {
      logger.warn(
        { attempt: attempts },
        `${LOG_PREFIX} LLM returned empty response`,
      );
      break;
    }

    const text = cleanGeneratedBullpost(raw);
    if (!text) {
      logger.warn(
        { attempt: attempts, rawPreview: previewText(String(raw)) },
        `${LOG_PREFIX} LLM output rejected after clean`,
      );
      continue;
    }

    // Near-duplicate of previous → force another revise if we have budget.
    if (
      options.previousPost &&
      text.replace(/\s+/g, " ").toLowerCase() ===
        options.previousPost.replace(/\s+/g, " ").toLowerCase()
    ) {
      logger.warn(
        { attempt: attempts },
        `${LOG_PREFIX} draft cloned previous — forcing revise`,
      );
      reviseDraft = text;
      judgeNotesForPrompt =
        "Draft was too similar to the previous tweet. Change structure, opening hook, and concrete image while staying on the marketing point.";
      continue;
    }

    const judge = await judgeBullpost({
      draft: text,
      dayAspect: options.dayAspect,
      previousPost: options.previousPost,
      debug: options.debug,
    });
    const notes = formatJudgeNotesForAuthor(judge);

    logger.info(
      {
        attempt: attempts,
        verdict: judge.verdict,
        score: judge.score,
        feel: judge.feel,
        preview: previewText(text),
      },
      `${LOG_PREFIX} judged draft`,
    );

    if (!best || judge.score > (best.judge?.score ?? 0)) {
      best = { text, judge, notes };
    }

    if (judge.verdict === "approve" && judge.score >= 7) {
      break;
    }

    // Revise pass: feed this draft + critique back in.
    reviseDraft = text;
    judgeNotesForPrompt = notes;
  }

  if (!best) {
    return null;
  }

  return {
    text: best.text,
    theme,
    exampleIds,
    dayAspect: options.dayAspect?.trim() || null,
    iteration: (options.iteration ?? 0) + 1,
    judge: best.judge,
    judgeNotes: best.notes,
    draftAttempts: attempts,
  };
}

export function formatBullpostDiscordMessage(
  text: string,
  meta?: {
    dayAspect?: string | null;
    iteration?: number;
    judgeScore?: number | null;
    judgeFeel?: string | null;
  },
): string {
  const aspect = meta?.dayAspect?.trim();
  const iteration = meta?.iteration;
  const score =
    typeof meta?.judgeScore === "number" ? ` · judge ${meta.judgeScore}/10` : "";
  const feel = meta?.judgeFeel?.trim()
    ? `\n_${previewText(meta.judgeFeel, 120)}_`
    : "";
  const header =
    aspect && iteration
      ? `💎 $RUBY bullpost suggestion · day focus · #${iteration}${score}\n_${previewText(aspect, 100)}_${feel}\n\n`
      : aspect
        ? `💎 $RUBY bullpost suggestion · day focus${score}\n_${previewText(aspect, 100)}_${feel}\n\n`
        : `💎 $RUBY bullpost suggestion${score}\n\n`;
  return `${header}${text.trim()}`;
}

export type BullpostCycleResult = {
  generated: boolean;
  posted: boolean;
  theme: BullpostTheme;
  dayAspect: string | null;
  iteration: number;
  preview: string | null;
  error: string | null;
};

/**
 * One scheduled cycle: ensure daily brief → LLM draft (iterate) → Discord.
 */
export async function runBullpostCycle(
  runtime: IAgentRuntime,
  config: Pick<
    RubyTriviaConfig,
    | "bullpostEnabled"
    | "discordChannelId"
    | "discordAnnounceEnabled"
    | "bullpostDebug"
    | "bullpostSiteUrl"
  >,
  options: { theme?: string | null } = {},
): Promise<BullpostCycleResult> {
  const theme: BullpostTheme =
    options.theme != null
      ? normalizeBullpostTheme(options.theme)
      : BULLPOST_THEMES[Math.floor(Math.random() * BULLPOST_THEMES.length)]!;

  if (!config.bullpostEnabled) {
    return {
      generated: false,
      posted: false,
      theme,
      dayAspect: null,
      iteration: 0,
      preview: null,
      error: "bullpost disabled",
    };
  }
  if (!config.discordChannelId || !config.discordAnnounceEnabled) {
    return {
      generated: false,
      posted: false,
      theme,
      dayAspect: null,
      iteration: 0,
      preview: null,
      error: "discord announce unavailable",
    };
  }

  let campaign: BullpostCampaignState;
  try {
    campaign = await ensureDailyBullpostBrief(runtime, {
      siteUrl: config.bullpostSiteUrl,
    });
  } catch (error) {
    logger.error({ error }, `${LOG_PREFIX} daily brief failed`);
    campaign = {
      dayKey: "",
      siteUrl: config.bullpostSiteUrl,
      scrapedAt: null,
      marketingPoints: [],
      selectedAspect: null,
      selectedAspectIndex: null,
      previousPost: null,
      previousPostedAt: null,
      iteration: 0,
      lastJudgeNotes: null,
      lastJudgeScore: null,
    };
  }

  const generated = await generateBullpostWithLlm(runtime, {
    theme,
    debug: config.bullpostDebug,
    dayAspect: campaign.selectedAspect,
    previousPost: campaign.previousPost,
    iteration: campaign.iteration,
    previousJudgeNotes: campaign.lastJudgeNotes,
  });
  if (!generated) {
    return {
      generated: false,
      posted: false,
      theme,
      dayAspect: campaign.selectedAspect,
      iteration: campaign.iteration,
      preview: null,
      error: "generation failed",
    };
  }

  const message = formatBullpostDiscordMessage(generated.text, {
    dayAspect: generated.dayAspect,
    iteration: generated.iteration,
    judgeScore: generated.judge?.score ?? null,
    judgeFeel: generated.judge?.feel ?? null,
  });

  // Skip generating a Discord suggestion if this exact copy was already tweeted.
  const fp = fingerprintBullpostText(generated.text);
  if (isBullpostFingerprintLocked(fp)) {
    logger.info(
      { fingerprint: fp, preview: previewText(generated.text) },
      `${LOG_PREFIX} skipping — fingerprint already tweet-locked`,
    );
    return {
      generated: true,
      posted: false,
      theme: generated.theme,
      dayAspect: generated.dayAspect,
      iteration: generated.iteration,
      preview: previewText(generated.text),
      error: "tweet fingerprint locked",
    };
  }

  const pending = registerPendingBullpostTweet({
    text: generated.text,
    discordChannelId: config.discordChannelId,
  });
  const sent = await sendBullpostSuggestionMessage(runtime, {
    bodyText: message,
    tweetRecord: pending,
  });
  if (sent.ok) {
    attachDiscordMessageToTweetRecord(
      pending.id,
      sent.messageId,
      sent.channelId,
    );
    recordBullpostIteration(generated.text, campaign, {
      notes: generated.judgeNotes,
      score: generated.judge?.score ?? null,
    });
  }
  const posted = sent.ok;

  logger.info(
    {
      theme: generated.theme,
      posted,
      dayAspect: generated.dayAspect
        ? previewText(generated.dayAspect, 80)
        : null,
      iteration: generated.iteration,
      draftAttempts: generated.draftAttempts,
      judgeScore: generated.judge?.score ?? null,
      judgeVerdict: generated.judge?.verdict ?? null,
      exampleIds: generated.exampleIds,
      preview: previewText(generated.text),
    },
    `${LOG_PREFIX} cycle complete`,
  );

  return {
    generated: true,
    posted,
    theme: generated.theme,
    dayAspect: generated.dayAspect,
    iteration: generated.iteration,
    preview: previewText(generated.text),
    error: posted ? null : "discord send failed",
  };
}

/** Expose bank size for logging/tests. */
export function bullpostBankSize(): number {
  return BULLPOST_BANK.length;
}
