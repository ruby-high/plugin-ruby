/**
 * Discord helpers for bullpost suggestions with a one-shot "Post tweet" button.
 *
 * Uses raw Discord API component payloads (no discord.js import) so plugin-ruby
 * stays dependency-light while still talking through the live DiscordService client.
 */
import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { resolveRubyTriviaConfig } from "./config.js";
import {
  buildRubyTweetCustomId,
  type BullpostTweetRecord,
} from "./bullpost-tweet-store.js";

const LOG_PREFIX = "[BullpostDiscord]";

/** discord.js ButtonStyle.Success */
const BUTTON_STYLE_SUCCESS = 3;
/** discord.js ButtonStyle.Secondary */
const BUTTON_STYLE_SECONDARY = 2;

type DiscordClientLike = {
  isReady?: () => boolean;
  channels: {
    fetch: (id: string) => Promise<{
      isTextBased?: () => boolean;
      send?: (payload: Record<string, unknown>) => Promise<{ id: string }>;
      messages?: {
        fetch: (id: string) => Promise<{
          edit: (payload: Record<string, unknown>) => Promise<unknown>;
        }>;
      };
    } | null>;
  };
};

function getDiscordClient(runtime: IAgentRuntime): DiscordClientLike | null {
  const svc = runtime.getService?.("discord") as
    | {
        client?: DiscordClientLike | null;
        getClient?: (accountId?: string | null) => DiscordClientLike | null;
      }
    | null
    | undefined;
  if (!svc) return null;
  if (typeof svc.getClient === "function") {
    const client = svc.getClient();
    if (client && typeof client.channels?.fetch === "function") return client;
  }
  if (svc.client && typeof svc.client.channels?.fetch === "function") {
    return svc.client;
  }
  return null;
}

function tweetButtonRow(customId: string, label: string, disabled = false) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: disabled ? BUTTON_STYLE_SECONDARY : BUTTON_STYLE_SUCCESS,
        label,
        custom_id: customId,
        disabled,
      },
    ],
  };
}

export type SendBullpostSuggestionResult = {
  ok: boolean;
  messageId: string | null;
  channelId: string | null;
};

/**
 * Send bullpost suggestion with a green "Post tweet" button.
 * Falls back to plain text send if Discord client unavailable.
 */
export async function sendBullpostSuggestionMessage(
  runtime: IAgentRuntime,
  opts: {
    bodyText: string;
    tweetRecord: BullpostTweetRecord;
  },
): Promise<SendBullpostSuggestionResult> {
  const config = resolveRubyTriviaConfig(runtime);
  if (!config.discordChannelId || !config.discordAnnounceEnabled) {
    return { ok: false, messageId: null, channelId: null };
  }

  const channelId = config.discordChannelId;
  const client = getDiscordClient(runtime);
  const content = opts.bodyText;
  const row = tweetButtonRow(
    buildRubyTweetCustomId(opts.tweetRecord.id),
    "🐦 Post tweet",
  );

  if (client && client.isReady?.() !== false) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || typeof channel.send !== "function") {
        throw new Error("channel not sendable");
      }

      const sent = await channel.send({
        content,
        components: [row],
      });

      return {
        ok: true,
        messageId: sent.id,
        channelId,
      };
    } catch (error) {
      logger.error(
        { error },
        `${LOG_PREFIX} component send failed — falling back to plain text`,
      );
    }
  }

  if (typeof runtime.sendMessageToTarget !== "function") {
    return { ok: false, messageId: null, channelId };
  }
  try {
    await runtime.sendMessageToTarget(
      {
        source: "discord",
        accountId: config.discordAccountId,
        channelId,
      },
      {
        text: `${content}\n\n_(Post-tweet button unavailable — Discord client not ready)_`,
        source: "ruby",
      },
    );
    return { ok: true, messageId: null, channelId };
  } catch (error) {
    logger.error({ error }, `${LOG_PREFIX} plain send failed`);
    return { ok: false, messageId: null, channelId };
  }
}

export async function disableBullpostTweetButton(
  runtime: IAgentRuntime,
  opts: {
    channelId: string;
    messageId: string;
    label?: string;
  },
): Promise<boolean> {
  const client = getDiscordClient(runtime);
  if (!client) return false;
  try {
    const channel = await client.channels.fetch(opts.channelId);
    const message = await channel?.messages?.fetch(opts.messageId);
    if (!message) return false;

    const row = tweetButtonRow(
      `ruby_tw_done:${opts.messageId.slice(-8)}`,
      opts.label ?? "✅ Tweeted",
      true,
    );
    await message.edit({ components: [row] });
    return true;
  } catch (error) {
    logger.warn({ error }, `${LOG_PREFIX} failed to disable tweet button`);
    return false;
  }
}

export async function sendLoudTweetProclaim(
  runtime: IAgentRuntime,
  text: string,
): Promise<boolean> {
  const config = resolveRubyTriviaConfig(runtime);
  if (!config.discordChannelId || !config.discordAnnounceEnabled) return false;
  if (typeof runtime.sendMessageToTarget !== "function") return false;
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
    logger.error({ error }, `${LOG_PREFIX} proclaim send failed`);
    return false;
  }
}
