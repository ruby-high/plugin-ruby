import type { HappeningTimelineItem } from "./types/admin.js";

/** Normalize API fingerprint values that may arrive JSON-quoted. */
export function normalizeFingerprint(value: unknown): string | null {
  if (value == null) return null;
  let s = String(value).trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s || null;
}

export type MultiAccountFingerprint = {
  deviceFingerprint?: string | null;
  userCount?: number;
  sampleUserIds?: string[] | null;
};

/**
 * Build a set of userIds that share a device fingerprint with other accounts.
 * Used to suppress farm/bot noise from Discord pulse digests.
 */
export function buildBotUserIdSet(
  clusters: MultiAccountFingerprint[] | null | undefined,
  minUsers = 2,
): Set<string> {
  const out = new Set<string>();
  if (!clusters?.length) return out;
  for (const cluster of clusters) {
    const userCount = Number(cluster.userCount ?? 0);
    if (!Number.isFinite(userCount) || userCount < minUsers) continue;
    for (const id of cluster.sampleUserIds ?? []) {
      const uid = String(id ?? "").trim();
      if (uid) out.add(uid);
    }
  }
  return out;
}

/** Crew practice score spam — high volume, low signal for Discord. */
export function isRoutineCrewActivity(item: HappeningTimelineItem): boolean {
  if (item.kind !== "crew" && item.event !== "crew_activity") return false;
  const action = String(item.data?.action ?? item.summary ?? "");
  // "scored 4,007 in film" / "scored 1,234 in a live match" — practice/live grind.
  if (/\bscored\b/i.test(action) && /\bin\b/i.test(action)) return true;
  if (/\breviewed Today's Quiz\b/i.test(action)) return true;
  return false;
}

export function itemDeviceFingerprint(
  item: HappeningTimelineItem,
): string | null {
  return normalizeFingerprint(item.data?.device_fingerprint);
}

export function isLikelyBotTimelineItem(
  item: HappeningTimelineItem,
  botUserIds: Set<string>,
  botFingerprints: Set<string> = new Set(),
): boolean {
  if (!item.userId) return false;
  if (botUserIds.has(item.userId)) return true;
  const fp = itemDeviceFingerprint(item);
  if (fp && botFingerprints.has(fp)) return true;
  return false;
}

export function buildBotFingerprintSet(
  clusters: MultiAccountFingerprint[] | null | undefined,
  minUsers = 2,
): Set<string> {
  const out = new Set<string>();
  if (!clusters?.length) return out;
  for (const cluster of clusters) {
    const userCount = Number(cluster.userCount ?? 0);
    if (!Number.isFinite(userCount) || userCount < minUsers) continue;
    const fp = normalizeFingerprint(cluster.deviceFingerprint);
    if (fp) out.add(fp);
  }
  return out;
}
