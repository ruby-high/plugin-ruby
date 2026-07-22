/**
 * Handle Discord "Post tweet" button presses for bullpost suggestions.
 */
import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import {
  disableBullpostTweetButton,
  sendLoudTweetProclaim,
} from "./bullpost-discord.js";
import {
  buildLoudTweetProclaim,
  postBullpostTweet,
} from "./bullpost-tweet-post.js";
import {
  claimBullpostTweetForPosting,
  finalizeBullpostTweetPosted,
  parseRubyTweetCustomId,
  releaseBullpostTweetClaim,
  updateBullpostTweetRecord,
} from "./bullpost-tweet-store.js";

const LOG_PREFIX = "[BullpostTweetHandler]";

type DiscordInteractionLike = {
  isButton?: () => boolean;
  customId?: string;
  user?: { id?: string; username?: string; globalName?: string | null };
  member?: { displayName?: string };
  deferred?: boolean;
  replied?: boolean;
  deferReply?: (opts?: { ephemeral?: boolean }) => Promise<unknown>;
  deferUpdate?: () => Promise<unknown>;
  editReply?: (opts: { content: string }) => Promise<unknown>;
  followUp?: (opts: {
    content: string;
    ephemeral?: boolean;
  }) => Promise<unknown>;
  reply?: (opts: {
    content: string;
    ephemeral?: boolean;
  }) => Promise<unknown>;
};

function postedByLabel(interaction: DiscordInteractionLike): string {
  return (
    interaction.member?.displayName ||
    interaction.user?.globalName ||
    interaction.user?.username ||
    interaction.user?.id ||
    "someone"
  );
}

async function ackEphemeral(
  interaction: DiscordInteractionLike,
  content: string,
): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply?.({ content });
      return;
    }
    await interaction.reply?.({ content, ephemeral: true });
  } catch {
    try {
      await interaction.followUp?.({ content, ephemeral: true });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Plugin event handler for DISCORD_INTERACTION.
 */
export async function handleBullpostDiscordInteraction(
  payload: Record<string, unknown>,
): Promise<void> {
  const runtime = payload.runtime as IAgentRuntime | undefined;
  const interaction = payload.discordInteraction as
    | DiscordInteractionLike
    | undefined;
  const meta = payload.interaction as { customId?: string } | undefined;

  if (!runtime || !interaction) return;

  const customId =
    (typeof interaction.customId === "string" && interaction.customId) ||
    (typeof meta?.customId === "string" ? meta.customId : "");
  const tweetId = parseRubyTweetCustomId(customId);
  if (!tweetId) return;

  // Only buttons — ignore other component types with a matching prefix.
  if (typeof interaction.isButton === "function" && !interaction.isButton()) {
    return;
  }

  logger.info({ tweetRecordId: tweetId }, `${LOG_PREFIX} button pressed`);

  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply?.({ ephemeral: true });
    }
  } catch {
    /* stale interaction */
  }

  const claim = claimBullpostTweetForPosting(tweetId);
  if (!claim.ok) {
    const messages: Record<typeof claim.reason, string> = {
      missing: "That bullpost expired from local state — ask for a fresh suggestion.",
      locked: "🔒 Already locked — this copy was tweeted before. No doubles.",
      already_posted: "🔒 Already tweeted — this one's locked forever.",
      in_flight: "⏳ Already posting — hang tight.",
    };
    await ackEphemeral(interaction, messages[claim.reason]);
    return;
  }

  const record = claim.record;
  const result = await postBullpostTweet(record.text);

  if (!result.ok) {
    releaseBullpostTweetClaim(tweetId, result.error);
    await ackEphemeral(
      interaction,
      `❌ Couldn't post to X:\n${result.error}${
        result.needsAuth
          ? "\n\nOps: run `xurl auth status` on the agent host and finish oauth2."
          : ""
      }`,
    );
    return;
  }

  const who = postedByLabel(interaction);
  finalizeBullpostTweetPosted({
    id: tweetId,
    tweetId: result.tweetId,
    tweetUrl: result.tweetUrl,
    postedBy: who,
  });

  if (record.discordChannelId && record.discordMessageId) {
    await disableBullpostTweetButton(runtime, {
      channelId: record.discordChannelId,
      messageId: record.discordMessageId,
      label: "✅ Tweeted",
    });
  }

  const dryRun = Boolean(
    result.raw &&
      typeof result.raw === "object" &&
      (result.raw as { dryRun?: boolean }).dryRun,
  );

  const proclaim = buildLoudTweetProclaim({
    text: record.text,
    tweetUrl: result.tweetUrl,
    postedByLabel: who,
    dryRun,
  });
  await sendLoudTweetProclaim(runtime, proclaim);

  await ackEphemeral(
    interaction,
    dryRun
      ? `✅ Dry-run locked + proclaimed (no real X post).\n${result.tweetUrl}`
      : `✅ Tweeted + locked.\n${result.tweetUrl}`,
  );

  logger.info(
    {
      tweetRecordId: tweetId,
      tweetId: result.tweetId,
      who,
      dryRun,
    },
    `${LOG_PREFIX} tweet posted and locked`,
  );
}

/** Bind message id onto a pending record after Discord send. */
export function attachDiscordMessageToTweetRecord(
  id: string,
  discordMessageId: string | null,
  discordChannelId: string | null,
): void {
  updateBullpostTweetRecord(id, {
    discordMessageId,
    discordChannelId,
  });
}
