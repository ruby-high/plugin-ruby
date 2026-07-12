/**
 * RubyTriviaPulseService — scheduled platform poll, cache population, Discord alerts.
 *
 * WHY a service (not just a task):
 * - Providers read getPlatformCache() every turn without re-fetching.
 * - Snapshot state (cursor, announced keys) survives between pulse ticks.
 *
 * WHY populate platform cache here:
 * - Single writer for TTL slices; admin-ops read ops consume cache-first.
 * - Community slices refresh every 3rd pulse — SM-2 aggregates change slowly.
 */
import type { IAgentRuntime } from "@elizaos/core";
import { logger, Service } from "@elizaos/core";
import {
  formatHealthSummaryPublic,
  formatServiceUnavailablePublic,
  getHappeningsTimeline,
  rubyAdminFetch,
  rubyHealthFetch,
  summarizeCommunity,
  summarizeCommunityDifficulty,
  summarizeHappenings,
} from "../admin-client.js";
import {
  announceBackendDown,
  announceBackendRecovered,
  announceCoolEvents,
  buildLiveQueueSpikeText,
  filterNewCoolItems,
  isLiveQueueSpike,
  shouldAnnounceOutage,
} from "../announcements.js";
import {
  buildBotFingerprintSet,
  buildBotUserIdSet,
} from "../bot-filter.js";
import {
  BOT_FILTER_REFRESH_EVERY_PULSES,
  COMMUNITY_REFRESH_EVERY_PULSES,
  resolveRubyTriviaConfig,
} from "../config.js";
import {
  communityTtlMs,
  createCacheSlice,
  emptyPlatformCache,
  happeningsTtlMs,
  isCacheSliceFresh,
  markCacheSliceStale,
  type RubyPlatformCache,
} from "../platform-cache.js";
import {
  happeningDedupKey,
  loadPulseState,
  markAnnouncedKeys,
  resolveSinceParam,
  savePulseCursor,
} from "../pulse-state.js";
import type {
  CommunityDifficulty,
  CommunityOverview,
  PlatformHappenings,
} from "../types/admin.js";

export const RUBY_TRIVIA_PULSE_SERVICE_TYPE = "ruby_trivia_pulse" as const;

export type RubyTriviaPulseSnapshot = {
  lastGeneratedAt: string | null;
  lastSummary: string | null;
  lastPollAt: string | null;
  lastError: string | null;
  liveQueueWaiting: number;
  recentHighlights: string[];
  backendReachable: boolean | null;
  consecutiveFailures: number;
};

export class RubyTriviaPulseService extends Service {
  static override serviceType = RUBY_TRIVIA_PULSE_SERVICE_TYPE;
  readonly capabilityDescription =
    "Polls Ruby Trivia, caches platform state with freshness guarantees, and posts Discord digests/outage alerts.";

  private lastGeneratedAt: string | null = null;
  private announcedKeys = new Set<string>();
  private lastSummary: string | null = null;
  private lastPollAt: string | null = null;
  private lastError: string | null = null;
  private liveQueueWaiting = 0;
  private previousQueueWaiting = 0;
  private recentHighlights: string[] = [];
  private backendReachable: boolean | null = null;
  private consecutiveFailures = 0;
  private pulseCount = 0;
  private platformCache: RubyPlatformCache = emptyPlatformCache();
  private pulseInFlight = false;
  /** Cached bot filter — refreshed every BOT_FILTER_REFRESH_EVERY_PULSES. */
  private cachedBotFilter: {
    botUserIds: Set<string>;
    botFingerprints: Set<string>;
  } | null = null;

  static override async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new RubyTriviaPulseService(runtime);
    const state = loadPulseState(runtime);
    service.lastGeneratedAt = state.lastGeneratedAt;
    service.announcedKeys = state.announcedKeys;
    const config = resolveRubyTriviaConfig(runtime);
    service.platformCache = emptyPlatformCache(config.pulseIntervalMinutes);
    return service;
  }

  override async stop(): Promise<void> {}

  getSnapshot(): RubyTriviaPulseSnapshot {
    return {
      lastGeneratedAt: this.lastGeneratedAt,
      lastSummary: this.lastSummary,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      liveQueueWaiting: this.liveQueueWaiting,
      recentHighlights: [...this.recentHighlights],
      backendReachable: this.backendReachable,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  getPlatformCache(): RubyPlatformCache {
    this.refreshStaleFlags();
    return this.platformCache;
  }

  isHappeningsCacheFresh(now = Date.now()): boolean {
    return isCacheSliceFresh(this.platformCache.happenings, now);
  }

  isCommunityCacheFresh(now = Date.now()): boolean {
    return (
      isCacheSliceFresh(this.platformCache.community, now) ||
      isCacheSliceFresh(this.platformCache.communityDifficulty, now)
    );
  }

  private refreshStaleFlags(now = Date.now()): void {
    const cache = this.platformCache;
    if (
      cache.happenings.fetchedAt &&
      !isCacheSliceFresh(cache.happenings, now)
    ) {
      cache.happenings = markCacheSliceStale(cache.happenings);
    }
    if (cache.community.fetchedAt && !isCacheSliceFresh(cache.community, now)) {
      cache.community = markCacheSliceStale(cache.community);
    }
    if (
      cache.communityDifficulty.fetchedAt &&
      !isCacheSliceFresh(cache.communityDifficulty, now)
    ) {
      cache.communityDifficulty = markCacheSliceStale(
        cache.communityDifficulty,
      );
    }
    if (cache.health.fetchedAt && !isCacheSliceFresh(cache.health, now)) {
      cache.health = markCacheSliceStale(cache.health);
    }
  }

  async runPulse(): Promise<void> {
    if (this.pulseInFlight) {
      logger.debug("[RubyTriviaPulseService] pulse already in flight — skipping");
      return;
    }
    this.pulseInFlight = true;
    try {
      await this.runPulseInner();
    } finally {
      this.pulseInFlight = false;
    }
  }

  private async runPulseInner(): Promise<void> {
    const config = resolveRubyTriviaConfig(this.runtime);
    if (!config.analyticsSecret || !config.pulseEnabled) {
      return;
    }

    this.platformCache.pulseIntervalMinutes = config.pulseIntervalMinutes;
    this.platformCache.happeningsTtlMinutes = config.pulseIntervalMinutes;
    this.platformCache.communityTtlMinutes =
      config.pulseIntervalMinutes * COMMUNITY_REFRESH_EVERY_PULSES;

    this.lastPollAt = new Date().toISOString();
    this.pulseCount += 1;

    const health = await rubyHealthFetch(this.runtime);
    if (!health.ok) {
      await this.handleOutage(health.message);
      return;
    }

    const healthTtl = happeningsTtlMs(config.pulseIntervalMinutes);
    const publicStatus = formatHealthSummaryPublic(health.data);
    this.platformCache.health = createCacheSlice(
      publicStatus,
      { online: true, publicStatus },
      healthTtl,
    );

    const since = resolveSinceParam(this.lastGeneratedAt);
    const happenings = await rubyAdminFetch<PlatformHappenings>(
      this.runtime,
      "GET",
      `/api/admin/happenings?since=${encodeURIComponent(since)}&limit=200`,
    );
    if (!happenings.ok) {
      await this.handleOutage(happenings.message);
      return;
    }

    if (this.backendReachable === false) {
      await announceBackendRecovered(this.runtime);
    }

    this.backendReachable = true;
    this.consecutiveFailures = 0;
    this.lastError = null;

    const payload = happenings.data;
    const timeline = getHappeningsTimeline(payload);
    if (!payload.generatedAt) {
      logger.warn(
        { responseKeys: Object.keys(payload as object) },
        "[RubyTriviaPulseService] happenings response missing generatedAt — empty or outdated API host?",
      );
    }
    this.previousQueueWaiting = this.liveQueueWaiting;
    this.liveQueueWaiting = payload.live?.queueWaiting ?? 0;
    if (payload.generatedAt) {
      this.lastGeneratedAt = payload.generatedAt;
    }
    this.lastSummary = summarizeHappenings(payload);
    this.recentHighlights = timeline
      .slice(0, 8)
      .map((item) => item.summary)
      .filter(Boolean);

    this.platformCache.happenings = createCacheSlice(
      this.lastSummary,
      {
        generatedAt: payload.generatedAt,
        since: payload.since ?? null,
        until: payload.until ?? null,
        registrations: payload.summary?.registrations ?? 0,
        dailyCompletions: payload.summary?.dailyCompletions ?? 0,
        badgeEarns: payload.summary?.badgeEarns ?? 0,
        liveQueueWaiting: this.liveQueueWaiting,
        activeLiveRooms: payload.summary?.activeLiveRooms ?? 0,
        timelineHighlights: [...this.recentHighlights],
        timeline: timeline.slice(0, 12).map((item) => ({
          kind: item.kind,
          at: item.at,
          event: item.event,
          displayName: item.displayName,
          summary: item.summary,
        })),
        liveRooms: (payload.live?.rooms ?? []).map((room) => ({
          roomId: room.roomId,
          phase: room.phase,
          playerCount: room.playerCount,
          createdAt: room.createdAt,
        })),
      },
      healthTtl,
    );

    if (payload.generatedAt) {
      savePulseCursor(this.runtime, payload.generatedAt);
    }

    if (this.pulseCount % COMMUNITY_REFRESH_EVERY_PULSES === 0) {
      await this.refreshCommunityCache(config.pulseIntervalMinutes);
    }

    const { botUserIds, botFingerprints } = await this.getBotFilterSets();
    const coolItems = filterNewCoolItems(
      timeline,
      this.announcedKeys,
      botUserIds,
      botFingerprints,
    );
    const queueSpike = isLiveQueueSpike(
      this.previousQueueWaiting,
      this.liveQueueWaiting,
    );
    const queueSpikeText = queueSpike
      ? buildLiveQueueSpikeText(this.liveQueueWaiting)
      : null;

    if (coolItems.length > 0 || queueSpikeText) {
      await announceCoolEvents(
        this.runtime,
        coolItems,
        queueSpikeText,
      );
      // Mark after attempt so Discord success/failure cannot re-post the same digest.
      // Durable pulse-state.json keeps this across restarts (setSetting alone does not).
      const keys = coolItems.map((item) => happeningDedupKey(item));
      if (queueSpikeText && payload.generatedAt) {
        keys.push(`queue-spike:${payload.generatedAt}`);
      }
      this.announcedKeys = markAnnouncedKeys(
        this.runtime,
        keys,
        this.announcedKeys,
      );
    }

    logger.info(
      {
        generatedAt: payload.generatedAt,
        coolItems: coolItems.length,
        queueWaiting: this.liveQueueWaiting,
        communityRefreshed:
          this.pulseCount % COMMUNITY_REFRESH_EVERY_PULSES === 0,
      },
      "[RubyTriviaPulseService] pulse complete",
    );
  }


  /**
   * Refresh bot filter on the same cadence as community (15m default), reuse between pulses.
   */
  private async getBotFilterSets(): Promise<{
    botUserIds: Set<string>;
    botFingerprints: Set<string>;
  }> {
    const shouldRefresh =
      this.cachedBotFilter === null ||
      this.pulseCount % BOT_FILTER_REFRESH_EVERY_PULSES === 0;
    if (shouldRefresh) {
      this.cachedBotFilter = await this.loadBotFilterSets();
    }
    return this.cachedBotFilter!;
  }

  /**
   * Load multi-account fingerprint clusters for digest filtering.
   * Fail-open: if the analytics call fails, announce without bot suppression.
   * WHY fields=multiAccount: full report ran 4 heavy aggregations; pulse only needs clusters.
   */
  private async loadBotFilterSets(): Promise<{
    botUserIds: Set<string>;
    botFingerprints: Set<string>;
  }> {
    const empty = {
      botUserIds: new Set<string>(),
      botFingerprints: new Set<string>(),
    };
    try {
      const result = await rubyAdminFetch<{
        multiAccountFingerprints?: Array<{
          deviceFingerprint?: string | null;
          userCount?: number;
          sampleUserIds?: string[];
        }>;
      }>(
        this.runtime,
        "GET",
        "/api/analytics/device-fingerprints?minUsers=2&fields=multiAccount",
      );
      if (!result.ok) {
        logger.warn(
          { message: result.message },
          "[RubyTriviaPulseService] bot fingerprint filter unavailable — announcing without suppression",
        );
        return empty;
      }
      const clusters = result.data.multiAccountFingerprints ?? [];
      const botUserIds = buildBotUserIdSet(clusters);
      const botFingerprints = buildBotFingerprintSet(clusters);
      if (botUserIds.size > 0 || botFingerprints.size > 0) {
        logger.debug(
          {
            botUserIds: botUserIds.size,
            botFingerprints: botFingerprints.size,
            clusters: clusters.length,
          },
          "[RubyTriviaPulseService] bot filter loaded",
        );
      }
      return { botUserIds, botFingerprints };
    } catch (error) {
      logger.warn(
        { error },
        "[RubyTriviaPulseService] bot fingerprint filter failed — announcing without suppression",
      );
      return empty;
    }
  }

  private async refreshCommunityCache(
    pulseIntervalMinutes: number,
  ): Promise<void> {
    const ttl = communityTtlMs(pulseIntervalMinutes);
    const community = await rubyAdminFetch<CommunityOverview>(
      this.runtime,
      "GET",
      "/api/admin/community",
    );
    if (community.ok) {
      const summary = summarizeCommunity(community.data);
      const weakCategories =
        community.data.weakCategories
          ?.map((entry) => entry.category)
          .filter(Boolean) ?? [];
      this.platformCache.community = createCacheSlice(
        summary,
        { weakCategories },
        ttl,
      );
    }

    const difficulty = await rubyAdminFetch<CommunityDifficulty>(
      this.runtime,
      "GET",
      "/api/admin/community/difficulty",
    );
    if (difficulty.ok) {
      const summary = summarizeCommunityDifficulty(difficulty.data);
      const weakCategories =
        difficulty.data.weakCategories
          ?.map((entry) => entry.category)
          .filter(Boolean) ?? [];
      const weakCategoriesDetailed =
        difficulty.data.weakCategories?.map((entry) => ({
          category: entry.category,
          meanEasiness: entry.meanEasiness,
          questions: entry.questions,
        })) ?? [];
      const byDifficulty =
        difficulty.data.byDifficulty?.map((entry) => ({
          difficulty: entry.difficulty,
          accuracy: entry.accuracy,
          attempts: entry.attempts,
        })) ?? [];
      this.platformCache.communityDifficulty = createCacheSlice(
        summary,
        { weakCategories, weakCategoriesDetailed, byDifficulty },
        ttl,
      );
    }
  }

  private async handleOutage(errorMessage: string): Promise<void> {
    this.backendReachable = false;
    this.consecutiveFailures += 1;
    this.lastError = errorMessage;

    const config = resolveRubyTriviaConfig(this.runtime);
    const healthTtl = happeningsTtlMs(config.pulseIntervalMinutes);
    const publicStatus = formatServiceUnavailablePublic();
    this.platformCache.health = createCacheSlice(
      publicStatus,
      { online: false, publicStatus },
      healthTtl,
    );
    this.platformCache.happenings = markCacheSliceStale(
      this.platformCache.happenings,
    );
    this.platformCache.community = markCacheSliceStale(
      this.platformCache.community,
    );
    this.platformCache.communityDifficulty = markCacheSliceStale(
      this.platformCache.communityDifficulty,
    );

    if (shouldAnnounceOutage(this.consecutiveFailures)) {
      await announceBackendDown(
        this.runtime,
        errorMessage,
        this.consecutiveFailures,
      );
    }

    logger.error(
      {
        error: errorMessage,
        consecutiveFailures: this.consecutiveFailures,
        baseUrl: config.baseUrl,
      },
      "[RubyTriviaPulseService] pulse failed",
    );
  }
}
