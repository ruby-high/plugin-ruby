import { describe, expect, it } from "vitest";
import {
  buildBullpostJudgePrompt,
  formatJudgeNotesForAuthor,
  parseBullpostJudgeResponse,
} from "./bullpost-judge.js";
import { buildBullpostPrompt } from "./bullpost-authoring.js";

describe("bullpost-judge", () => {
  it("builds a prompt that asks for feel + scores", () => {
    const prompt = buildBullpostJudgePrompt({
      draft: "Meet $RUBY 💎\n\nGather the family tonight.",
      dayAspect: "Cross-play on TV",
      previousPost: "Old draft about TV nights.",
    });
    expect(prompt).toContain("how the tweet FEELS");
    expect(prompt).toContain("Cross-play on TV");
    expect(prompt).toContain("Old draft");
    expect(prompt).toContain('"verdict"');
  });

  it("parses judge JSON and enforces revise below 7", () => {
    const result = parseBullpostJudgeResponse(
      JSON.stringify({
        verdict: "approve",
        score: 5,
        punch: 5,
        brand: 6,
        clarity: 5,
        uniqueness: 4,
        feel: "flat and generic",
        strengths: ["has $RUBY"],
        improvements: ["Sharper open", "More concrete image"],
        reason: "too soft",
      }),
    );
    expect(result.verdict).toBe("revise");
    expect(result.score).toBe(5);
    expect(result.improvements.length).toBe(2);
  });

  it("formats notes for the author", () => {
    const notes = formatJudgeNotesForAuthor({
      verdict: "revise",
      score: 6,
      punch: 6,
      brand: 7,
      clarity: 6,
      uniqueness: 5,
      feel: "friendly but soft",
      strengths: ["brand lead"],
      improvements: ["Add a concrete scene"],
      reason: "needs punch",
      judgeOk: true,
    });
    expect(notes).toContain("6/10");
    expect(notes).toContain("Add a concrete scene");
  });
});

describe("bullpost-authoring critique prompt", () => {
  it("includes judge notes and revise draft when provided", () => {
    const prompt = buildBullpostPrompt({
      theme: "family",
      examples: [{ id: "x", text: "Meet $RUBY 💎\n\nPlay with family tonight and laugh together." }],
      dayAspect: "Family trivia nights",
      previousPost: "Prior tweet body here with enough length.",
      iteration: 2,
      judgeNotes: "Improve:\n- Sharper open",
      reviseDraft: "Soft draft that needs work and more punch tonight.",
    });
    expect(prompt).toContain("EDITOR / JUDGE NOTES");
    expect(prompt).toContain("REVISE THIS DRAFT");
    expect(prompt).toContain("Sharper open");
  });
});
