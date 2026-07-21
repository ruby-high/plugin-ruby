import { describe, expect, it } from "vitest";
import {
  buildMadlibAuthoringPrompt,
  buildMadlibJudgePrompt,
  judgeMadlib,
  parseGeneratedMadlib,
  parsePlaceholders,
  pickMadlibTargets,
  validateMadlibStructure,
  type DraftMadlib,
  type MadlibBlank,
  type MadlibTarget,
} from "./madlib-authoring.js";
import { MADLIB_THEMES } from "./madlib-taxonomy.js";

const target: MadlibTarget = { theme: "haunted", length: "medium" };

const goodText =
  "Last night I wandered into the {1:adjective} arcade on the edge of town, where a/an {2:noun} " +
  "was quietly eating {3:food} behind the broken claw machine and then {4:verb-past} away.";
const goodBlanks: MadlibBlank[] = [
  { index: 1, type: "adjective" },
  { index: 2, type: "noun" },
  { index: 3, type: "food" },
  { index: 4, type: "verb-past" },
];

describe("pickMadlibTargets", () => {
  it("rotates through themes and advances the cursor", () => {
    const { targets, nextThemeIndex } = pickMadlibTargets({ count: 3, themeIndex: 0 });
    expect(targets).toHaveLength(3);
    expect(targets[0]!.theme).toBe(MADLIB_THEMES[0]);
    expect(targets[1]!.theme).toBe(MADLIB_THEMES[1]);
    expect(nextThemeIndex).toBe(3);
  });

  it("wraps the theme index at the end of the list", () => {
    const { nextThemeIndex } = pickMadlibTargets({
      count: 2,
      themeIndex: MADLIB_THEMES.length - 1,
    });
    expect(nextThemeIndex).toBe(1);
  });

  it("varies length across a run", () => {
    const { targets } = pickMadlibTargets({ count: 3, themeIndex: 0 });
    expect(new Set(targets.map((t) => t.length)).size).toBeGreaterThan(1);
  });
});

describe("parsePlaceholders", () => {
  it("extracts index and type in order", () => {
    const found = parsePlaceholders("a {1:adjective} b {2:noun}");
    expect(found.map((p) => `${p.index}:${p.type}`)).toEqual(["1:adjective", "2:noun"]);
  });
});

describe("validateMadlibStructure", () => {
  it("accepts a well-formed template", () => {
    expect(validateMadlibStructure(goodText, goodBlanks)).toEqual([]);
  });

  it("flags untyped placeholders like {noun}", () => {
    const text = "I found a/an {1:adjective} {noun} eating {3:food} and {4:verb-past} away quickly now here.";
    const errors = validateMadlibStructure(text, goodBlanks);
    expect(errors.join(" ")).toContain("malformed");
  });

  it("flags a gap in blank numbering", () => {
    const text =
      "I found a/an {1:adjective} thing where a/an {3:noun} ate {4:food} then {5:verb-past} away here today.";
    const errors = validateMadlibStructure(text, [
      { index: 1, type: "adjective" },
      { index: 3, type: "noun" },
      { index: 4, type: "food" },
      { index: 5, type: "verb-past" },
    ]);
    expect(errors.join(" ")).toContain("indices must be");
  });

  it("flags a bare article before a blank", () => {
    const text =
      "Last night I found a {1:adjective} arcade where a/an {2:noun} ate {3:food} and {4:verb-past} away now.";
    const errors = validateMadlibStructure(text, goodBlanks);
    expect(errors.join(" ")).toContain("a/an");
  });

  it("flags blanks[] disagreeing with the text", () => {
    const errors = validateMadlibStructure(goodText, [
      { index: 1, type: "adjective" },
      { index: 2, type: "animal" }, // text says noun
      { index: 3, type: "food" },
      { index: 4, type: "verb-past" },
    ]);
    expect(errors.join(" ")).toContain("does not match");
  });

  it("flags unsafe content", () => {
    const text = goodText.replace("arcade", "porn arcade");
    expect(validateMadlibStructure(text, goodBlanks).join(" ")).toContain("unsafe");
  });
});

describe("parseGeneratedMadlib", () => {
  it("parses valid JSON into a draft", () => {
    const raw = JSON.stringify({ title: "The Arcade", text: goodText, blanks: goodBlanks });
    const { draft, errors } = parseGeneratedMadlib(raw, target);
    expect(errors).toEqual([]);
    expect(draft?.title).toBe("The Arcade");
    expect(draft?.theme).toBe("haunted");
  });

  it("rejects a structurally invalid draft with reasons", () => {
    const raw = JSON.stringify({
      title: "Too short",
      text: "A/an {1:noun} ate {2:food} near {3:animal}.",
      blanks: [
        { index: 1, type: "noun" },
        { index: 2, type: "food" },
        { index: 3, type: "animal" },
      ],
    });
    const { draft, errors } = parseGeneratedMadlib(raw, target);
    expect(draft).toBeNull();
    expect(errors.join(" ")).toContain("prose");
  });

  it("rejects a draft with an unknown blank type", () => {
    const raw = JSON.stringify({
      title: "Bad Type",
      text: goodText.replace("{1:adjective}", "{1:gerund}"),
      blanks: [{ index: 1, type: "gerund" }, ...goodBlanks.slice(1)],
    });
    const { draft } = parseGeneratedMadlib(raw, target);
    expect(draft).toBeNull();
  });
});

describe("buildMadlibAuthoringPrompt", () => {
  it("includes the theme and the a/an rule", () => {
    const prompt = buildMadlibAuthoringPrompt({ target, existingTitles: [] });
    expect(prompt).toContain("haunted");
    expect(prompt).toContain("a/an");
  });
});

describe("buildMadlibJudgePrompt", () => {
  const draft: DraftMadlib = {
    theme: "haunted",
    length: "medium",
    title: "The Arcade",
    text: goodText,
    blanks: goodBlanks,
  };

  it("asks for a JSON verdict", () => {
    const prompt = buildMadlibJudgePrompt(draft);
    expect(prompt).toContain("approve|hide|revise");
  });
});

describe("judgeMadlib", () => {
  const draft: DraftMadlib = {
    theme: "haunted",
    length: "medium",
    title: "The Arcade",
    text: goodText,
    blanks: goodBlanks,
  };

  it("approves when the judge model is empty (disabled)", async () => {
    const result = await judgeMadlib(draft, "", "http://localhost:11434", false);
    expect(result.verdict).toBe("approve");
    expect(result.judgeOk).toBe(true);
  });

  it("approves with judgeOk=false when the judge is unreachable", async () => {
    // Nothing is listening on this port — fetch rejects, and we fail open.
    const result = await judgeMadlib(draft, "some-model", "http://127.0.0.1:1", false);
    expect(result.verdict).toBe("approve");
    expect(result.judgeOk).toBe(false);
  });
});
