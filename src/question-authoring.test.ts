import { describe, expect, it } from "vitest";
import {
  buildJudgePrompt,
  buildQuestionAuthoringPrompt,
  judgeQuestion,
  parseGeneratedQuestion,
  pickAuthoringTargets,
  slotToTarget,
} from "./question-authoring.js";

describe("question-authoring", () => {
  it("rotates through category and difficulty slots", () => {
    const first = slotToTarget(0);
    expect(first).toEqual({ category: "history", difficulty: "easy" });
    const second = slotToTarget(1);
    expect(second).toEqual({ category: "history", difficulty: "medium" });
  });

  it("picks distinct targets and advances slot index", () => {
    const { targets, nextSlotIndex } = pickAuthoringTargets({
      count: 2,
      slotIndex: 0,
    });
    expect(targets).toHaveLength(2);
    expect(targets[0]).toEqual({ category: "history", difficulty: "easy" });
    expect(targets[1]).toEqual({ category: "history", difficulty: "medium" });
    expect(nextSlotIndex).toBe(2);
  });

  it("biases toward weak categories on every third slot", () => {
    const { targets } = pickAuthoringTargets({
      count: 1,
      slotIndex: 0,
      weakCategories: ["science"],
    });
    expect(targets[0]?.category).toBe("science");
  });

  it("parses valid generated question JSON", () => {
    const target = {
      category: "science" as const,
      difficulty: "medium" as const,
    };
    const draft = parseGeneratedQuestion(
      JSON.stringify({
        question: "What planet is known as the Red Planet?",
        options: ["Mars", "Venus", "Jupiter", "Saturn"],
        correctIndex: 0,
        explanation: "Mars appears red due to iron oxide on its surface.",
      }),
      target,
    );
    expect(draft).toEqual({
      category: "science",
      difficulty: "medium",
      question: "What planet is known as the Red Planet?",
      options: ["Mars", "Venus", "Jupiter", "Saturn"],
      correctIndex: 0,
      explanation: "Mars appears red due to iron oxide on its surface.",
    });
  });

  it("rejects duplicate options", () => {
    const target = {
      category: "science" as const,
      difficulty: "easy" as const,
    };
    const draft = parseGeneratedQuestion(
      JSON.stringify({
        question: "Test?",
        options: ["Mars", "Mars", "Jupiter", "Saturn"],
        correctIndex: 0,
      }),
      target,
    );
    expect(draft).toBeNull();
  });

  it("includes category and difficulty in prompt", () => {
    const prompt = buildQuestionAuthoringPrompt({
      target: { category: "film", difficulty: "hard" },
      existingSamples: ["Who directed Inception?"],
    });
    expect(prompt).toContain("Category: film");
    expect(prompt).toContain("Difficulty: hard");
    expect(prompt).toContain("Who directed Inception?");
  });
});

describe("buildJudgePrompt", () => {
  const draft = {
    category: "science" as const,
    difficulty: "medium" as const,
    question: "What planet is known as the Red Planet?",
    options: ["Mars", "Venus", "Jupiter", "Saturn"] as [
      string,
      string,
      string,
      string,
    ],
    correctIndex: 0 as const,
    explanation: "Mars appears red due to iron oxide on its surface.",
  };

  it("includes marked correct option", () => {
    const prompt = buildJudgePrompt(draft);
    expect(prompt).toContain("1. Mars (marked correct)");
    expect(prompt).toContain("2. Venus");
  });

  it("includes the explanation", () => {
    const prompt = buildJudgePrompt(draft);
    expect(prompt).toContain("Mars appears red due to iron oxide");
  });

  it("requests JSON verdict", () => {
    const prompt = buildJudgePrompt(draft);
    expect(prompt).toContain('"verdict"');
    expect(prompt).toContain("approve|hide|revise_distractors");
  });
});

describe("judgeQuestion", () => {
  it("returns approve when judge model is empty string (disabled)", async () => {
    const result = await judgeQuestion(
      {
        category: "science",
        difficulty: "easy",
        question: "Test?",
        options: ["A", "B", "C", "D"],
        correctIndex: 0,
      },
      "",
      "http://localhost:11434",
      false,
    );
    expect(result.verdict).toBe("approve");
    expect(result.judgeOk).toBe(true);
    expect(result.reason).toContain("disabled");
  });

  it("returns approve with judgeOk=false on network failure", async () => {
    const result = await judgeQuestion(
      {
        category: "science",
        difficulty: "easy",
        question: "Test?",
        options: ["A", "B", "C", "D"],
        correctIndex: 0,
      },
      "gemma4:e4b",
      "http://127.0.0.1:1",
      false,
    );
    expect(result.verdict).toBe("approve");
    expect(result.judgeOk).toBe(false);
  });
});
