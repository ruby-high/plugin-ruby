import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import {
  OUTAGE_ALERT_EVERY_POLL_UNTIL,
  OUTAGE_ALERT_THROTTLE_EVERY,
  resolveRubyTriviaConfig,
} from "./config.js";
import { happeningDedupKey } from "./pulse-state.js";
import {
  isLikelyBotTimelineItem,
  isRoutineCrewActivity,
} from "./bot-filter.js";
import type { HappeningTimelineItem } from "./types/admin.js";

/** Worth celebrating in Discord — aligned with ruby-trivia/docs/RUBY-AGENT.md pulse signals. */
const COOL_ANALYTICS_EVENTS = new Set([
  "badge_earned",
  "user_registered",
  "referral_signup",
  "rush_hour_completed",
  "friend_added",
]);

/** High-volume noise — would spam Discord if announced every poll. */
const ROUTINE_EVENTS = new Set([
  "answer_submitted",
  "user_login",
  "login_failed",
  "referral_landing",
]);

export function shouldAnnounceOutage(consecutiveFailures: number): boolean {
  if (consecutiveFailures <= OUTAGE_ALERT_EVERY_POLL_UNTIL) return true;
  // After the first 30 minutes (6 polls at 5 min), alert every 15 minutes.
  return (
    (consecutiveFailures - OUTAGE_ALERT_EVERY_POLL_UNTIL) %
      OUTAGE_ALERT_THROTTLE_EVERY ===
    0
  );
}

export function isCoolTimelineItem(item: HappeningTimelineItem): boolean {
  // Crew practice scores flood the feed; only celebrate non-routine crew moments.
  if (item.kind === "crew") return !isRoutineCrewActivity(item);
  if (ROUTINE_EVENTS.has(item.event)) return false;
  if (COOL_ANALYTICS_EVENTS.has(item.event)) return true;
  if (item.event === "daily_quiz_completed") {
    const streak = Number(item.data?.new_streak ?? item.data?.streak ?? 0);
    return Number.isFinite(streak) && streak >= 5;
  }
  return false;
}

export function isLiveQueueSpike(
  previousQueueWaiting: number,
  currentQueueWaiting: number,
): boolean {
  // 0 → N: first players waiting — worth a nudge to join live play.
  return previousQueueWaiting <= 0 && currentQueueWaiting > 0;
}

export function filterNewCoolItems(
  timeline: HappeningTimelineItem[],
  announcedKeys: Set<string>,
  botUserIds: Set<string> = new Set(),
  botFingerprints: Set<string> = new Set(),
): HappeningTimelineItem[] {
  return timeline.filter((item) => {
    if (!isCoolTimelineItem(item)) return false;
    if (isLikelyBotTimelineItem(item, botUserIds, botFingerprints)) return false;
    return !announcedKeys.has(happeningDedupKey(item));
  });
}

export function buildDigestText(items: HappeningTimelineItem[]): string {
  const lines = items
    .slice(0, 8)
    .map((item) => `• ${item.summary}`)
    .filter(Boolean);
  const overflow = items.length > 8 ? items.length - 8 : 0;
  const body = lines.join("\n");
  const suffix = overflow > 0 ? `\n…and ${overflow} more` : "";
  return `Ruby Trivia pulse\n${body}${suffix}`;
}

export function buildOutageAlertText(
  _baseUrl: string,
  _errorMessage: string,
  consecutiveFailures: number,
  pulseIntervalMinutes: number,
): string {
  const minutesDown = consecutiveFailures * pulseIntervalMinutes;
  const templates = [
    `🚨 RUBY TRIVIA IS DOWN 🚨\nThe platform backend is unreachable.\nPlayers may not get dailies, live queue, or grades.\nOutage ~${minutesDown} minutes (check #${consecutiveFailures}). Ops: investigate server.`,
    `🚨 STILL DOWN — RUBY TRIVIA 🚨\nBackend still not responding.\n~${minutesDown} minutes without a pulse. Ops: restart trivia services.`,
    `🚨 RUBY TRIVIA OUTAGE CONTINUES 🚨\nPlatform backend unreachable.\n${consecutiveFailures} failed checks (~${minutesDown} min). Ops needed.`,
    `🚨 PLATFORM DOWN 🚨\nRuby Trivia backend unreachable.\n~${minutesDown} minutes down. Ops: fix ASAP.`,
  ];
  // Rotate copy so repeated alerts stay noticeable in busy channels.
  const index =
    consecutiveFailures >= 3 ? (consecutiveFailures - 1) % templates.length : 0;
  return templates[index] ?? templates[0];
}

export function buildRecoveryText(_baseUrl: string): string {
  return "✅ Ruby Trivia is back online — resuming pulse.";
}

export function buildLiveQueueSpikeText(queueWaiting: number): string {
  return `• ${queueWaiting} player${queueWaiting === 1 ? "" : "s"} waiting in live queue — jump in!`;
}

/** Connector-agnostic send — never throws; pulse loop must survive Discord misconfig. */
export async function sendDiscordAnnouncement(
  runtime: IAgentRuntime,
  text: string,
): Promise<boolean> {
  const config = resolveRubyTriviaConfig(runtime);
  if (!config.discordChannelId || !config.discordAnnounceEnabled) {
    return false;
  }
  if (typeof runtime.sendMessageToTarget !== "function") {
    logger.warn("[plugin-ruby] Discord send handler not registered");
    return false;
  }
  try {
    await runtime.sendMessageToTarget(
      {
        source: "discord",
        accountId: config.discordAccountId,
        channelId: config.discordChannelId,
      },
      { text, source: "ruby" },
    );
    return true;
  } catch (error) {
    logger.error({ error }, "[plugin-ruby] Discord announcement failed");
    return false;
  }
}

export async function announceCoolEvents(
  runtime: IAgentRuntime,
  items: HappeningTimelineItem[],
  liveQueueSpikeText?: string | null,
): Promise<boolean> {
  const digestItems = [...items];
  const lines: string[] = [];
  if (digestItems.length > 0) {
    lines.push(buildDigestText(digestItems));
  }
  if (liveQueueSpikeText) {
    lines.push(
      digestItems.length > 0
        ? liveQueueSpikeText
        : `Ruby Trivia pulse\n${liveQueueSpikeText}`,
    );
  }
  if (!lines.length) return false;
  return sendDiscordAnnouncement(runtime, lines.join("\n"));
}

export async function announceBackendDown(
  runtime: IAgentRuntime,
  errorMessage: string,
  consecutiveFailures: number,
): Promise<boolean> {
  const config = resolveRubyTriviaConfig(runtime);
  const text = buildOutageAlertText(
    config.baseUrl,
    errorMessage,
    consecutiveFailures,
    config.pulseIntervalMinutes,
  );
  return sendDiscordAnnouncement(runtime, text);
}

export async function announceBackendRecovered(
  runtime: IAgentRuntime,
): Promise<boolean> {
  const config = resolveRubyTriviaConfig(runtime);
  return sendDiscordAnnouncement(runtime, buildRecoveryText(config.baseUrl));
}
