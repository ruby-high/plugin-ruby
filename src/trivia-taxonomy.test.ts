import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_TRIGGERS,
  formatQuestionTaxonomyGuide,
  TRIVIA_CATEGORIES,
  TRIVIA_DIFFICULTIES,
  TRIVIA_LANGUAGES,
} from "./trivia-taxonomy.js";

describe("trivia-taxonomy", () => {
  it("matches server category and difficulty counts", () => {
    expect(TRIVIA_CATEGORIES).toHaveLength(14);
    expect(TRIVIA_DIFFICULTIES).toEqual(["easy", "medium", "hard", "expert"]);
    expect(TRIVIA_LANGUAGES).toContain("en");
    expect(TRIVIA_LANGUAGES).toContain("fr");
    expect(ACHIEVEMENT_TRIGGERS).toContain("manual");
  });

  it("formats taxonomy guide for providers", () => {
    const guide = formatQuestionTaxonomyGuide();
    expect(guide).toContain("[RUBY OBJECTS — taxonomy]");
    expect(guide).toContain("world-geography");
    expect(guide).toContain("learnGoals");
    expect(guide).toContain("translationSuitable");
  });
});
