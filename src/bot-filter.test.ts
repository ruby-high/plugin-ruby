import { describe, expect, it } from "vitest";
import {
  buildBotFingerprintSet,
  buildBotUserIdSet,
  isLikelyBotTimelineItem,
  isRoutineCrewActivity,
  normalizeFingerprint,
} from "./bot-filter.js";
import type { HappeningTimelineItem } from "./types/admin.js";

function item(
  partial: Partial<HappeningTimelineItem> &
    Pick<HappeningTimelineItem, "event" | "summary">,
): HappeningTimelineItem {
  return {
    kind: "analytics",
    at: "2026-06-12T10:00:00.000Z",
    userId: "user-1",
    displayName: "Alice",
    data: {},
    ...partial,
  };
}

describe("bot-filter", () => {
  it("normalizes quoted fingerprints", () => {
    expect(normalizeFingerprint('"dfp_abc"')).toBe("dfp_abc");
    expect(normalizeFingerprint("dfp_abc")).toBe("dfp_abc");
  });

  it("builds bot user and fingerprint sets from clusters", () => {
    const clusters = [
      {
        deviceFingerprint: '"dfp_farm"',
        userCount: 3,
        sampleUserIds: ["user_a", "user_b"],
      },
      { deviceFingerprint: "dfp_ok", userCount: 1, sampleUserIds: ["user_c"] },
    ];
    expect([...buildBotUserIdSet(clusters)].sort()).toEqual(["user_a", "user_b"]);
    expect([...buildBotFingerprintSet(clusters)]).toEqual(["dfp_farm"]);
  });

  it("flags routine crew practice scores", () => {
    expect(
      isRoutineCrewActivity(
        item({
          kind: "crew",
          event: "crew_activity",
          summary: "bob scored 4,007 in film",
          data: { action: "scored 4,007 in film" },
        }),
      ),
    ).toBe(true);
    expect(
      isRoutineCrewActivity(
        item({
          kind: "crew",
          event: "crew_activity",
          summary: 'bob earned the Ace badge',
          data: { action: "earned the Ace badge" },
        }),
      ),
    ).toBe(false);
  });

  it("flags items by bot userId or fingerprint", () => {
    const bots = new Set(["user_farm"]);
    const fps = new Set(["dfp_farm"]);
    expect(
      isLikelyBotTimelineItem(
        item({ event: "user_registered", summary: "x", userId: "user_farm" }),
        bots,
        fps,
      ),
    ).toBe(true);
    expect(
      isLikelyBotTimelineItem(
        item({
          event: "user_registered",
          summary: "x",
          userId: "user_ok",
          data: { device_fingerprint: "dfp_farm" },
        }),
        bots,
        fps,
      ),
    ).toBe(true);
    expect(
      isLikelyBotTimelineItem(
        item({ event: "user_registered", summary: "x", userId: "user_ok" }),
        bots,
        fps,
      ),
    ).toBe(false);
  });
});
