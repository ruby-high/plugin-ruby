/**
 * Durable daily bullpost campaign state.
 *
 * WHY file-backed: runtime.setSetting is in-memory only; restarts would lose the
 * day's selected marketing aspect and the previous tweet thread.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "@elizaos/core";

export type BullpostCampaignState = {
  /** UTC calendar day `YYYY-MM-DD` this campaign belongs to. */
  dayKey: string;
  siteUrl: string;
  scrapedAt: string | null;
  /** Reduced marketing angles extracted from the site. */
  marketingPoints: string[];
  /** Randomly chosen focus for today's Discord iterations. */
  selectedAspect: string | null;
  selectedAspectIndex: number | null;
  /** Last suggested bullpost body (without Discord wrapper). */
  previousPost: string | null;
  previousPostedAt: string | null;
  /** How many Discord suggestions posted for this day/aspect. */
  iteration: number;
  /** Last judge critique — fed into the next 30m iteration. */
  lastJudgeNotes: string | null;
  lastJudgeScore: number | null;
};

type CampaignFile = Partial<BullpostCampaignState>;

export function resolveBullpostCampaignStatePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(
    resolveStateDir(env),
    "plugin-ruby",
    "bullpost-campaign.json",
  );
}

export function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function emptyCampaignState(
  dayKey = utcDayKey(),
  siteUrl = "",
): BullpostCampaignState {
  return {
    dayKey,
    siteUrl,
    scrapedAt: null,
    marketingPoints: [],
    selectedAspect: null,
    selectedAspectIndex: null,
    previousPost: null,
    previousPostedAt: null,
    iteration: 0,
    lastJudgeNotes: null,
    lastJudgeScore: null,
  };
}

function readCampaignFile(): CampaignFile | null {
  const filePath = resolveBullpostCampaignStatePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as CampaignFile;
  } catch {
    return null;
  }
}

export function loadBullpostCampaignState(
  env: NodeJS.ProcessEnv = process.env,
): BullpostCampaignState {
  const raw = readCampaignFile();
  if (!raw) return emptyCampaignState();
  return {
    dayKey: typeof raw.dayKey === "string" ? raw.dayKey : utcDayKey(),
    siteUrl: typeof raw.siteUrl === "string" ? raw.siteUrl : "",
    scrapedAt: typeof raw.scrapedAt === "string" ? raw.scrapedAt : null,
    marketingPoints: Array.isArray(raw.marketingPoints)
      ? raw.marketingPoints.filter((p): p is string => typeof p === "string")
      : [],
    selectedAspect:
      typeof raw.selectedAspect === "string" ? raw.selectedAspect : null,
    selectedAspectIndex:
      typeof raw.selectedAspectIndex === "number"
        ? raw.selectedAspectIndex
        : null,
    previousPost:
      typeof raw.previousPost === "string" ? raw.previousPost : null,
    previousPostedAt:
      typeof raw.previousPostedAt === "string" ? raw.previousPostedAt : null,
    iteration: typeof raw.iteration === "number" ? raw.iteration : 0,
    lastJudgeNotes:
      typeof raw.lastJudgeNotes === "string" ? raw.lastJudgeNotes : null,
    lastJudgeScore:
      typeof raw.lastJudgeScore === "number" ? raw.lastJudgeScore : null,
  };
}

export function saveBullpostCampaignState(
  state: BullpostCampaignState,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const filePath = resolveBullpostCampaignStatePath(env);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

export function pickRandomAspect(
  points: string[],
  rng: () => number = Math.random,
): { aspect: string; index: number } | null {
  if (points.length === 0) return null;
  const index = Math.floor(rng() * points.length);
  return { aspect: points[index]!, index };
}

/** True when we need a fresh Firecrawl brief (new day or empty/stale campaign). */
export function needsDailyBriefRefresh(
  state: BullpostCampaignState,
  opts: { now?: Date; maxAgeMs?: number; siteUrl?: string } = {},
): boolean {
  const now = opts.now ?? new Date();
  const today = utcDayKey(now);
  if (state.dayKey !== today) return true;
  if (!state.selectedAspect || state.marketingPoints.length === 0) return true;
  if (opts.siteUrl && state.siteUrl && state.siteUrl !== opts.siteUrl) {
    return true;
  }
  if (!state.scrapedAt) return true;
  const maxAgeMs = opts.maxAgeMs ?? 24 * 60 * 60_000;
  const scrapedAt = Date.parse(state.scrapedAt);
  if (!Number.isFinite(scrapedAt)) return true;
  return now.getTime() - scrapedAt >= maxAgeMs;
}
