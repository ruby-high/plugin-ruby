/**
 * Firecrawl scrape client for plugin-ruby bullpost daily briefs.
 *
 * Uses self-hosted Firecrawl (`FIRECRAWL_API_URL`). No cloud API key required
 * when pointing at a private instance.
 */
import { logger } from "@elizaos/core";

const LOG_PREFIX = "[Firecrawl]";

export function resolveFirecrawlApiUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.FIRECRAWL_API_URL ||
    env.FIRECRAWL_BASE_URL ||
    "http://127.0.0.1:3002"
  ).replace(/\/+$/, "");
}

export type FirecrawlScrapeResult =
  | {
      ok: true;
      markdown: string;
      links: string[];
      title: string | null;
    }
  | { ok: false; error: string };

export async function firecrawlScrape(
  url: string,
  opts: {
    apiUrl?: string;
    waitForMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<FirecrawlScrapeResult> {
  const apiUrl = (opts.apiUrl ?? resolveFirecrawlApiUrl()).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 90_000;

  try {
    const response = await fetch(`${apiUrl}/v1/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown", "links"],
        onlyMainContent: true,
        waitFor: opts.waitForMs ?? 2500,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    const payload = (await response.json()) as {
      success?: boolean;
      data?: {
        markdown?: string;
        links?: string[];
        metadata?: { title?: string };
      };
      error?: string;
    };

    if (payload.success === false) {
      return { ok: false, error: payload.error || "scrape failed" };
    }

    const data = payload.data ?? {};
    const markdown = typeof data.markdown === "string" ? data.markdown.trim() : "";
    if (markdown.length < 80) {
      return {
        ok: false,
        error: `scrape too thin (${markdown.length} chars)`,
      };
    }

    return {
      ok: true,
      markdown,
      links: Array.isArray(data.links)
        ? data.links.filter((l): l is string => typeof l === "string")
        : [],
      title:
        typeof data.metadata?.title === "string" ? data.metadata.title : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error, url, apiUrl }, `${LOG_PREFIX} scrape failed`);
    return { ok: false, error: message };
  }
}
