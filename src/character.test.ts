import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyRubyCharacter,
  getRubyCharacter,
  isRubyAgent,
  RUBY_CHARACTER_ID,
  resetRubyCharacterCache,
  rubyCharacter,
} from "./character.js";
import { loadRubyCharacterFromElizaConfig } from "./load-ruby-character.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/ruby-eliza.json",
);

describe("loadRubyCharacterFromElizaConfig", () => {
  const originalConfigPath = process.env.ELIZA_CONFIG_PATH;

  beforeEach(() => {
    resetRubyCharacterCache();
    process.env.ELIZA_CONFIG_PATH = fixturePath;
  });

  afterEach(() => {
    resetRubyCharacterCache();
    if (originalConfigPath === undefined) {
      delete process.env.ELIZA_CONFIG_PATH;
    } else {
      process.env.ELIZA_CONFIG_PATH = originalConfigPath;
    }
  });

  it("loads the Ruby agent entry from eliza config", () => {
    const character = loadRubyCharacterFromElizaConfig();
    expect(character?.name).toBe("Ruby");
    expect(character?.system).toContain("platform operator");
    expect(character?.bio[0]).toContain("incentives");
    expect(character?.messageExamples.length).toBeGreaterThan(0);
    expect(character?.settings?.ruby).toMatchObject({
      presetId: RUBY_CHARACTER_ID,
      sourceConfigPath: fixturePath,
    });
  });
});

describe("getRubyCharacter", () => {
  const originalConfigPath = process.env.ELIZA_CONFIG_PATH;

  beforeEach(() => {
    resetRubyCharacterCache();
    process.env.ELIZA_CONFIG_PATH = fixturePath;
  });

  afterEach(() => {
    resetRubyCharacterCache();
    if (originalConfigPath === undefined) {
      delete process.env.ELIZA_CONFIG_PATH;
    } else {
      process.env.ELIZA_CONFIG_PATH = originalConfigPath;
    }
  });

  it("caches the loaded character", () => {
    expect(getRubyCharacter()?.system).toContain("platform operator");
    expect(rubyCharacter().name).toBe("Ruby");
  });
});

describe("applyRubyCharacter", () => {
  const originalConfigPath = process.env.ELIZA_CONFIG_PATH;

  beforeEach(() => {
    resetRubyCharacterCache();
    process.env.ELIZA_CONFIG_PATH = fixturePath;
  });

  afterEach(() => {
    resetRubyCharacterCache();
    if (originalConfigPath === undefined) {
      delete process.env.ELIZA_CONFIG_PATH;
    } else {
      process.env.ELIZA_CONFIG_PATH = originalConfigPath;
    }
  });

  it("fills missing personality fields for agents named Ruby", () => {
    const runtime = {
      character: {
        name: "Ruby",
        bio: [],
        system: "",
        adjectives: [],
        topics: [],
        postExamples: [],
        messageExamples: [],
        style: {},
        settings: {},
        plugins: [],
        secrets: {},
        templates: {},
      },
    };

    applyRubyCharacter(runtime as never);
    expect(runtime.character.system).toContain("platform operator");
    expect(runtime.character.bio.length).toBeGreaterThan(0);
    expect(runtime.character.settings.ruby).toMatchObject({
      personalityApplied: true,
    });
  });

  it("does not overwrite customized fields", () => {
    const runtime = {
      character: {
        name: "Ruby",
        bio: ["custom bio"],
        system: "custom system",
        adjectives: ["custom"],
        topics: ["custom topic"],
        postExamples: ["custom post"],
        messageExamples: [{ examples: [] }],
        style: { all: ["custom style"] },
        settings: {},
        plugins: [],
        secrets: {},
        templates: {},
      },
    };

    applyRubyCharacter(runtime as never);
    expect(runtime.character.system).toBe("custom system");
    expect(runtime.character.bio).toEqual(["custom bio"]);
  });

  it("skips agents that are not named Ruby", () => {
    const runtime = {
      character: {
        name: "Eliza",
        bio: [],
        system: "",
        adjectives: [],
        topics: [],
        postExamples: [],
        messageExamples: [],
        style: {},
        settings: {},
        plugins: [],
        secrets: {},
        templates: {},
      },
    };

    applyRubyCharacter(runtime as never);
    expect(runtime.character.system).toBe("");
    expect(isRubyAgent(runtime as never)).toBe(false);
  });
});
