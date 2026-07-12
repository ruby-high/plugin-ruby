import type { IAgentRuntime } from "@elizaos/core";
import {
  ADMIN_FETCH_TIMEOUT_MS,
  HEALTH_FETCH_TIMEOUT_MS,
  resolveAnalyticsSecretWithSource,
  resolveRubyTriviaConfig,
} from "./config.js";
import type {
  CommunityDifficulty,
  CommunityOverview,
  HappeningTimelineItem,
  PlatformHappenings,
  PublishDailyResult,
  RubyFetchResult,
  TriviaHealthResponse,
} from "./types/admin.js";

/** Typed fetch results — callers format user text; pulse branches on ok without try/catch sprawl. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error.trim();
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
    if (Array.isArray(record.missingIds) && record.missingIds.length > 0) {
      return `missing question IDs: ${record.missingIds.join(", ")}`;
    }
    if (record.existing) {
      return "publish already exists for this date/scope";
    }
  }
  return fallback;
}

function mapHttpError(status: number, payload: unknown, path: string): string {
  if (status === 503) {
    return "Analytics secret not configured on trivia server (503).";
  }
  if (status === 403) {
    return "Wrong analytics secret (403).";
  }
  if (status === 409) {
    return extractErrorMessage(payload, `Conflict on ${path} (409).`);
  }
  if (status === 422) {
    return extractErrorMessage(payload, `Invalid request for ${path} (422).`);
  }
  return extractErrorMessage(
    payload,
    `Ruby Trivia admin request failed: HTTP ${status} on ${path}.`,
  );
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function rubyFetch<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<RubyFetchResult<T>> {
  const timeoutMs = init.timeoutMs ?? ADMIN_FETCH_TIMEOUT_MS;
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await parseJson(response);
    if (!response.ok) {
      return {
        ok: false,
        kind: "http",
        status: response.status,
        message: mapHttpError(response.status, payload, url),
      };
    }
    return { ok: true, data: payload as T, status: response.status };
  } catch (error) {
    if (isAbortError(error)) {
      return {
        ok: false,
        kind: "timeout",
        message: `Request timed out: ${url}`,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "network", message };
  }
}

export async function rubyHealthFetch(
  runtime: IAgentRuntime,
): Promise<RubyFetchResult<TriviaHealthResponse>> {
  const { baseUrl } = resolveRubyTriviaConfig(runtime);
  // Unauthenticated + shorter timeout: distinguish "down" from "bad secret" before admin calls.
  return rubyFetch<TriviaHealthResponse>(`${baseUrl}/api/health`, {
    method: "GET",
    headers: { Accept: "application/json" },
    timeoutMs: HEALTH_FETCH_TIMEOUT_MS,
  });
}

export function formatHealthSummary(
  baseUrl: string,
  payload: TriviaHealthResponse,
): string {
  const healthUrl = `${baseUrl}/api/health`;
  const aiEnabled = payload.ai?.enabled === true;
  const aiReachable = payload.ai?.reachable === true;
  const model = payload.ai?.model?.trim();

  const lines = ["Ruby Trivia health (internal)", `• API: up (${healthUrl})`];
  if (aiEnabled) {
    lines.push(
      aiReachable
        ? `• AI: reachable${model ? ` (${model})` : ""}`
        : "• AI: configured but not reachable",
    );
  } else {
    lines.push("• AI: disabled on trivia server");
  }
  return lines.join("\n");
}

/** Public chat / Discord — no hosts, URLs, ports, or model names. */
export function formatHealthSummaryPublic(
  payload: TriviaHealthResponse,
): string {
  const aiEnabled = payload.ai?.enabled === true;
  const aiReachable = payload.ai?.reachable === true;

  if (aiEnabled && !aiReachable) {
    return "Ruby Trivia is partially up — game services are live but AI assist is offline.";
  }
  return "Ruby Trivia is online. Game services are responding.";
}

export function formatServiceUnavailablePublic(): string {
  return "Ruby Trivia isn't responding right now. Game services may be unavailable.";
}

export async function rubyAdminFetch<T>(
  runtime: IAgentRuntime,
  method: string,
  path: string,
  body?: unknown,
): Promise<RubyFetchResult<T>> {
  const { baseUrl, analyticsSecret } = resolveRubyTriviaConfig(runtime);
  if (!analyticsSecret) {
    // Fail locally — don't hit server with missing x-analytics-secret.
    return {
      ok: false,
      kind: "http",
      status: 503,
      message:
        "RUBY_ANALYTICS_SECRET (or ANALYTICS_SECRET) is not configured for Ruby admin API calls.",
    };
  }

  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-analytics-secret": analyticsSecret,
  };
  let requestBody: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  return rubyFetch<T>(url, {
    method,
    headers,
    body: requestBody,
  }).then((result) => {
    if (result.ok || result.kind !== "http" || result.status !== 403) {
      return result;
    }
    const { source } = resolveAnalyticsSecretWithSource(runtime);
    runtime.logger?.debug(
      {
        path,
        method,
        analyticsSecret,
        analyticsSecretSource: source,
        analyticsSecretLength: analyticsSecret.length,
      },
      "[plugin-ruby] admin API 403 — analytics secret rejected by trivia server",
    );
    return result;
  });
}

/** Older or partial API hosts may omit timeline — treat as empty feed. */
export function getHappeningsTimeline(
  payload: Pick<PlatformHappenings, "timeline"> | { timeline?: unknown },
): HappeningTimelineItem[] {
  return Array.isArray(payload.timeline) ? payload.timeline : [];
}

export function summarizeHappenings(payload: PlatformHappenings): string {
  const parts: string[] = [];
  const summary = payload.summary;
  if (summary) {
    const counts = [
      summary.registrations > 0
        ? `${summary.registrations} registrations`
        : null,
      summary.dailyCompletions > 0
        ? `${summary.dailyCompletions} daily completions`
        : null,
      summary.badgeEarns > 0 ? `${summary.badgeEarns} badge earns` : null,
    ].filter(Boolean);
    if (counts.length > 0) {
      parts.push(counts.join(", "));
    }
  }
  if (payload.live?.queueWaiting > 0) {
    parts.push(`${payload.live.queueWaiting} waiting in live queue`);
  }
  const highlights = getHappeningsTimeline(payload)
    .slice(0, 3)
    .map((item) => item.summary)
    .filter(Boolean);
  if (highlights?.length) {
    parts.push(highlights.join("; "));
  }
  return parts.length > 0 ? parts.join(" · ") : "No notable platform activity.";
}

export function summarizeCommunity(payload: CommunityOverview): string {
  const weak = payload.weakCategories
    ?.slice(0, 3)
    .map((entry) => entry.category)
    .filter(Boolean);
  if (weak?.length) {
    return `Weak categories: ${weak.join(", ")}.`;
  }
  return "Community signals loaded.";
}

export function summarizeCommunityDifficulty(
  payload: CommunityDifficulty,
): string {
  const weak = payload.weakCategories
    ?.slice(0, 3)
    .map(
      (entry) =>
        `${entry.category} (easiness ${entry.meanEasiness.toFixed(1)})`,
    );
  if (weak?.length) {
    return `Community struggle: ${weak.join(", ")}.`;
  }
  const byDifficulty = payload.byDifficulty
    ?.map((entry) => `${entry.difficulty} ${Math.round(entry.accuracy * 100)}%`)
    .join(", ");
  return byDifficulty
    ? `Accuracy by difficulty: ${byDifficulty}.`
    : "Difficulty breakdown loaded.";
}

export function summarizeAuditList(payload: {
  items?: unknown[];
  hasMore?: boolean;
  dbTotal?: number;
}): string {
  const count = payload.items?.length ?? 0;
  const parts = [`${count} audited question(s)`];
  if (typeof payload.dbTotal === "number") {
    parts.push(`${payload.dbTotal} dynamic rows in DB`);
  }
  if (payload.hasMore) parts.push("more pages via cursor");
  return `${parts.join(", ")}.`;
}

export function summarizeOpenApiMeta(payload: {
  info?: { version?: string; "x-audit-api-version"?: number };
  paths?: Record<string, unknown>;
}): string {
  const version = payload.info?.version ?? "?";
  const auditVersion = payload.info?.["x-audit-api-version"];
  const pathCount = payload.paths ? Object.keys(payload.paths).length : 0;
  const auditPart =
    auditVersion !== undefined ? `, audit API v${auditVersion}` : "";
  return `OpenAPI admin spec v${version}${auditPart} — ${pathCount} paths.`;
}

export function summarizePublishResult(payload: PublishDailyResult): string {
  const parts: string[] = [];
  if (payload.scope && payload.date) {
    parts.push(`Published ${payload.scope} daily for ${payload.date}.`);
  }
  if (payload.notes?.trim()) {
    parts.push(`Notes: ${payload.notes.trim()}`);
  }
  if (payload.difficultyBreakdown) {
    const breakdown = Object.entries(payload.difficultyBreakdown)
      .map(([key, value]) => `${key}:${value}`)
      .join(", ");
    if (breakdown) parts.push(`Breakdown: ${breakdown}.`);
  }
  if (payload.warnings?.length) {
    parts.push(`Warnings: ${payload.warnings.join("; ")}`);
  }
  return parts.length > 0 ? parts.join(" ") : "Daily publish completed.";
}
