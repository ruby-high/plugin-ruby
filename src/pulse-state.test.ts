import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANNOUNCED_KEYS_MAX } from "./config.js";
import {
  happeningDedupKey,
  loadPulseState,
  markAnnouncedKeys,
  resolvePulseStatePath,
  resolveSinceParam,
  savePulseCursor,
} from "./pulse-state.js";

function mockRuntime(settings: Record<string, string> = {}) {
  const store = new Map(Object.entries(settings));
  return {
    getSetting: (key: string) => store.get(key),
    setSetting: (key: string, value: string) => {
      store.set(key, value);
    },
  } as never;
}

describe("pulse-state", () => {
  let prevStateDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    prevStateDir = process.env.ELIZA_STATE_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ruby-pulse-"));
    process.env.ELIZA_STATE_DIR = tempDir;
  });

  afterEach(() => {
    if (prevStateDir === undefined) delete process.env.ELIZA_STATE_DIR;
    else process.env.ELIZA_STATE_DIR = prevStateDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses a 1-hour cold-start window when no cursor exists", () => {
    const since = resolveSinceParam(null);
    const parsed = Date.parse(since);
    const hourAgo = Date.now() - 60 * 60 * 1000;
    expect(parsed).toBeGreaterThan(hourAgo - 5_000);
    expect(parsed).toBeLessThanOrEqual(Date.now());
  });

  it("persists cursor and announced keys to disk across runtime reloads", () => {
    const runtime = mockRuntime();
    savePulseCursor(runtime, "2026-06-12T10:00:00.000Z");
    expect(fs.existsSync(resolvePulseStatePath())).toBe(true);

    const initial = loadPulseState(runtime);
    expect(initial.lastGeneratedAt).toBe("2026-06-12T10:00:00.000Z");

    const keys = Array.from(
      { length: ANNOUNCED_KEYS_MAX + 5 },
      (_, index) => `key-${index}`,
    );
    const next = markAnnouncedKeys(runtime, keys, new Set());
    expect(next.size).toBe(ANNOUNCED_KEYS_MAX);
    expect(next.has("key-4")).toBe(false);
    expect(next.has(`key-${ANNOUNCED_KEYS_MAX + 4}`)).toBe(true);

    // Fresh runtime (simulates process restart) still sees durable state.
    const reloaded = loadPulseState(mockRuntime());
    expect(reloaded.lastGeneratedAt).toBe("2026-06-12T10:00:00.000Z");
    expect(reloaded.announcedKeys.size).toBe(ANNOUNCED_KEYS_MAX);
  });

  it("never rewinds the cursor", () => {
    const runtime = mockRuntime();
    savePulseCursor(runtime, "2026-06-12T10:00:00.000Z");
    savePulseCursor(runtime, "2026-06-12T09:00:00.000Z");
    expect(loadPulseState(runtime).lastGeneratedAt).toBe(
      "2026-06-12T10:00:00.000Z",
    );
  });

  it("prefers activityId in dedup keys when present", () => {
    expect(
      happeningDedupKey({
        at: "t1",
        event: "crew_activity",
        userId: "u1",
        data: { activityId: "act_123" },
      }),
    ).toBe("crew_activity:act_123");
  });
});
