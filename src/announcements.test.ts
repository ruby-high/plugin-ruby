import { describe, expect, it, vi } from "vitest";
import {
  announceBackendDown,
  buildDigestText,
  buildOutageAlertText,
  filterNewCoolItems,
  isCoolTimelineItem,
  shouldAnnounceOutage,
} from "./announcements.js";
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

describe("announcements", () => {
  it("filters cool events and excludes routine noise", () => {
    expect(
      isCoolTimelineItem(item({ event: "badge_earned", summary: "badge" })),
    ).toBe(true);
    expect(
      isCoolTimelineItem(
        item({
          event: "daily_quiz_completed",
          summary: "streak",
          data: { new_streak: 6 },
        }),
      ),
    ).toBe(true);
    expect(
      isCoolTimelineItem(
        item({
          event: "daily_quiz_completed",
          summary: "streak",
          data: { new_streak: 2 },
        }),
      ),
    ).toBe(false);
    expect(
      isCoolTimelineItem(item({ event: "user_login", summary: "login" })),
    ).toBe(false);
  });

  it("dedupes announced timeline items", () => {
    const timeline = [
      item({ event: "badge_earned", summary: "badge", at: "t1" }),
      item({ event: "user_registered", summary: "signup", at: "t2" }),
    ];
    const announced = new Set(["t1:badge_earned:user-1"]);
    const filtered = filterNewCoolItems(timeline, announced);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.event).toBe("user_registered");
  });

  it("builds digest and outage text", () => {
    const digest = buildDigestText([
      item({
        event: "badge_earned",
        summary: 'Alice earned badge "Speed Demon"',
      }),
    ]);
    expect(digest).toContain("Ruby Trivia pulse");
    expect(digest).toContain("Speed Demon");

    const outage = buildOutageAlertText(
      "http://localhost:5175",
      "ECONNREFUSED",
      2,
      5,
    );
    expect(outage).toContain("DOWN");
    expect(outage).not.toContain("localhost");
    expect(outage).not.toContain("ECONNREFUSED");
  });

  it("throttles outage alerts after the first 30 minutes", () => {
    expect(shouldAnnounceOutage(1)).toBe(true);
    expect(shouldAnnounceOutage(6)).toBe(true);
    expect(shouldAnnounceOutage(7)).toBe(false);
    expect(shouldAnnounceOutage(9)).toBe(true);
  });


  it("treats content-bank progress as cool pulse events", () => {
    expect(
      isCoolTimelineItem(
        item({
          kind: "content",
          event: "content_progress",
          summary: "Content progress: 12 questions added",
        }),
      ),
    ).toBe(true);
    expect(
      isCoolTimelineItem(
        item({
          kind: "content",
          event: "traffic_puzzle_added",
          summary: 'New Traffic level "Gridlock"',
        }),
      ),
    ).toBe(true);
    expect(
      isCoolTimelineItem(
        item({
          kind: "content",
          event: "question_revise",
          summary: "Fixed question dyn-0001",
        }),
      ),
    ).toBe(true);
    expect(
      isCoolTimelineItem(
        item({
          kind: "content",
          event: "question_created",
          summary: "Added science question dyn-0001",
        }),
      ),
    ).toBe(false);
  });

  it("excludes routine crew practice scores from cool items", () => {
    expect(
      isCoolTimelineItem(
        item({
          kind: "crew",
          event: "crew_activity",
          summary: "bob scored 4,007 in film",
          data: { action: "scored 4,007 in film" },
        }),
      ),
    ).toBe(false);
    expect(
      isCoolTimelineItem(
        item({
          kind: "crew",
          event: "crew_activity",
          summary: "bob earned the Ace badge",
          data: { action: "earned the Ace badge" },
        }),
      ),
    ).toBe(true);
  });

  it("filters out bot accounts from cool digests", () => {
    const timeline = [
      item({
        event: "user_registered",
        summary: "farm signup",
        at: "t2",
        userId: "user_farm",
      }),
      item({
        event: "user_registered",
        summary: "real signup",
        at: "t3",
        userId: "user_ok",
      }),
    ];
    const filtered = filterNewCoolItems(
      timeline,
      new Set(),
      new Set(["user_farm"]),
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.userId).toBe("user_ok");
  });

  it("swallows Discord send failures", async () => {
    const runtime = {
      getSetting: (key: string) => {
        if (key === "RUBY_DISCORD_CHANNEL_ID") return "channel-1";
        return undefined;
      },
      sendMessageToTarget: vi.fn(async () => {
        throw new Error("no discord handler");
      }),
    } as never;

    const sent = await announceBackendDown(runtime, "ECONNREFUSED", 1);
    expect(sent).toBe(false);
  });
});
