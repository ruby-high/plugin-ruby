/**
 * Durable store for bullpost tweet candidates + one-shot locks.
 *
 * WHY file-backed: runtime settings reset on restart; locks must survive so the
 * same copy cannot be tweeted twice after a process bounce.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "@elizaos/core";

export type BullpostTweetStatus =
  | "pending"
  | "posting"
  | "posted"
  | "failed";

export type BullpostTweetRecord = {
  id: string;
  text: string;
  fingerprint: string;
  status: BullpostTweetStatus;
  createdAt: string;
  discordMessageId: string | null;
  discordChannelId: string | null;
  tweetId: string | null;
  tweetUrl: string | null;
  postedAt: string | null;
  postedBy: string | null;
  error: string | null;
};

type StoreFile = {
  records: Record<string, BullpostTweetRecord>;
  /** Fingerprints that have successfully posted — permanent lock. */
  lockedFingerprints: string[];
};

const LOCKED_MAX = 2_000;

export function resolveBullpostTweetStorePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveStateDir(env), "plugin-ruby", "bullpost-tweets.json");
}

/** Normalize for duplicate detection across slight whitespace/case drift. */
export function fingerprintBullpostText(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

export function createBullpostTweetId(): string {
  return crypto.randomBytes(6).toString("hex"); // 12 chars — fits custom_id budget
}

function emptyStore(): StoreFile {
  return { records: {}, lockedFingerprints: [] };
}

function readStore(): StoreFile {
  const filePath = resolveBullpostTweetStorePath();
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyStore();
    }
    const obj = parsed as Partial<StoreFile>;
    return {
      records:
        obj.records && typeof obj.records === "object" && !Array.isArray(obj.records)
          ? (obj.records as Record<string, BullpostTweetRecord>)
          : {},
      lockedFingerprints: Array.isArray(obj.lockedFingerprints)
        ? obj.lockedFingerprints.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: StoreFile): void {
  const filePath = resolveBullpostTweetStorePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const locked = store.lockedFingerprints.slice(-LOCKED_MAX);
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    `${JSON.stringify({ ...store, lockedFingerprints: locked }, null, 2)}\n`,
    "utf8",
  );
  fs.renameSync(tmp, filePath);
}

export function isBullpostFingerprintLocked(fingerprint: string): boolean {
  return readStore().lockedFingerprints.includes(fingerprint);
}

export function getBullpostTweetRecord(id: string): BullpostTweetRecord | null {
  return readStore().records[id] ?? null;
}

export function registerPendingBullpostTweet(opts: {
  text: string;
  discordMessageId?: string | null;
  discordChannelId?: string | null;
}): BullpostTweetRecord {
  const store = readStore();
  const fingerprint = fingerprintBullpostText(opts.text);
  const id = createBullpostTweetId();
  const record: BullpostTweetRecord = {
    id,
    text: opts.text.trim(),
    fingerprint,
    status: "pending",
    createdAt: new Date().toISOString(),
    discordMessageId: opts.discordMessageId ?? null,
    discordChannelId: opts.discordChannelId ?? null,
    tweetId: null,
    tweetUrl: null,
    postedAt: null,
    postedBy: null,
    error: null,
  };
  store.records[id] = record;
  writeStore(store);
  return record;
}

export function updateBullpostTweetRecord(
  id: string,
  patch: Partial<BullpostTweetRecord>,
): BullpostTweetRecord | null {
  const store = readStore();
  const current = store.records[id];
  if (!current) return null;
  const next = { ...current, ...patch, id: current.id };
  store.records[id] = next;
  writeStore(store);
  return next;
}

/**
 * Atomically claim a post for tweeting.
 * Returns the record if this caller owns the attempt; null if locked / racing.
 */
export function claimBullpostTweetForPosting(
  id: string,
):
  | { ok: true; record: BullpostTweetRecord }
  | { ok: false; reason: "missing" | "locked" | "already_posted" | "in_flight" } {
  const store = readStore();
  const record = store.records[id];
  if (!record) return { ok: false, reason: "missing" };
  if (record.status === "posted" || store.lockedFingerprints.includes(record.fingerprint)) {
    return { ok: false, reason: "already_posted" };
  }
  if (record.status === "posting") {
    return { ok: false, reason: "in_flight" };
  }
  if (isBullpostFingerprintLocked(record.fingerprint)) {
    return { ok: false, reason: "locked" };
  }
  record.status = "posting";
  store.records[id] = record;
  writeStore(store);
  return { ok: true, record };
}

export function finalizeBullpostTweetPosted(opts: {
  id: string;
  tweetId: string;
  tweetUrl: string;
  postedBy: string;
}): BullpostTweetRecord | null {
  const store = readStore();
  const record = store.records[opts.id];
  if (!record) return null;
  record.status = "posted";
  record.tweetId = opts.tweetId;
  record.tweetUrl = opts.tweetUrl;
  record.postedAt = new Date().toISOString();
  record.postedBy = opts.postedBy;
  record.error = null;
  store.records[opts.id] = record;
  if (!store.lockedFingerprints.includes(record.fingerprint)) {
    store.lockedFingerprints.push(record.fingerprint);
  }
  // Lock any other pending records with the same fingerprint
  for (const other of Object.values(store.records)) {
    if (
      other.id !== opts.id &&
      other.fingerprint === record.fingerprint &&
      other.status !== "posted"
    ) {
      other.status = "posted";
      other.tweetId = opts.tweetId;
      other.tweetUrl = opts.tweetUrl;
      other.postedAt = record.postedAt;
      other.postedBy = opts.postedBy;
      other.error = "duplicate_locked";
      store.records[other.id] = other;
    }
  }
  writeStore(store);
  return record;
}

export function releaseBullpostTweetClaim(
  id: string,
  error: string,
): BullpostTweetRecord | null {
  const store = readStore();
  const record = store.records[id];
  if (!record) return null;
  if (record.status === "posted") return record;
  record.status = "failed";
  record.error = error;
  store.records[id] = record;
  writeStore(store);
  return record;
}

export const RUBY_TWEET_CUSTOM_ID_PREFIX = "ruby_tw:";

export function buildRubyTweetCustomId(id: string): string {
  return `${RUBY_TWEET_CUSTOM_ID_PREFIX}${id}`;
}

export function parseRubyTweetCustomId(customId: string): string | null {
  if (!customId.startsWith(RUBY_TWEET_CUSTOM_ID_PREFIX)) return null;
  const id = customId.slice(RUBY_TWEET_CUSTOM_ID_PREFIX.length).trim();
  return /^[a-f0-9]{8,24}$/i.test(id) ? id : null;
}
