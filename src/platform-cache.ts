/**
 * Platform cache — TTL-bound slices populated by RubyTriviaPulseService.
 *
 * WHY a cache layer (not provider-only fetch):
 * - Pulse already pays for happenings/community API calls every 5–15m.
 * - Read ops and RUBY_PLATFORM should not re-hit the API every chat turn.
 * - Freshness flags tell the LLM when to call RUBY_TRIVIA for a refresh.
 *
 * WHY split PLATFORM vs OBJECTS output:
 * - PLATFORM: operational dashboard (counts, highlights, stale refresh ops).
 * - OBJECTS: structured listing/detail shapes — see domain-views.ts.
 */
import type { ProviderValue } from "@elizaos/core";
import {
  COMMUNITY_REFRESH_EVERY_PULSES,
  DEFAULT_PULSE_INTERVAL_MINUTES,
} from "./config.js";
import { suggestOpForKinds } from "./domain-catalog.js";
import type {
  CachedTimelineItem,
  DifficultyTierRow,
  DomainObjectKind,
  LiveRoom,
  WeakCategoryDetail,
} from "./types/domain.js";

export type CacheSlice<T> = {
  fetchedAt: string | null;
  freshUntil: string | null;
  stale: boolean;
  summary: string | null;
  data: T | null;
};

export type HappeningsCacheData = {
  generatedAt: string | null;
  since: string | null;
  until: string | null;
  registrations: number;
  dailyCompletions: number;
  badgeEarns: number;
  liveQueueWaiting: number;
  activeLiveRooms: number;
  timelineHighlights: string[];
  timeline: CachedTimelineItem[];
  liveRooms: LiveRoom[];
};

export type CommunityCacheData = {
  weakCategories: string[];
};

export type CommunityDifficultyCacheData = {
  weakCategories: string[];
  weakCategoriesDetailed: WeakCategoryDetail[];
  byDifficulty: DifficultyTierRow[];
};

export type HealthCacheData = {
  online: boolean;
  publicStatus: string;
};

export type RubyPlatformCache = {
  pulseIntervalMinutes: number;
  happeningsTtlMinutes: number;
  communityTtlMinutes: number;
  happenings: CacheSlice<HappeningsCacheData>;
  community: CacheSlice<CommunityCacheData>;
  communityDifficulty: CacheSlice<CommunityDifficultyCacheData>;
  health: CacheSlice<HealthCacheData>;
};

export function emptyPlatformCache(
  pulseIntervalMinutes = DEFAULT_PULSE_INTERVAL_MINUTES,
): RubyPlatformCache {
  const empty = <T>(): CacheSlice<T> => ({
    fetchedAt: null,
    freshUntil: null,
    stale: true,
    summary: null,
    data: null,
  });
  return {
    pulseIntervalMinutes,
    happeningsTtlMinutes: pulseIntervalMinutes,
    communityTtlMinutes: pulseIntervalMinutes * COMMUNITY_REFRESH_EVERY_PULSES,
    happenings: empty(),
    community: empty(),
    communityDifficulty: empty(),
    health: empty(),
  };
}

export function happeningsTtlMs(pulseIntervalMinutes: number): number {
  return pulseIntervalMinutes * 60_000;
}

export function communityTtlMs(pulseIntervalMinutes: number): number {
  return pulseIntervalMinutes * COMMUNITY_REFRESH_EVERY_PULSES * 60_000;
}

export function createCacheSlice<T>(
  summary: string,
  data: T,
  ttlMs: number,
  now = Date.now(),
): CacheSlice<T> {
  const fetchedAt = new Date(now).toISOString();
  const freshUntil = new Date(now + ttlMs).toISOString();
  return {
    fetchedAt,
    freshUntil,
    stale: false,
    summary,
    data,
  };
}

export function markCacheSliceStale<T>(slice: CacheSlice<T>): CacheSlice<T> {
  return { ...slice, stale: true };
}

export function isCacheSliceFresh<T>(
  slice: CacheSlice<T>,
  now = Date.now(),
): boolean {
  if (!slice.fetchedAt || !slice.freshUntil || !slice.data) return false;
  return new Date(slice.freshUntil).getTime() > now;
}

function formatAge(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const minutes = Math.max(
    0,
    Math.round((now - new Date(iso).getTime()) / 60_000),
  );
  if (minutes === 0) return "just now";
  if (minutes === 1) return "1m ago";
  return `${minutes}m ago`;
}

function formatSliceLine(
  label: string,
  slice: CacheSlice<unknown>,
  ttlMinutes: number,
  now = Date.now(),
): string {
  const age = formatAge(slice.fetchedAt, now);
  const status = isCacheSliceFresh(slice, now)
    ? `fresh ≤${ttlMinutes}m`
    : "stale — use RUBY_TRIVIA to refresh before precise write ops";
  const body = slice.summary ?? "no data yet";
  return `${label} (${age}, ${status}): ${body}`;
}

/** Stale cache slices → deduped RUBY_TRIVIA ops for refresh hints. */
export function getStaleRefreshOps(
  cache: RubyPlatformCache,
  now = Date.now(),
): string[] {
  const staleKinds: DomainObjectKind[] = [];
  if (cache.health.fetchedAt && !isCacheSliceFresh(cache.health, now)) {
    staleKinds.push("service_health");
  }
  if (cache.happenings.fetchedAt && !isCacheSliceFresh(cache.happenings, now)) {
    staleKinds.push(
      "platform_happenings",
      "happening_timeline_item",
      "live_snapshot",
      "live_room",
    );
  }
  if (cache.community.fetchedAt && !isCacheSliceFresh(cache.community, now)) {
    staleKinds.push("community_overview");
  }
  if (
    cache.communityDifficulty.fetchedAt &&
    !isCacheSliceFresh(cache.communityDifficulty, now)
  ) {
    staleKinds.push("community_difficulty", "weak_category");
  }
  return suggestOpForKinds(staleKinds);
}

export function formatStaleRefreshHint(
  cache: RubyPlatformCache,
  now = Date.now(),
): string {
  const ops = getStaleRefreshOps(cache, now);
  if (ops.length === 0) return "";
  return `Stale cache — refresh via RUBY_TRIVIA: ${ops.join(", ")}`;
}

/** Provider-facing block — public-safe summaries only. */
export function formatPlatformCacheForProvider(
  cache: RubyPlatformCache,
  now = Date.now(),
): { text: string; values: Record<string, ProviderValue> } {
  const lines = [
    "[RUBY PLATFORM]",
    "Answer player/game questions from this cache when fresh. Do not expose URLs, hosts, or model names.",
    formatSliceLine("Health", cache.health, cache.pulseIntervalMinutes, now),
    formatSliceLine(
      "Happenings",
      cache.happenings,
      cache.happeningsTtlMinutes,
      now,
    ),
    formatSliceLine(
      "Community struggle",
      cache.community,
      cache.communityTtlMinutes,
      now,
    ),
    formatSliceLine(
      "Difficulty breakdown",
      cache.communityDifficulty,
      cache.communityTtlMinutes,
      now,
    ),
  ];

  if (cache.happenings.data) {
    const h = cache.happenings.data;
    lines.push(
      `Counts: registrations ${h.registrations}, daily completions ${h.dailyCompletions}, badge earns ${h.badgeEarns}, live queue ${h.liveQueueWaiting}, active rooms ${h.activeLiveRooms}`,
    );
    if (h.timelineHighlights.length > 0) {
      lines.push(`Recent moments: ${h.timelineHighlights.join("; ")}`);
    }
  }

  const weak =
    cache.communityDifficulty.data?.weakCategories ??
    cache.community.data?.weakCategories ??
    [];
  if (weak.length > 0) {
    lines.push(`Weak categories: ${weak.join(", ")}`);
  }

  const staleHint = formatStaleRefreshHint(cache, now);
  if (staleHint) {
    lines.push(staleHint);
  }

  return {
    text: lines.join("\n"),
    values: {
      platformCacheFresh: isCacheSliceFresh(cache.happenings, now),
      happeningsSummary: cache.happenings.summary ?? "",
      communitySummary: cache.community.summary ?? "",
      healthStatus: cache.health.data?.publicStatus ?? "unknown",
      liveQueueWaiting: cache.happenings.data?.liveQueueWaiting ?? 0,
    },
  };
}
