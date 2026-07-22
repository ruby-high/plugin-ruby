import { describe, expect, it } from "vitest";
import {
  buildBullpostPrompt,
  cleanGeneratedBullpost,
  formatBullpostDiscordMessage,
} from "./bullpost-authoring.js";
import {
  needsDailyBriefRefresh,
  pickRandomAspect,
  utcDayKey,
  emptyCampaignState,
} from "./bullpost-campaign-state.js";
import { parseMarketingPointsJson } from "./bullpost-daily-brief.js";

describe("bullpost-authoring", () => {
  it("builds a prompt that includes examples and style rules", () => {
    const prompt = buildBullpostPrompt({
      theme: "family",
      examples: [
        { id: "meet-ruby", text: "Meet $RUBY 💎\n\nGather the family." },
      ],
    });
    expect(prompt).toContain("Voice lane");
    expect(prompt).toContain("EXAMPLE 1");
    expect(prompt).toContain("Meet $RUBY");
    expect(prompt).toContain("Zero URLs");
  });

  it("includes day aspect and previous tweet for iteration", () => {
    const prompt = buildBullpostPrompt({
      theme: "any",
      examples: [{ id: "x", text: "Meet $RUBY 💎\n\nPlay with family tonight and laugh together." }],
      dayAspect: "Cross-play on TV and Telegram",
      previousPost: "RUBY brings trivia to your living room. 💎",
      iteration: 2,
    });
    expect(prompt).toContain("TODAY'S SELECTED MARKETING POINT");
    expect(prompt).toContain("Cross-play on TV and Telegram");
    expect(prompt).toContain("PREVIOUS SUGGESTED TWEET");
    expect(prompt).toContain("living room");
    expect(prompt).toContain("ITERATION GOAL");
  });

  it("cleans fenced / JSON / preamble LLM output", () => {
    expect(
      cleanGeneratedBullpost(
        "```\nMeet $RUBY 💎\n\nGather the family and play together tonight.\n```",
      ),
    ).toContain("Meet $RUBY");
    expect(
      cleanGeneratedBullpost(
        'Here is a draft:\n{"text":"RUBY tests your mind. 🧠\\n\\nGather your team and prove who knows the most."}',
      ),
    ).toContain("RUBY tests your mind");
    expect(cleanGeneratedBullpost("short")).toBeNull();
    expect(
      cleanGeneratedBullpost(
        "Buy $RUBY for guaranteed returns and 100x moonshot APY 💎 and more filler text here.",
      ),
    ).toBeNull();
  });

  it("formats Discord suggestion wrapper with day focus", () => {
    const msg = formatBullpostDiscordMessage("Meet $RUBY 💎\n\nPlay tonight.", {
      dayAspect: "Family trivia nights",
      iteration: 3,
    });
    expect(msg).toContain("bullpost suggestion");
    expect(msg).toContain("day focus");
    expect(msg).toContain("#3");
    expect(msg).toContain("Meet $RUBY");
  });
});

describe("bullpost-campaign-state", () => {
  it("picks a random aspect", () => {
    const pick = pickRandomAspect(["a".repeat(12), "b".repeat(12)], () => 0.9);
    expect(pick?.index).toBe(1);
  });

  it("needs refresh on new day or empty aspect", () => {
    const today = utcDayKey();
    const fresh = {
      ...emptyCampaignState(today, "https://ruby-trivia.com"),
      scrapedAt: new Date().toISOString(),
      marketingPoints: ["Family nights together today"],
      selectedAspect: "Family nights together today",
      selectedAspectIndex: 0,
    };
    expect(needsDailyBriefRefresh(fresh)).toBe(false);
    expect(
      needsDailyBriefRefresh({ ...fresh, dayKey: "2000-01-01" }),
    ).toBe(true);
    expect(
      needsDailyBriefRefresh({ ...fresh, selectedAspect: null }),
    ).toBe(true);
  });
});

describe("bullpost-daily-brief", () => {
  it("parses marketing points JSON", () => {
    const points = parseMarketingPointsJson(
      '```json\n["Family trivia across generations","AI grows the question bank with players","Cross-play on TV and Telegram"]\n```',
    );
    expect(points.length).toBe(3);
    expect(points[0]).toContain("Family trivia");
  });
});
