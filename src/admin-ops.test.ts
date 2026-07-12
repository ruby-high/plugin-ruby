import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeRubyTriviaOp } from "./admin-ops.js";

function mockRuntime() {
  return {
    getSetting: (key: string) => {
      if (key === "RUBY_ANALYTICS_SECRET") return "test-secret";
      if (key === "RUBY_TRIVIA_API_URL") return "http://localhost:5175";
      return undefined;
    },
    setSetting: vi.fn(),
  } as never;
}

describe("admin-ops", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("poll_happenings summarizes and persists cursor", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            generatedAt: "2026-06-12T12:00:00.000Z",
            since: "2026-06-12T11:00:00.000Z",
            until: "2026-06-12T12:00:00.000Z",
            summary: {
              timelineCount: 1,
              analyticsEventCounts: {},
              crewActivityCount: 0,
              liveQueueWaiting: 2,
              activeLiveRooms: 1,
              registrations: 1,
              dailyCompletions: 3,
              badgeEarns: 1,
            },
            live: { queueWaiting: 2, activeRooms: 1, rooms: [] },
            timeline: [
              {
                kind: "analytics",
                at: "2026-06-12T11:30:00.000Z",
                event: "badge_earned",
                userId: "user-1",
                displayName: "Alice",
                summary: 'Alice earned badge "Speed Demon"',
                data: {},
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const runtime = mockRuntime();
    const result = await executeRubyTriviaOp(runtime, "poll_happenings");
    expect(result.success).toBe(true);
    expect(result.text).toContain("badge earns");
    expect(runtime.setSetting).toHaveBeenCalledWith(
      "RUBY_PULSE_LAST_GENERATED_AT",
      "2026-06-12T12:00:00.000Z",
    );
  });

  it("publish_daily returns conflict message", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ existing: true }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const result = await executeRubyTriviaOp(mockRuntime(), "publish_daily", {
      date: "2026-06-13",
      scope: "community",
      questionIds: ["q-0001"],
    });
    expect(result.success).toBe(false);
    expect(result.text).toContain("publish already exists");
  });

  it("health returns verified user-facing summary", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            ai: { enabled: true, reachable: true, model: "llama3.2:3b" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const result = await executeRubyTriviaOp(mockRuntime(), "health");
    expect(result.success).toBe(true);
    expect(result.text).toContain("internal");
    expect(result.userFacingText).toBe(
      "Ruby Trivia is online. Game services are responding.",
    );
    expect(result.verifiedUserFacing).toBe(true);
  });

  it("get_community_difficulty summarizes weak categories", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            byDifficulty: [
              { difficulty: "hard", accuracy: 0.42, attempts: 100 },
            ],
            weakCategories: [
              { category: "science", meanEasiness: 1.8, questions: 12 },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const result = await executeRubyTriviaOp(
      mockRuntime(),
      "get_community_difficulty",
    );
    expect(result.success).toBe(true);
    expect(result.text).toContain("science");
  });
});
