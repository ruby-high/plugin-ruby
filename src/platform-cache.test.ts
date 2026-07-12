import { describe, expect, it } from "vitest";
import {
  createCacheSlice,
  formatPlatformCacheForProvider,
  isCacheSliceFresh,
  markCacheSliceStale,
} from "./platform-cache.js";

describe("platform-cache", () => {
  it("marks slices stale after TTL", () => {
    const slice = createCacheSlice("summary", { ok: true }, 60_000, 0);
    expect(isCacheSliceFresh(slice, 30_000)).toBe(true);
    expect(isCacheSliceFresh(slice, 120_000)).toBe(false);
    const stale = markCacheSliceStale(slice);
    expect(stale.stale).toBe(true);
  });

  it("formats provider text with freshness lines", () => {
    const now = Date.parse("2026-06-13T12:00:00.000Z");
    const cache = {
      pulseIntervalMinutes: 5,
      happeningsTtlMinutes: 5,
      communityTtlMinutes: 15,
      health: createCacheSlice(
        "Ruby Trivia is online.",
        { online: true, publicStatus: "Ruby Trivia is online." },
        300_000,
        now - 120_000,
      ),
      happenings: createCacheSlice(
        "2 daily completions",
        {
          generatedAt: "2026-06-13T11:58:00.000Z",
          since: "2026-06-13T11:53:00.000Z",
          until: "2026-06-13T11:58:00.000Z",
          registrations: 0,
          dailyCompletions: 2,
          badgeEarns: 1,
          liveQueueWaiting: 0,
          activeLiveRooms: 0,
          timelineHighlights: ["Alice earned badge Speed Demon"],
          timeline: [
            {
              kind: "analytics",
              at: "2026-06-13T11:57:00.000Z",
              event: "badge_earned",
              displayName: "Alice",
              summary: "Alice earned badge Speed Demon",
            },
          ],
          liveRooms: [],
        },
        300_000,
        now - 120_000,
      ),
      community: createCacheSlice(
        "Weak categories: science",
        { weakCategories: ["science"] },
        900_000,
        now - 600_000,
      ),
      communityDifficulty: createCacheSlice(
        "Community struggle: science",
        {
          weakCategories: ["science"],
          weakCategoriesDetailed: [
            { category: "science", meanEasiness: 1.8, questions: 42 },
          ],
          byDifficulty: [
            { difficulty: "easy", accuracy: 0.82, attempts: 1200 },
          ],
        },
        900_000,
        now - 600_000,
      ),
    };

    const formatted = formatPlatformCacheForProvider(cache, now);
    expect(formatted.text).toContain("[RUBY PLATFORM]");
    expect(formatted.text).toContain("Happenings");
    expect(formatted.text).toContain("2 daily completions");
    expect(formatted.text).toContain("Weak categories: science");
    expect(formatted.values.liveQueueWaiting).toBe(0);
    expect(formatted.values.platformCacheFresh).toBe(true);
  });
});
