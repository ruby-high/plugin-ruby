import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  type Character,
  createCharacter,
  getElizaNamespace,
  logger,
  type MessageExample,
  type MessageExampleGroup,
  resolveStateDir,
  resolveUserPath,
} from "@elizaos/core";

export const RUBY_CHARACTER_ID = "ruby";

type AgentListEntry = {
  name?: string;
  bio?: string[];
  system?: string;
  style?: Character["style"];
  adjectives?: string[];
  topics?: string[];
  postExamples?: string[];
  messageExamples?: unknown[];
  settings?: Record<string, unknown>;
};

type ElizaConfigShape = {
  agents?: {
    list?: AgentListEntry[];
  };
};

/** Same candidate order as `@elizaos/agent` config loading, plus legacy `~/.eliza`. */
export function resolveElizaConfigCandidates(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const candidates: string[] = [];
  const explicit = env.ELIZA_CONFIG_PATH?.trim();
  if (explicit) {
    candidates.push(resolveUserPath(explicit));
  }

  const stateDir = resolveStateDir(env);
  const namespace = getElizaNamespace(env);
  candidates.push(path.join(stateDir, `${namespace}.json`));
  if (namespace !== "eliza") {
    candidates.push(path.join(stateDir, "eliza.json"));
  } else {
    candidates.push(path.join(stateDir, "ruby.json"));
  }

  candidates.push(path.join(homedir(), ".eliza", "eliza.json"));

  return [...new Set(candidates)];
}

function normalizeConfigMessageExamples(
  messageExamples: unknown[] | undefined,
): MessageExampleGroup[] | undefined {
  if (!messageExamples?.length) return undefined;

  const mapped = messageExamples.map((item) => {
    if (
      item &&
      typeof item === "object" &&
      "examples" in (item as Record<string, unknown>)
    ) {
      return item as MessageExampleGroup;
    }

    const arr = item as Array<{
      user?: string;
      name?: string;
      content: { text: string };
    }>;

    return {
      examples: arr.map(
        (msg): MessageExample => ({
          name: msg.name ?? msg.user ?? "",
          content: msg.content,
        }),
      ),
    };
  });

  return mapped;
}

function findRubyAgentEntry(
  config: ElizaConfigShape,
): AgentListEntry | undefined {
  return config.agents?.list?.find(
    (entry) => entry.name?.trim().toLowerCase() === "ruby",
  );
}

export function loadRubyCharacterFromElizaConfig(
  env: NodeJS.ProcessEnv = process.env,
): Character | null {
  for (const configPath of resolveElizaConfigCandidates(env)) {
    try {
      if (!fs.existsSync(configPath)) continue;

      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as ElizaConfigShape;
      const entry = findRubyAgentEntry(config);
      if (!entry) continue;

      const messageExamples = normalizeConfigMessageExamples(
        entry.messageExamples,
      );

      return createCharacter({
        name: entry.name?.trim() || "Ruby",
        bio: entry.bio ?? [],
        system: entry.system ?? "",
        ...(entry.style ? { style: entry.style } : {}),
        ...(entry.adjectives ? { adjectives: entry.adjectives } : {}),
        ...(entry.topics ? { topics: entry.topics } : {}),
        ...(entry.postExamples ? { postExamples: entry.postExamples } : {}),
        ...(messageExamples ? { messageExamples } : {}),
        settings: {
          ...(typeof entry.settings === "object" ? entry.settings : {}),
          ruby: {
            ...(typeof entry.settings?.ruby === "object"
              ? (entry.settings.ruby as Record<string, unknown>)
              : {}),
            presetId: RUBY_CHARACTER_ID,
            sourceConfigPath: configPath,
          },
        },
      });
    } catch (error) {
      logger.warn(
        { error, configPath },
        "[plugin-ruby] Failed to load Ruby character from config",
      );
    }
  }

  return null;
}
