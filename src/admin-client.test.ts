import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatHealthSummary,
  formatHealthSummaryPublic,
  getHappeningsTimeline,
  rubyAdminFetch,
  rubyHealthFetch,
} from "./admin-client.js";

function mockRuntime(secret = "test-secret") {
  return {
    getSetting: (key: string) => {
      if (key === "RUBY_ANALYTICS_SECRET") return secret;
      if (key === "RUBY_TRIVIA_API_URL") return "http://localhost:5175";
      return undefined;
    },
  } as never;
}

describe("admin-client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends analytics secret on admin fetch", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await rubyAdminFetch(
      mockRuntime(),
      "GET",
      "/api/admin/community",
    );
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:5175/api/admin/community",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-analytics-secret": "test-secret",
        }),
      }),
    );
  });

  it("maps forbidden responses", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "nope" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    const result = await rubyAdminFetch(
      mockRuntime(),
      "GET",
      "/api/admin/community",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("http");
      expect(result.status).toBe(403);
      expect(result.message).toContain("Wrong analytics secret");
    }
  });

  it("maps health fetch network failures", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const result = await rubyHealthFetch(mockRuntime());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("network");
      expect(result.message).toContain("ECONNREFUSED");
    }
  });

  it("formats internal health summary with operator detail", () => {
    const text = formatHealthSummary("http://localhost:5175", {
      ok: true,
      ai: { enabled: true, reachable: true, model: "llama3.2:3b" },
    });
    expect(text).toContain("internal");
    expect(text).toContain("localhost:5175");
    expect(text).toContain("llama3.2:3b");
  });

  it("formats public health summary without infra leaks", () => {
    const text = formatHealthSummaryPublic({
      ok: true,
      ai: { enabled: true, reachable: true, model: "llama3.2:3b" },
    });
    expect(text).toContain("online");
    expect(text).not.toContain("localhost");
    expect(text).not.toContain("llama");
    expect(text).not.toContain("/api/");
  });

  it("treats missing happenings timeline as empty", () => {
    expect(getHappeningsTimeline({ timeline: undefined })).toEqual([]);
    expect(
      getHappeningsTimeline({ timeline: null as unknown as undefined }),
    ).toEqual([]);
  });
});
