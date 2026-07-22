/**
 * Post a bullpost to X via `xurl` (official X CLI).
 *
 * Auth lives in `~/.xurl` and must be configured out-of-band:
 *   xurl auth apps add … && xurl auth oauth2 --app … && xurl auth default …
 */
import { spawn } from "node:child_process";
import { logger } from "@elizaos/core";

const LOG_PREFIX = "[BullpostTweet]";

export type TweetPostResult =
  | { ok: true; tweetId: string; tweetUrl: string; raw: unknown }
  | { ok: false; error: string; needsAuth?: boolean };

function runCommand(
  command: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 60_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        code: 127,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    });
    if (opts.input != null) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

function extractTweetId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const data = root.data;
  if (data && typeof data === "object") {
    const id = (data as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  if (typeof root.id === "string" && root.id.trim()) return root.id.trim();
  return null;
}

function tweetUrlForId(id: string): string {
  return `https://x.com/i/web/status/${id}`;
}

/**
 * Dry-run mode for operators without X auth yet — still exercises lock + proclaim.
 * Enable with RUBY_TWEET_DRY_RUN=1 (never default on in production permanently).
 */
function dryRunEnabled(): boolean {
  const v = process.env.RUBY_TWEET_DRY_RUN?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export async function postBullpostTweet(text: string): Promise<TweetPostResult> {
  const body = text.trim();
  if (!body) return { ok: false, error: "empty tweet text" };
  if (body.length > 280) {
    // X free tier hard limit — reject rather than silently truncating brand copy.
    return { ok: false, error: `tweet too long (${body.length}/280)` };
  }

  if (dryRunEnabled()) {
    const tweetId = `dryrun-${Date.now()}`;
    logger.warn(
      { tweetId, chars: body.length },
      `${LOG_PREFIX} RUBY_TWEET_DRY_RUN — skipping real X post`,
    );
    return {
      ok: true,
      tweetId,
      tweetUrl: tweetUrlForId(tweetId),
      raw: { dryRun: true },
    };
  }

  // Prefer shortcut: `xurl post "…"`
  const posted = await runCommand("xurl", ["post", body], { timeoutMs: 45_000 });
  if (posted.code === 0 && posted.stdout.trim()) {
    try {
      const json = JSON.parse(posted.stdout) as unknown;
      const tweetId = extractTweetId(json);
      if (tweetId) {
        return {
          ok: true,
          tweetId,
          tweetUrl: tweetUrlForId(tweetId),
          raw: json,
        };
      }
    } catch {
      // fall through to raw endpoint
    }
  }

  // Raw v2 endpoint
  const raw = await runCommand(
    "xurl",
    ["-X", "POST", "/2/tweets", "-d", JSON.stringify({ text: body })],
    { timeoutMs: 45_000 },
  );

  const combined = `${raw.stdout}\n${raw.stderr}`.trim();
  if (raw.code !== 0) {
    const needsAuth =
      /no apps registered|auth|unauthorized|401|403|oauth/i.test(combined) ||
      raw.code === 127;
    logger.warn(
      {
        code: raw.code,
        stderrPreview: raw.stderr.slice(0, 200),
        stdoutPreview: raw.stdout.slice(0, 200),
      },
      `${LOG_PREFIX} xurl post failed`,
    );
    return {
      ok: false,
      needsAuth,
      error: needsAuth
        ? "X auth not configured on this host (`xurl auth status`). Register an app + oauth2, then retry."
        : combined.slice(0, 300) || `xurl exited ${raw.code}`,
    };
  }

  try {
    const json = JSON.parse(raw.stdout) as unknown;
    const tweetId = extractTweetId(json);
    if (!tweetId) {
      return { ok: false, error: "xurl returned no tweet id" };
    }
    return {
      ok: true,
      tweetId,
      tweetUrl: tweetUrlForId(tweetId),
      raw: json,
    };
  } catch {
    return {
      ok: false,
      error: `unparseable xurl response: ${raw.stdout.slice(0, 200)}`,
    };
  }
}

export function buildLoudTweetProclaim(opts: {
  text: string;
  tweetUrl: string;
  postedByLabel: string;
  dryRun?: boolean;
}): string {
  const banner = opts.dryRun
    ? "📣📣📣 **$RUBY TWEET LOCKED (DRY RUN)** 📣📣📣"
    : "📣📣📣 **$RUBY TWEET IS LIVE** 📣📣📣";
  return [
    banner,
    `**${opts.postedByLabel}** just hit the button — this copy is on X and **locked** (no double-posts).`,
    "",
    opts.text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    "",
    `🔗 ${opts.tweetUrl}`,
  ].join("\n");
}
