/**
 * Zerollama progressive enhancement for plugin-ruby.
 *
 * Stock Ollama `/api/chat` works against zerollama. When `GET /api/version`
 * reports `distribution: "zerollama"`, we attach `options.zerollama` QoS so
 * background drafting (bullposts / judges) yields to interactive Discord turns.
 */
import { logger } from "@elizaos/core";

export type ZerollamaQosClass = "interactive" | "auxiliary" | "background";

export type ZerollamaVersionInfo = {
  distribution: string | null;
  version: string | null;
  isZerollama: boolean;
  capabilities: Record<string, unknown> | null;
};

export type ZerollamaChatOptions = {
  model: string;
  prompt: string;
  /** Scheduling tier — background for batch drafts, auxiliary for side work. */
  qosClass?: ZerollamaQosClass;
  projectId?: string;
  projectName?: string;
  temperature?: number;
  timeoutMs?: number;
  format?: "json" | Record<string, unknown>;
};

let cachedVersion: ZerollamaVersionInfo | null = null;
let cachedVersionAt = 0;
const VERSION_TTL_MS = 10 * 60_000;

export function resolveZerollamaApiBase(): string {
  return (
    process.env.ZEROLLAMA_API_ENDPOINT ||
    process.env.ZEROLLAMA_API_URL ||
    process.env.ZEROLLAMA_BASE_URL ||
    process.env.OLLAMA_BASE_URL ||
    "http://127.0.0.1:8080"
  ).replace(/\/+$/, "");
}

export async function probeZerollamaVersion(
  force = false,
): Promise<ZerollamaVersionInfo> {
  const now = Date.now();
  if (
    !force &&
    cachedVersion &&
    now - cachedVersionAt < VERSION_TTL_MS
  ) {
    return cachedVersion;
  }

  const base = resolveZerollamaApiBase();
  const empty: ZerollamaVersionInfo = {
    distribution: null,
    version: null,
    isZerollama: false,
    capabilities: null,
  };

  try {
    const response = await fetch(`${base}/api/version`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      cachedVersion = empty;
      cachedVersionAt = now;
      return empty;
    }
    const body = (await response.json()) as {
      distribution?: string;
      version?: string;
      zerollama?: { capabilities?: Record<string, unknown> };
    };
    const distribution =
      typeof body.distribution === "string" ? body.distribution : null;
    const info: ZerollamaVersionInfo = {
      distribution,
      version: typeof body.version === "string" ? body.version : null,
      isZerollama: distribution === "zerollama",
      capabilities: body.zerollama?.capabilities ?? null,
    };
    cachedVersion = info;
    cachedVersionAt = now;
    return info;
  } catch (error) {
    logger.warn(
      { error, base },
      "[plugin-ruby] zerollama /api/version probe failed",
    );
    cachedVersion = empty;
    cachedVersionAt = now;
    return empty;
  }
}

export async function logZerollamaIntegrationOnInit(): Promise<void> {
  const base = resolveZerollamaApiBase();
  const info = await probeZerollamaVersion(true);
  logger.info(
    {
      apiBase: base,
      distribution: info.distribution,
      version: info.version,
      isZerollama: info.isZerollama,
      qos: info.isZerollama,
      canLoad: Boolean(info.capabilities?.can_load),
      dualOllamaEnv: Boolean(process.env.OLLAMA_BASE_URL?.trim()),
    },
    info.isZerollama
      ? "[plugin-ruby] zerollama detected — QoS progressive enhancement enabled for drafts"
      : "[plugin-ruby] Ollama-compatible endpoint (no zerollama distribution flag)",
  );
  if (process.env.OLLAMA_BASE_URL?.trim()) {
    logger.warn(
      {
        OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
        hint: "Unset OLLAMA_BASE_URL so @elizaos/plugin-ollama does not auto-enable beside plugin-zerollama",
      },
      "[plugin-ruby] OLLAMA_BASE_URL is set — dual LLM plugins may fight for TEXT_SMALL",
    );
  }
}

/**
 * Build `/api/chat` body. Always Ollama-compatible; when zerollama is detected,
 * attach `options.zerollama` for fleet QoS (progressive enhancement).
 */
export async function buildZerollamaChatBody(
  opts: ZerollamaChatOptions,
): Promise<Record<string, unknown>> {
  const info = await probeZerollamaVersion();
  const options: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.85,
  };

  if (info.isZerollama) {
    options.zerollama = {
      qos_class: opts.qosClass ?? "background",
      project_id: opts.projectId ?? "eliza-ruby",
      project_name: opts.projectName ?? "plugin-ruby",
    };
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [{ role: "user", content: opts.prompt }],
    stream: false,
    options,
  };
  if (opts.format) body.format = opts.format;
  return body;
}

export async function zerollamaChat(
  opts: ZerollamaChatOptions,
): Promise<{ ok: true; content: string; enhanced: boolean } | { ok: false; error: string }> {
  const base = resolveZerollamaApiBase();
  const info = await probeZerollamaVersion();
  const body = await buildZerollamaChatBody(opts);

  try {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
      };
    }
    const payload = (await response.json()) as {
      message?: { content?: string };
    };
    const content = payload.message?.content?.trim() ?? "";
    if (!content) return { ok: false, error: "empty content" };
    return { ok: true, content, enhanced: info.isZerollama };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
