import { describe, expect, it } from "vitest";
import {
  buildAuditActions,
  buildSweepPrompt,
  isSweepVerdict,
  MAX_REASON_CHARS,
  summarizeCycle,
  type AuditQuestionItem,
  type SweepJudgement,
} from "./audit-sweep-policy.js";

function item(overrides: Partial<AuditQuestionItem> = {}): AuditQuestionItem {
  return {
    id: "dyn-0001",
    question: "What is the chemical symbol for gold?",
    options: ["Au", "Ag", "Fe", "Cu"],
    correctIndex: 0,
    explanation: "Au from Latin aurum.",
    category: "science",
    difficulty: "easy",
    audit: { issues: [{ code: "verbose_options", severity: "warning" }] },
    ...overrides,
  };
}

function judgement(overrides: Partial<SweepJudgement> = {}): SweepJudgement {
  return { verdict: "keep", reason: "fine", judgeOk: true, ...overrides };
}

describe("buildSweepPrompt", () => {
  it("marks the correct option so the judge can check it", () => {
    const prompt = buildSweepPrompt(item());
    expect(prompt).toContain("1. Au  <- correct");
    expect(prompt).toContain("2. Ag");
  });

  it("lists the automated flags that got it here", () => {
    expect(buildSweepPrompt(item())).toContain("verbose_options (warning)");
  });

  it("says so explicitly when there is no explanation", () => {
    expect(buildSweepPrompt(item({ explanation: null }))).toContain("Explanation: (none)");
  });

  it("tells the judge the question is currently live", () => {
    // The judge's decision changes if it thinks it is reviewing a draft rather than live content.
    expect(buildSweepPrompt(item())).toContain("currently PLAYABLE");
  });

  it("asks only for the verdicts the action builder understands", () => {
    expect(buildSweepPrompt(item())).toContain('"verdict":"keep|hide|needs_human"');
  });
});

describe("buildAuditActions", () => {
  it("hides what the judge rejected", () => {
    const actions = buildAuditActions([
      { item: item(), judgement: judgement({ verdict: "hide", reason: "answer is wrong" }) },
    ]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ questionId: "dyn-0001", action: "hide" });
    expect(actions[0]!.reason).toContain("answer is wrong");
  });

  it("marks uncertain questions for a human without hiding them", () => {
    const actions = buildAuditActions([
      { item: item(), judgement: judgement({ verdict: "needs_human", reason: "needs a source" }) },
    ]);
    expect(actions[0]!.action).toBe("needs_human");
  });

  it("does nothing for a keep - a judge cannot clear a deterministic flag", () => {
    expect(
      buildAuditActions([{ item: item(), judgement: judgement({ verdict: "keep" }) }]),
    ).toEqual([]);
  });

  it("ignores every verdict from a failed judge, including hide", () => {
    // Fail-closed: an unreachable judge must never remove a live question.
    const actions = buildAuditActions([
      { item: item(), judgement: { verdict: "hide", reason: "judge unreachable", judgeOk: false } },
      {
        item: item({ id: "dyn-0002" }),
        judgement: { verdict: "needs_human", reason: "judge error", judgeOk: false },
      },
    ]);
    expect(actions).toEqual([]);
  });

  it("keeps reasons within the server's field limit", () => {
    const actions = buildAuditActions([
      { item: item(), judgement: judgement({ verdict: "hide", reason: "x".repeat(500) }) },
    ]);
    expect(actions[0]!.reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
  });

  it("batches a mixed set down to only the actionable rows", () => {
    const actions = buildAuditActions([
      { item: item({ id: "a" }), judgement: judgement({ verdict: "keep" }) },
      { item: item({ id: "b" }), judgement: judgement({ verdict: "hide" }) },
      { item: item({ id: "c" }), judgement: judgement({ verdict: "needs_human" }) },
      { item: item({ id: "d" }), judgement: { verdict: "hide", reason: "x", judgeOk: false } },
    ]);
    expect(actions.map((a) => a.questionId)).toEqual(["b", "c"]);
  });

  it("returns nothing for an empty batch", () => {
    expect(buildAuditActions([])).toEqual([]);
  });
});

describe("isSweepVerdict", () => {
  it("accepts the three real verdicts", () => {
    expect(isSweepVerdict("keep")).toBe(true);
    expect(isSweepVerdict("hide")).toBe(true);
    expect(isSweepVerdict("needs_human")).toBe(true);
  });

  it("rejects anything a confused model might emit", () => {
    for (const bad of ["approve", "revise", "", null, undefined, 1, {}]) {
      expect(isSweepVerdict(bad)).toBe(false);
    }
  });
});

describe("summarizeCycle", () => {
  it("reads as a sentence a human can scan in a log", () => {
    expect(
      summarizeCycle({
        scanned: 25,
        hidden: 3,
        kept: 20,
        flaggedForHuman: 1,
        skipped: 1,
        errors: [],
      }),
    ).toBe("scanned 25, hid 3, kept 20, flagged 1 for a human, skipped 1");
  });
});
