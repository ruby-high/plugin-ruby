/**
 * Daily Firecrawl → marketing points → pick one aspect for the day's bullposts.
 */
import type { IAgentRuntime } from "@elizaos/core";
import { logger, ModelType } from "@elizaos/core";
import { zerollamaChat } from "./zerollama-client.js";
import { firecrawlScrape } from "./firecrawl-client.js";
import {
  emptyCampaignState,
  loadBullpostCampaignState,
  needsDailyBriefRefresh,
  pickRandomAspect,
  saveBullpostCampaignState,
  utcDayKey,
  type BullpostCampaignState,
} from "./bullpost-campaign-state.js";

const LOG_PREFIX = "[BullpostDailyBrief]";

const FALLBACK_POINTS = [
  "Family-friendly trivia nights that bring generations together",
  "AI agent that grows the question bank from how the community plays",
  "Cross-play across Telegram, browser, TV, Fire TV, and Farcaster",
  "Large free question bank spanning many categories",
  "Daily quizzes, streaks, and friendly competition",
  "Community-built trivia — not just a token ticker",
  "$RUBY as the community token wrapping play and belonging",
];

function preview(text: string, max = 120): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Extract bullet marketing points from scraped markdown via LLM (JSON array). */
export function parseMarketingPointsJson(raw: string): string[] {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]?.trim()) text = fence[1].trim();

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) text = arrayMatch[0];

  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (typeof item === "string") return item.trim();
          if (item && typeof item === "object" && "point" in item) {
            const p = (item as { point?: unknown }).point;
            return typeof p === "string" ? p.trim() : "";
          }
          if (item && typeof item === "object" && "text" in item) {
            const p = (item as { text?: unknown }).text;
            return typeof p === "string" ? p.trim() : "";
          }
          return "";
        })
        .filter((p) => p.length >= 12 && p.length <= 240)
        .slice(0, 16);
    }
  } catch {
    // fall through to line parse
  }

  return text
    .split("\n")
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((p) => p.length >= 12 && p.length <= 240)
    .slice(0, 16);
}

export function buildMarketingPointsPrompt(markdown: string): string {
  const clipped =
    markdown.length > 12_000
      ? `${markdown.slice(0, 12_000)}\n\n[truncated]`
      : markdown;

  return `You are a marketing analyst for Ruby Trivia ($RUBY) — a family-friendly trivia game with a community token.

Read the website content below and extract 8–14 DISTINCT marketing points / angles a social team could riff on for a day.

RULES:
- Each point is one concrete angle (feature, vibe, proof, audience, platform, or differentiator).
- Short phrases or one sentence each (max ~160 chars).
- No URLs, no price/APY/investment promises, no "moon" talk.
- Do not invent stats that are not in the content; you may paraphrase soft claims that appear.
- Prefer variety: family, AI question growth, cross-play, categories, community, daily play, token-as-community — only if supported.

WEBSITE CONTENT:
---
${clipped}
---

OUTPUT: JSON array of strings only. Example: ["Family trivia nights across generations","AI grows the question bank with players"]`;
}

async function extractMarketingPoints(
  runtime: IAgentRuntime,
  markdown: string,
): Promise<string[]> {
  const prompt = buildMarketingPointsPrompt(markdown);

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
              project_name: "plugin-ruby-daily-brief",
            },
          },
        },
        "zerollama",
      );
      if (typeof raw === "string" && raw.trim()) {
        const points = parseMarketingPointsJson(raw);
        if (points.length >= 4) return points;
      }
    }
  } catch (error) {
    logger.warn({ error }, `${LOG_PREFIX} useModel extract failed`);
  }

  const chat = await zerollamaChat({
    model:
      process.env.RUBY_BULLPOST_MODEL ||
      process.env.ZEROLLAMA_LARGE_MODEL ||
      "eliza-1:9b",
    prompt,
    qosClass: "background",
    projectId: "eliza-ruby",
    projectName: "plugin-ruby-daily-brief",
    temperature: 0.4,
    timeoutMs: 120_000,
    format: "json",
  });
  if (chat.ok) {
    const points = parseMarketingPointsJson(chat.content);
    if (points.length >= 4) return points;
  }

  logger.warn(
    { error: chat.ok ? "too few points" : chat.error },
    `${LOG_PREFIX} falling back to static marketing points`,
  );
  return [...FALLBACK_POINTS];
}

export type EnsureDailyBriefOptions = {
  siteUrl: string;
  force?: boolean;
  maxAgeMs?: number;
};

/**
 * Ensure today's campaign has a Firecrawl brief + randomly selected aspect.
 * Returns the loaded/updated durable state.
 */
export async function ensureDailyBullpostBrief(
  runtime: IAgentRuntime,
  opts: EnsureDailyBriefOptions,
): Promise<BullpostCampaignState> {
  const today = utcDayKey();
  let state = loadBullpostCampaignState();

  if (
    !opts.force &&
    !needsDailyBriefRefresh(state, {
      siteUrl: opts.siteUrl,
      maxAgeMs: opts.maxAgeMs,
    })
  ) {
    return state;
  }

  logger.info(
    {
      dayKey: today,
      siteUrl: opts.siteUrl,
      previousDay: state.dayKey,
      force: Boolean(opts.force),
    },
    `${LOG_PREFIX} refreshing daily marketing brief via Firecrawl`,
  );

  const scrape = await firecrawlScrape(opts.siteUrl);
  let points: string[];
  let scrapedAt: string | null = null;

  if (scrape.ok) {
    scrapedAt = new Date().toISOString();
    points = await extractMarketingPoints(runtime, scrape.markdown);
    logger.info(
      {
        siteUrl: opts.siteUrl,
        markdownChars: scrape.markdown.length,
        pointCount: points.length,
        title: scrape.title,
      },
      `${LOG_PREFIX} extracted marketing points`,
    );
  } else {
    logger.warn(
      { error: scrape.error, siteUrl: opts.siteUrl },
      `${LOG_PREFIX} Firecrawl failed — using fallback points`,
    );
    points = [...FALLBACK_POINTS];
  }

  const pick = pickRandomAspect(points);
  const sameDay = state.dayKey === today;

  state = {
    ...emptyCampaignState(today, opts.siteUrl),
    scrapedAt,
    marketingPoints: points,
    selectedAspect: pick?.aspect ?? points[0] ?? null,
    selectedAspectIndex: pick?.index ?? (points.length ? 0 : null),
    // New day resets the tweet thread; same-day forced refresh keeps previous if aspect unchanged
    previousPost: sameDay && !opts.force ? state.previousPost : null,
    previousPostedAt: sameDay && !opts.force ? state.previousPostedAt : null,
    iteration: sameDay && !opts.force ? state.iteration : 0,
  };

  // Forced same-day refresh always resets thread around the new aspect
  if (opts.force) {
    state.previousPost = null;
    state.previousPostedAt = null;
    state.iteration = 0;
  }

  saveBullpostCampaignState(state);
  logger.info(
    {
      dayKey: state.dayKey,
      aspect: preview(state.selectedAspect ?? ""),
      aspectIndex: state.selectedAspectIndex,
      pointCount: state.marketingPoints.length,
    },
    `${LOG_PREFIX} selected marketing aspect for the day`,
  );
  return state;
}

export function recordBullpostIteration(
  postText: string,
  state?: BullpostCampaignState,
  judge?: { notes?: string | null; score?: number | null },
): BullpostCampaignState {
  const current = state ?? loadBullpostCampaignState();
  const next: BullpostCampaignState = {
    ...current,
    previousPost: postText.trim(),
    previousPostedAt: new Date().toISOString(),
    iteration: current.iteration + 1,
    lastJudgeNotes: judge?.notes?.trim() || current.lastJudgeNotes,
    lastJudgeScore:
      typeof judge?.score === "number" ? judge.score : current.lastJudgeScore,
  };
  saveBullpostCampaignState(next);
  return next;
}
