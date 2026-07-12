import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RubyTriviaPulseService } from "./ruby-trivia-pulse.js";

function mockRuntime() {
  const settings = new Map<string, string>([
    ["RUBY_ANALYTICS_SECRET", "test-secret"],
    ["RUBY_TRIVIA_API_URL", "http://localhost:5175"],
    ["RUBY_DISCORD_CHANNEL_ID", "channel-1"],
  ]);
  return {
    getSetting: (key: string) => settings.get(key),
    setSetting: (key: string, value: string) => {
      settings.set(key, value);
    },
    sendMessageToTarget: vi.fn(async () => undefined),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
  } as never;
}

describe("RubyTriviaPulseService", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("marks backend down and announces outage on health failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const runtime = mockRuntime();
    const service = await RubyTriviaPulseService.start(runtime);
    await service.runPulse();

    const snapshot = service.getSnapshot();
    expect(snapshot.backendReachable).toBe(false);
    expect(snapshot.consecutiveFailures).toBe(1);
    expect(snapshot.lastError).toContain("ECONNREFUSED");
    expect(runtime.sendMessageToTarget).toHaveBeenCalled();
  });

  it("persists cursor and skips digest during outage recovery path", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            generatedAt: "2026-06-12T12:00:00.000Z",
            since: "2026-06-12T11:00:00.000Z",
            until: "2026-06-12T12:00:00.000Z",
            summary: {
              timelineCount: 0,
              analyticsEventCounts: {},
              crewActivityCount: 0,
              liveQueueWaiting: 0,
              activeLiveRooms: 0,
              registrations: 0,
              dailyCompletions: 0,
              badgeEarns: 0,
            },
            live: { queueWaiting: 0, activeRooms: 0, rooms: [] },
            timeline: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as unknown as typeof fetch;

    const runtime = mockRuntime();
    const service = await RubyTriviaPulseService.start(runtime);
    await service.runPulse();

    const snapshot = service.getSnapshot();
    expect(snapshot.backendReachable).toBe(true);
    expect(snapshot.lastGeneratedAt).toBe("2026-06-12T12:00:00.000Z");
    expect(runtime.getSetting("RUBY_PULSE_LAST_GENERATED_AT")).toBe(
      "2026-06-12T12:00:00.000Z",
    );

    const cache = service.getPlatformCache();
    expect(cache.health.data?.online).toBe(true);
    expect(cache.happenings.summary).toBeTruthy();
    expect(service.isHappeningsCacheFresh()).toBe(true);
  });

  it("survives happenings responses without timeline", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            generatedAt: "2026-06-12T12:00:00.000Z",
            since: "2026-06-12T11:00:00.000Z",
            until: "2026-06-12T12:00:00.000Z",
            summary: {
              timelineCount: 0,
              analyticsEventCounts: {},
              crewActivityCount: 0,
              liveQueueWaiting: 0,
              activeLiveRooms: 0,
              registrations: 0,
              dailyCompletions: 0,
              badgeEarns: 0,
            },
            live: { queueWaiting: 0, activeRooms: 0, rooms: [] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as unknown as typeof fetch;

    const runtime = mockRuntime();
    const service = await RubyTriviaPulseService.start(runtime);
    await service.runPulse();

    const snapshot = service.getSnapshot();
    expect(snapshot.backendReachable).toBe(true);
    expect(snapshot.recentHighlights).toEqual([]);
    expect(service.getPlatformCache().happenings.data?.timeline).toEqual([]);
  });
});
