import fs from "node:fs";
import path from "node:path";
import type { IAgentRuntime } from "@elizaos/core";
import { resolveStateDir } from "@elizaos/core";
import { ANNOUNCED_KEYS_MAX, COLD_START_SINCE_HOURS } from "./config.js";

/** Server-generatedAt cursor — authoritative for ?since= (client clocks drift). */
export const RUBY_PULSE_LAST_GENERATED_AT = "RUBY_PULSE_LAST_GENERATED_AT";
/** JSON string[] of dedup keys — prevents replaying Discord digests after restart. */
export const RUBY_PULSE_ANNOUNCED_KEYS = "RUBY_PULSE_ANNOUNCED_KEYS";

export type PulseState = {
  lastGeneratedAt: string | null;
  announcedKeys: Set<string>;
};

type PulseStateFile = {
  lastGeneratedAt?: string | null;
  announcedKeys?: string[];
};

function readStringSetting(runtime: IAgentRuntime, key: string): string | null {
  const value = runtime.getSetting(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseAnnouncedKeys(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item) => typeof item === "string"));
  } catch {
    return new Set();
  }
}

/** Durable pulse state — runtime.setSetting is in-memory only and resets on restart. */
export function resolvePulseStatePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveStateDir(env), "plugin-ruby", "pulse-state.json");
}

function readPulseStateFile(): PulseStateFile | null {
  const filePath = resolvePulseStatePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as PulseStateFile;
  } catch {
    return null;
  }
}

function writePulseStateFile(state: PulseState): void {
  const filePath = resolvePulseStatePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload: PulseStateFile = {
    lastGeneratedAt: state.lastGeneratedAt,
    announcedKeys: [...state.announcedKeys],
  };
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function syncRuntimeSettings(runtime: IAgentRuntime, state: PulseState): void {
  if (typeof runtime.setSetting !== "function") return;
  if (state.lastGeneratedAt) {
    runtime.setSetting(RUBY_PULSE_LAST_GENERATED_AT, state.lastGeneratedAt);
  }
  runtime.setSetting(
    RUBY_PULSE_ANNOUNCED_KEYS,
    JSON.stringify([...state.announcedKeys]),
  );
}

export function loadPulseState(runtime: IAgentRuntime): PulseState {
  const fromFile = readPulseStateFile();
  const fromRuntimeCursor = readStringSetting(
    runtime,
    RUBY_PULSE_LAST_GENERATED_AT,
  );
  const fromRuntimeKeys = parseAnnouncedKeys(
    readStringSetting(runtime, RUBY_PULSE_ANNOUNCED_KEYS),
  );

  // Prefer the newer cursor between disk and in-memory runtime settings.
  let lastGeneratedAt = fromFile?.lastGeneratedAt ?? null;
  if (
    fromRuntimeCursor &&
    (!lastGeneratedAt || fromRuntimeCursor > lastGeneratedAt)
  ) {
    lastGeneratedAt = fromRuntimeCursor;
  }

  const announcedKeys = new Set<string>([
    ...(fromFile?.announcedKeys ?? []),
    ...fromRuntimeKeys,
  ]);

  const state = { lastGeneratedAt, announcedKeys };
  // Mirror into runtime so other readers of getSetting see the durable cursor.
  syncRuntimeSettings(runtime, state);
  return state;
}

export function savePulseCursor(
  runtime: IAgentRuntime,
  generatedAt: string,
): void {
  const current = loadPulseState(runtime);
  // Cursor only moves forward — never rewind on out-of-order polls.
  if (current.lastGeneratedAt && generatedAt <= current.lastGeneratedAt) {
    syncRuntimeSettings(runtime, current);
    return;
  }
  const next: PulseState = {
    lastGeneratedAt: generatedAt,
    announcedKeys: current.announcedKeys,
  };
  writePulseStateFile(next);
  syncRuntimeSettings(runtime, next);
}

function persistAnnouncedKeys(runtime: IAgentRuntime, keys: Set<string>): void {
  const current = loadPulseState(runtime);
  const next: PulseState = {
    lastGeneratedAt: current.lastGeneratedAt,
    announcedKeys: keys,
  };
  writePulseStateFile(next);
  syncRuntimeSettings(runtime, next);
}

export function markAnnouncedKeys(
  runtime: IAgentRuntime,
  keys: string[],
  existing: Set<string>,
): Set<string> {
  const merged = new Set(existing);
  for (const key of keys) {
    merged.add(key);
  }
  const ordered = [...merged];
  // FIFO trim: keep most recent keys when cap exceeded.
  const trimmed =
    ordered.length > ANNOUNCED_KEYS_MAX
      ? ordered.slice(ordered.length - ANNOUNCED_KEYS_MAX)
      : ordered;
  const next = new Set(trimmed);
  persistAnnouncedKeys(runtime, next);
  return next;
}

export function resolveSinceParam(lastGeneratedAt: string | null): string {
  if (lastGeneratedAt) return lastGeneratedAt;
  // Cold start: bounded lookback instead of full history or empty feed.
  const since = new Date(Date.now() - COLD_START_SINCE_HOURS * 60 * 60 * 1000);
  return since.toISOString();
}

export function happeningDedupKey(item: {
  at: string;
  event: string;
  userId: string | null;
  data?: Record<string, unknown> | null;
}): string {
  // Prefer stable activity/event ids when present — timestamps alone can collide.
  const activityId = item.data?.activityId ?? item.data?.id;
  if (typeof activityId === "string" && activityId.trim()) {
    return `${item.event}:${activityId.trim()}`;
  }
  // Stable across polls; anon guests use literal "anon".
  return `${item.at}:${item.event}:${item.userId ?? "anon"}`;
}
