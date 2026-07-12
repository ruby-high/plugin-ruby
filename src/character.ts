import type { Character, IAgentRuntime } from "@elizaos/core";
import { loadRubyCharacterFromElizaConfig } from "./load-ruby-character.js";

export { RUBY_CHARACTER_ID } from "./load-ruby-character.js";

let cachedRubyCharacter: Character | null | undefined;

export function getRubyCharacter(
  env: NodeJS.ProcessEnv = process.env,
): Character | null {
  if (cachedRubyCharacter === undefined) {
    cachedRubyCharacter = loadRubyCharacterFromElizaConfig(env);
  }
  return cachedRubyCharacter;
}

/** @deprecated Prefer {@link getRubyCharacter}; kept for direct imports. */
export function rubyCharacter(env: NodeJS.ProcessEnv = process.env): Character {
  const character = getRubyCharacter(env);
  if (!character) {
    throw new Error(
      '[plugin-ruby] Ruby agent entry not found in eliza config (agents.list[].name === "Ruby").',
    );
  }
  return character;
}

export function isRubyAgent(runtime: IAgentRuntime): boolean {
  return runtime.character.name?.trim().toLowerCase() === "ruby";
}

export function applyRubyCharacter(runtime: IAgentRuntime): void {
  if (!isRubyAgent(runtime)) return;

  const source = getRubyCharacter();
  if (!source) return;

  const target = runtime.character;

  // Only fill empty fields — dashboard edits in ruby.json must not be clobbered on init.
  if (!target.bio?.length) target.bio = [...(source.bio ?? [])];
  if (!target.system?.trim()) target.system = source.system ?? "";
  if (!target.adjectives?.length) {
    target.adjectives = [...(source.adjectives ?? [])];
  }
  if (!target.topics?.length) target.topics = [...(source.topics ?? [])];
  if (!target.postExamples?.length) {
    target.postExamples = [...(source.postExamples ?? [])];
  }
  if (!target.messageExamples?.length) {
    target.messageExamples = [...(source.messageExamples ?? [])];
  }
  if (!target.style?.all?.length && !target.style?.chat?.length) {
    target.style = {
      all: [...(source.style?.all ?? [])],
      chat: [...(source.style?.chat ?? [])],
      post: [...(source.style?.post ?? [])],
    };
  }

  target.settings = {
    ...source.settings,
    ...target.settings,
    ruby: {
      ...(typeof source.settings?.ruby === "object"
        ? source.settings.ruby
        : {}),
      ...(typeof target.settings?.ruby === "object"
        ? target.settings.ruby
        : {}),
      personalityApplied: true,
    },
  };
}

/** Test helper — reset cached config load between cases. */
export function resetRubyCharacterCache(): void {
  cachedRubyCharacter = undefined;
}
