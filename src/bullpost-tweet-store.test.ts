import { describe, expect, it } from "vitest";
import {
  buildRubyTweetCustomId,
  claimBullpostTweetForPosting,
  createBullpostTweetId,
  finalizeBullpostTweetPosted,
  fingerprintBullpostText,
  parseRubyTweetCustomId,
  registerPendingBullpostTweet,
  releaseBullpostTweetClaim,
} from "./bullpost-tweet-store.js";
import { buildLoudTweetProclaim } from "./bullpost-tweet-post.js";

describe("bullpost-tweet-store", () => {
  it("fingerprints ignore case/whitespace", () => {
    expect(fingerprintBullpostText("Hello  RUBY")).toBe(
      fingerprintBullpostText("hello ruby"),
    );
  });

  it("parses custom ids", () => {
    const id = createBullpostTweetId();
    const custom = buildRubyTweetCustomId(id);
    expect(parseRubyTweetCustomId(custom)).toBe(id);
    expect(parseRubyTweetCustomId("nope")).toBeNull();
  });

  it("locks after finalize and rejects second claim", () => {
    const pending = registerPendingBullpostTweet({
      text: `Unique lock test ${Date.now()} 💎 with enough characters here.`,
    });
    const claim1 = claimBullpostTweetForPosting(pending.id);
    expect(claim1.ok).toBe(true);
    finalizeBullpostTweetPosted({
      id: pending.id,
      tweetId: "123",
      tweetUrl: "https://x.com/i/web/status/123",
      postedBy: "tester",
    });
    const pending2 = registerPendingBullpostTweet({ text: pending.text });
    const claim2 = claimBullpostTweetForPosting(pending2.id);
    expect(claim2.ok).toBe(false);
  });

  it("releases failed claims so a retry can proceed", () => {
    const pending = registerPendingBullpostTweet({
      text: `Retryable draft ${Date.now()} 💎 enough length for clean.`,
    });
    expect(claimBullpostTweetForPosting(pending.id).ok).toBe(true);
    releaseBullpostTweetClaim(pending.id, "boom");
    const again = claimBullpostTweetForPosting(pending.id);
    expect(again.ok).toBe(true);
    releaseBullpostTweetClaim(pending.id, "cleanup");
  });
});

describe("bullpost-tweet-post", () => {
  it("builds a loud proclaim", () => {
    const msg = buildLoudTweetProclaim({
      text: "Meet $RUBY 💎",
      tweetUrl: "https://x.com/i/web/status/1",
      postedByLabel: "Odilitime",
    });
    expect(msg).toContain("TWEET IS LIVE");
    expect(msg).toContain("Odilitime");
    expect(msg).toContain("locked");
  });
});
