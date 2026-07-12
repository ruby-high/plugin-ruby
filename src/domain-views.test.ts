import { describe, expect, it } from "vitest";
import {
  DOMAIN_OBJECTS,
  formatDomainCatalog,
  formatObjectRoutingGuide,
  suggestOpForKinds,
} from "./domain-catalog.js";
import {
  formatCachedObjectViews,
  formatObjectDetail,
  formatObjectListing,
  formatObjectSummary,
} from "./domain-views.js";
import {
  createCacheSlice,
  formatStaleRefreshHint,
  getStaleRefreshOps,
} from "./platform-cache.js";

describe("domain-catalog", () => {
  it("registers all API nouns from API-OBJECTS.md", () => {
    expect(DOMAIN_OBJECTS.length).toBe(22);
    const labels = DOMAIN_OBJECTS.map((entry) => entry.label);
    expect(labels).toContain("ServiceHealth");
    expect(labels).toContain("PublishedDaily");
    expect(labels).toContain("AgentDoc");
  });

  it("formats catalog and routing guide for providers", () => {
    expect(formatDomainCatalog()).toContain("RUBY OBJECTS — catalog");
    expect(formatDomainCatalog()).toContain("PlatformHappenings");
    expect(formatObjectRoutingGuide()).toContain("Sacred default");
    expect(formatObjectRoutingGuide()).toContain(
      "RUBY_OBJECTS structured views",
    );
  });

  it("suggests ops for object kinds", () => {
    expect(suggestOpForKinds(["user", "user_knowledge_profile"])).toEqual([
      "list_users",
      "get_user_knowledge",
    ]);
    expect(suggestOpForKinds(["platform_happenings", "live_room"])).toEqual([
      "poll_happenings",
    ]);
  });
});

describe("domain-views", () => {
  it("formats public-safe summaries", () => {
    expect(
      formatObjectSummary("service_health", {
        ok: true,
        ai: { enabled: false },
      }),
    ).toContain("online");
    expect(
      formatObjectSummary("user", {
        id: "u1",
        displayName: "Alice",
        level: 5,
        totalTracked: 12,
      }),
    ).toContain("Alice");
  });

  it("formats detail views with richer fields", () => {
    expect(formatObjectDetail("earned_badge", { awarded: false })).toContain(
      "not awarded",
    );
    expect(
      formatObjectDetail("user_knowledge_profile", {
        user: {
          id: "u1",
          displayName: "Alice",
          xp: 100,
          level: 3,
          totalPoints: 50,
          streak: 2,
          lastPlayedDate: "2026-06-12",
        },
        weakCategories: ["science"],
        dueQuestions: [{ id: "q1" }],
      }),
    ).toContain("streak 2");
    expect(
      formatObjectDetail("question", { id: "dyn-1", status: "hidden" }),
    ).toBe("dyn-1 is now hidden.");
    expect(
      formatObjectDetail("active_challenge", {
        id: "ch1",
        userId: "u1",
        achievementId: "daily_correct_5",
        name: "Five in a row",
        assignedDate: "2026-06-05",
        progress: 3,
        target: 5,
        completed: false,
        completedAt: null,
        assignedBy: "agent",
      }),
    ).toContain("Five in a row");
  });

  it("formats listing views for collections", () => {
    const listing = formatObjectListing("user", {
      users: [
        {
          id: "u1",
          displayName: "Alice",
          level: 3,
          totalTracked: 5,
        },
      ],
      total: 10,
      limit: 50,
      offset: 0,
    });
    expect(listing).toContain("Alice");
    expect(listing).toContain("10");
  });

  it("expands cached slices into structured views without duplicating platform counts", () => {
    const now = Date.parse("2026-06-13T12:00:00.000Z");
    const cache = {
      pulseIntervalMinutes: 5,
      happeningsTtlMinutes: 5,
      communityTtlMinutes: 15,
      health: createCacheSlice(
        "Ruby Trivia is online.",
        { online: true, publicStatus: "Ruby Trivia is online." },
        300_000,
        now - 60_000,
      ),
      happenings: createCacheSlice(
        "2 daily completions",
        {
          generatedAt: "2026-06-13T11:58:00.000Z",
          since: null,
          until: null,
          registrations: 0,
          dailyCompletions: 2,
          badgeEarns: 0,
          liveQueueWaiting: 3,
          activeLiveRooms: 1,
          timelineHighlights: [],
          timeline: [
            {
              kind: "analytics",
              at: "2026-06-13T11:57:00.000Z",
              event: "daily_quiz_completed",
              displayName: "Bob",
              summary: "Bob finished daily",
            },
          ],
          liveRooms: [
            {
              roomId: "room-1",
              phase: "waiting",
              playerCount: 2,
              createdAt: "2026-06-13T11:55:00.000Z",
            },
          ],
        },
        300_000,
        now - 60_000,
      ),
      community: createCacheSlice(
        "Weak categories: science",
        { weakCategories: ["science"] },
        900_000,
        now - 120_000,
      ),
      communityDifficulty: createCacheSlice(
        "Community struggle: science",
        {
          weakCategories: ["science"],
          weakCategoriesDetailed: [
            { category: "science", meanEasiness: 1.7, questions: 30 },
          ],
          byDifficulty: [{ difficulty: "hard", accuracy: 0.45, attempts: 200 }],
        },
        900_000,
        now - 120_000,
      ),
    };

    const views = formatCachedObjectViews(cache, now);
    expect(views).toContain("structured views");
    expect(views).toContain("HappeningTimelineItem");
    expect(views).toContain("LiveRoom");
    expect(views).toContain("WeakCategory");
    expect(views).not.toContain("PlatformHappenings (fresh");
    expect(views).not.toContain("ServiceHealth");
  });
});

describe("platform-cache stale hints", () => {
  it("maps stale slices to refresh ops", () => {
    const now = Date.parse("2026-06-13T12:00:00.000Z");
    const cache = {
      pulseIntervalMinutes: 5,
      happeningsTtlMinutes: 5,
      communityTtlMinutes: 15,
      health: createCacheSlice(
        "online",
        { online: true, publicStatus: "up" },
        60_000,
        now - 120_000,
      ),
      happenings: createCacheSlice(
        "activity",
        {
          generatedAt: null,
          since: null,
          until: null,
          registrations: 0,
          dailyCompletions: 0,
          badgeEarns: 0,
          liveQueueWaiting: 0,
          activeLiveRooms: 0,
          timelineHighlights: [],
          timeline: [],
          liveRooms: [],
        },
        60_000,
        now - 30_000,
      ),
      community: createCacheSlice(
        "weak",
        { weakCategories: [] },
        60_000,
        now - 120_000,
      ),
      communityDifficulty: createCacheSlice(
        "diff",
        {
          weakCategories: [],
          weakCategoriesDetailed: [],
          byDifficulty: [],
        },
        60_000,
        now - 30_000,
      ),
    };

    const ops = getStaleRefreshOps(cache, now);
    expect(ops).toContain("health");
    expect(ops).toContain("get_community");
    expect(ops).not.toContain("poll_happenings");

    const hint = formatStaleRefreshHint(cache, now);
    expect(hint).toContain("Stale cache");
    expect(hint).toContain("health");
  });
});
