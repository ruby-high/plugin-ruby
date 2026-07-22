import type { IAgentRuntime } from "@elizaos/core";

/** Default trivia API when unset — production host (override with localhost:5175 for local dev). */
export const DEFAULT_RUBY_TRIVIA_API_URL = "https://app.ruby-trivia.com";
/** Five minutes: fast enough for live queue/signups without admin API hammering. */
export const DEFAULT_PULSE_INTERVAL_MINUTES = 5;
/** Cap announced dedup keys so runtime settings stay bounded on long-lived agents. */
export const ANNOUNCED_KEYS_MAX = 500;
/** First boot without cursor still sees recent activity without replaying full history. */
export const COLD_START_SINCE_HOURS = 1;
/** Six polls at 5 min = 30 minutes of loud outage alerts before throttling. */
export const OUTAGE_ALERT_EVERY_POLL_UNTIL = 6;
/** After loud window, alert every third poll = 15 minutes between messages. */
export const OUTAGE_ALERT_THROTTLE_EVERY = 3;
export const ADMIN_FETCH_TIMEOUT_MS = 15_000;
/** Health check should fail fast — pulse uses it as a reachability gate. */
export const HEALTH_FETCH_TIMEOUT_MS = 8_000;
/** Community slices refresh every N pulse ticks (3 × 5m = 15m default). */
export const COMMUNITY_REFRESH_EVERY_PULSES = 3;
/**
 * Bot fingerprint filter refresh every N pulse ticks (3 × 5m = 15m default).
 * WHY not every pulse: device-fingerprint report used to full-scan analytics and wedge CT102.
 * Cached sets stay valid across interim digests; farms do not churn every 5 minutes.
 */
export const BOT_FILTER_REFRESH_EVERY_PULSES = 3;
/** Default cadence for LLM-authored dynamic questions (slower than pulse). */
export const DEFAULT_QUESTION_AUTHORING_INTERVAL_MINUTES = 60;
/** One question per cycle keeps bank growth steady without flooding the API. */
export const DEFAULT_QUESTIONS_PER_CYCLE = 1;

/** Default judge model — Gemma 4 26B on zerollama; override with RUBY_QUESTION_JUDGE_MODEL. */
export const DEFAULT_QUESTION_JUDGE_MODEL =
  "VladimirGav/gemma4-26b-16GB-VRAM-Uncensored:latest";
/** Max distractor-only regenerate attempts before accepting/hiding. */
export const DEFAULT_JUDGE_DISTRACTOR_RETRIES = 2;

/** Mad-lib authoring cadence — slower than questions; a story catalog needs less volume. */
export const DEFAULT_MADLIB_AUTHORING_INTERVAL_MINUTES = 180;
/** One template per cycle keeps growth steady. */
export const DEFAULT_MADLIBS_PER_CYCLE = 1;

/** Audit sweep cadence. Nightly-ish: flagged rows are a slow leak, not an incident. */
export const DEFAULT_AUDIT_SWEEP_INTERVAL_MINUTES = 720;
/** Questions judged per sweep. Each one is an LLM call, so keep the batch modest. */
export const DEFAULT_AUDIT_SWEEP_PER_CYCLE = 25;

export type RubyTriviaConfig = {
  baseUrl: string;
  analyticsSecret: string | null;
  pulseIntervalMinutes: number;
  pulseEnabled: boolean;
  questionAuthoringEnabled: boolean;
  questionAuthoringIntervalMinutes: number;
  questionsPerCycle: number;
  questionAuthoringDebug: boolean;
  /** Model to use for question judging (Ollama tag). Empty string disables judge. */
  questionJudgeModel: string;
  /** Mad-lib authoring. Off by default until the /api/admin/madlibs route ships. */
  madlibAuthoringEnabled: boolean;
  madlibAuthoringIntervalMinutes: number;
  madlibsPerCycle: number;
  madlibAuthoringDebug: boolean;
  /** Model to use for mad-lib judging (Ollama tag). Empty string disables judge. */
  madlibJudgeModel: string;
  /**
   * Audit sweep — re-judges warned-but-playable questions. Off by default: it can HIDE live
   * content, so it should be switched on deliberately, ideally after a dry run.
   */
  auditSweepEnabled: boolean;
  auditSweepIntervalMinutes: number;
  auditSweepPerCycle: number;
  auditSweepDebug: boolean;
  /** Judge and log, but send `?dryRun=true` so the server writes nothing. */
  auditSweepDryRun: boolean;
  discordChannelId: string | null;
  discordAccountId: string;
  discordAnnounceEnabled: boolean;
};

function resolveSettingWithSource(
  runtime: IAgentRuntime,
  key: string,
): { value: string; source: string } | null {
  const fromSetting = runtime.getSetting(key);
  if (typeof fromSetting === "string" && fromSetting.trim()) {
    return {
      value: fromSetting.trim(),
      source: `${key} (runtime setting)`,
    };
  }
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) {
    return { value: fromEnv, source: `${key} (env)` };
  }
  return null;
}

function resolveSetting(
  runtime: IAgentRuntime,
  key: string,
): string | undefined {
  return resolveSettingWithSource(runtime, key)?.value;
}

export function resolveAnalyticsSecretWithSource(runtime: IAgentRuntime): {
  secret: string | null;
  source: string | null;
} {
  for (const key of ["RUBY_ANALYTICS_SECRET", "ANALYTICS_SECRET"] as const) {
    const resolved = resolveSettingWithSource(runtime, key);
    if (resolved) {
      return { secret: resolved.value, source: resolved.source };
    }
  }
  return { secret: null, source: null };
}

/** Log resolved trivia config once on Ruby agent init (secret included for .env verification). */
export function logRubyTriviaConfigOnInit(runtime: IAgentRuntime): void {
  const config = resolveRubyTriviaConfig(runtime);
  const { source } = resolveAnalyticsSecretWithSource(runtime);
  runtime.logger.info(
    {
      baseUrl: config.baseUrl,
      analyticsSecret: config.analyticsSecret,
      analyticsSecretSource: source,
      analyticsSecretLength: config.analyticsSecret?.length ?? 0,
      pulseEnabled: config.pulseEnabled,
      questionAuthoringEnabled: config.questionAuthoringEnabled,
    },
    "[plugin-ruby] Ruby trivia config loaded",
  );
}

function resolveBoolSetting(
  runtime: IAgentRuntime,
  key: string,
  defaultValue: boolean,
): boolean {
  const raw = resolveSetting(runtime, key);
  if (raw === undefined) return defaultValue;
  const normalized = raw.toLowerCase();
  // Operators use mixed truthy strings in env files (yes/on/1); only explicit false disables.
  if (
    raw === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return true;
}

function resolveIntSetting(
  runtime: IAgentRuntime,
  key: string,
  defaultValue: number,
): number {
  const raw = resolveSetting(runtime, key);
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function resolveRubyTriviaApiUrl(runtime: IAgentRuntime): string {
  const raw =
    resolveSetting(runtime, "RUBY_TRIVIA_API_URL") ||
    DEFAULT_RUBY_TRIVIA_API_URL;
  return raw.replace(/\/+$/, "");
}

export function resolveRubyTriviaConfig(
  runtime: IAgentRuntime,
): RubyTriviaConfig {
  const { secret: analyticsSecret } = resolveAnalyticsSecretWithSource(runtime);

  const pulseEnabledDefault = Boolean(analyticsSecret);
  // Secret present implies operator deployment; disable pulse explicitly with RUBY_PULSE_ENABLED=0.

  return {
    baseUrl: resolveRubyTriviaApiUrl(runtime),
    analyticsSecret,
    pulseIntervalMinutes: resolveIntSetting(
      runtime,
      "RUBY_PULSE_INTERVAL_MINUTES",
      DEFAULT_PULSE_INTERVAL_MINUTES,
    ),
    pulseEnabled: resolveBoolSetting(
      runtime,
      "RUBY_PULSE_ENABLED",
      pulseEnabledDefault,
    ),
    questionAuthoringEnabled: resolveBoolSetting(
      runtime,
      "RUBY_QUESTION_AUTHORING_ENABLED",
      pulseEnabledDefault,
    ),
    questionAuthoringIntervalMinutes: resolveIntSetting(
      runtime,
      "RUBY_QUESTION_AUTHORING_INTERVAL_MINUTES",
      DEFAULT_QUESTION_AUTHORING_INTERVAL_MINUTES,
    ),
    questionsPerCycle: resolveIntSetting(
      runtime,
      "RUBY_QUESTIONS_PER_CYCLE",
      DEFAULT_QUESTIONS_PER_CYCLE,
    ),
    questionAuthoringDebug: resolveBoolSetting(
      runtime,
      "RUBY_QUESTION_AUTHORING_DEBUG",
      false,
    ),
    questionJudgeModel:
      resolveSetting(runtime, "RUBY_QUESTION_JUDGE_MODEL") ??
      DEFAULT_QUESTION_JUDGE_MODEL,
    // Off by default (unlike question authoring) — the /api/admin/madlibs route does not exist yet.
    madlibAuthoringEnabled: resolveBoolSetting(
      runtime,
      "RUBY_MADLIB_AUTHORING_ENABLED",
      false,
    ),
    madlibAuthoringIntervalMinutes: resolveIntSetting(
      runtime,
      "RUBY_MADLIB_AUTHORING_INTERVAL_MINUTES",
      DEFAULT_MADLIB_AUTHORING_INTERVAL_MINUTES,
    ),
    madlibsPerCycle: resolveIntSetting(
      runtime,
      "RUBY_MADLIBS_PER_CYCLE",
      DEFAULT_MADLIBS_PER_CYCLE,
    ),
    madlibAuthoringDebug: resolveBoolSetting(
      runtime,
      "RUBY_MADLIB_AUTHORING_DEBUG",
      false,
    ),
    madlibJudgeModel:
      resolveSetting(runtime, "RUBY_MADLIB_JUDGE_MODEL") ??
      DEFAULT_QUESTION_JUDGE_MODEL,
    // Off by default: this task can hide live questions. Turn it on deliberately.
    auditSweepEnabled: resolveBoolSetting(runtime, "RUBY_AUDIT_SWEEP_ENABLED", false),
    auditSweepIntervalMinutes: resolveIntSetting(
      runtime,
      "RUBY_AUDIT_SWEEP_INTERVAL_MINUTES",
      DEFAULT_AUDIT_SWEEP_INTERVAL_MINUTES,
    ),
    auditSweepPerCycle: resolveIntSetting(
      runtime,
      "RUBY_AUDIT_SWEEP_PER_CYCLE",
      DEFAULT_AUDIT_SWEEP_PER_CYCLE,
    ),
    auditSweepDebug: resolveBoolSetting(runtime, "RUBY_AUDIT_SWEEP_DEBUG", false),
    // Default TRUE - first real run should prove itself before it is allowed to write.
    auditSweepDryRun: resolveBoolSetting(runtime, "RUBY_AUDIT_SWEEP_DRY_RUN", true),
    discordChannelId:
      resolveSetting(runtime, "RUBY_DISCORD_CHANNEL_ID") || null,
    discordAccountId:
      resolveSetting(runtime, "RUBY_DISCORD_ACCOUNT_ID") || "default",
    discordAnnounceEnabled: resolveBoolSetting(
      runtime,
      "RUBY_DISCORD_ANNOUNCE_ENABLED",
      true,
    ),
  };
}
