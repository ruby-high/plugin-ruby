import { describe, expect, it } from "vitest";
import {
  categoriesForAspect,
  formatTriviaSnacksForPrompt,
} from "./bullpost-trivia.js";
import { buildBullpostPrompt } from "./bullpost-authoring.js";
import { buildBullpostJudgePrompt, parseBullpostJudgeResponse } from "./bullpost-judge.js";

describe("bullpost-trivia", () => {
  it("maps aspect keywords to categories", () => {
    expect(categoriesForAspect("Cross-play science nights").join(",")).toMatch(
      /science|nature/i,
    );
  });

  it("formats snacks with optional-use rules", () => {
    const block = formatTriviaSnacksForPrompt([
      {
        id: "q1",
        category: "science",
        difficulty: "easy",
        question: "What planet is known as the Red Planet?",
        answer: "Mars",
      },
    ]);
    expect(block).toContain("REAL TRIVIA");
    expect(block).toContain("Mars");
    expect(block).toContain("optional");
  });
});

describe("bullpost share + trivia prompts", () => {
  it("author prompt includes RT considerations and snacks", () => {
    const prompt = buildBullpostPrompt({
      theme: "family",
      examples: [
        {
          id: "x",
          text: "Meet $RUBY 💎\n\nGather the family tonight and play together.",
        },
      ],
      dayAspect: "Family trivia nights",
      triviaSnacks: [
        {
          id: "q1",
          category: "science",
          difficulty: "easy",
          question: "What planet is known as the Red Planet?",
          answer: "Mars",
        },
      ],
    });
    expect(prompt).toContain("SHARE / RT CONSIDERATIONS");
    expect(prompt).toContain("Red Planet");
    expect(prompt).toContain("optional");
  });

  it("judge prompt asks about shareability and hooks", () => {
    const prompt = buildBullpostJudgePrompt({
      draft: "Meet $RUBY 💎",
      dayAspect: "Family nights",
    });
    expect(prompt).toContain("SHARE / RT LENS");
    expect(prompt).toContain("shareability");
  });

  it("parses shareability and forces revise when low", () => {
    const result = parseBullpostJudgeResponse(
      JSON.stringify({
        verdict: "approve",
        score: 8,
        punch: 8,
        brand: 8,
        clarity: 8,
        uniqueness: 8,
        shareability: 4,
        hook: "none",
        feel: "pretty but forgettable",
        strengths: ["brand"],
        improvements: ["Add a challenge hook"],
        reason: "won't get RTs",
      }),
    );
    expect(result.shareability).toBe(4);
    expect(result.verdict).toBe("revise");
  });
});
