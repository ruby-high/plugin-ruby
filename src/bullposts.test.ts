import { describe, expect, it } from "vitest";
import {
  BULLPOST_BANK,
  filterBullpostsByTheme,
  formatBullpostSuggestions,
  normalizeBullpostTheme,
  suggestBullposts,
} from "./bullposts.js";

describe("bullposts", () => {
  it("normalizes theme aliases", () => {
    expect(normalizeBullpostTheme("family night")).toBe("family");
    expect(normalizeBullpostTheme("TOKEN")).toBe("token");
    expect(normalizeBullpostTheme("")).toBe("any");
  });

  it("filters and suggests without repeating excluded ids when possible", () => {
    const family = filterBullpostsByTheme("family");
    expect(family.length).toBeGreaterThan(0);
    expect(family.every((post) => post.theme === "family")).toBe(true);

    let seq = 0;
    const random = () => {
      seq += 0.17;
      return seq % 1;
    };
    const first = suggestBullposts({ count: 2, theme: "any", random });
    expect(first).toHaveLength(2);

    const second = suggestBullposts({
      count: 2,
      theme: "any",
      random,
      excludeIds: first.map((post) => post.id),
    });
    expect(second).toHaveLength(2);
    const overlap = second.filter((post) =>
      first.some((prior) => prior.id === post.id),
    );
    expect(overlap).toHaveLength(0);
  });

  it("formats suggestions with $RUBY branding markers from the bank", () => {
    const posts = BULLPOST_BANK.slice(0, 1);
    const text = formatBullpostSuggestions(posts);
    expect(text).toContain("bullpost 1/1");
    expect(text).toMatch(/\$RUBY|RUBY/);
    expect(text).toContain(posts[0]!.text.split("\n")[0]!);
  });

  it("caps suggestion count", () => {
    expect(suggestBullposts({ count: 99 }).length).toBeLessThanOrEqual(8);
    expect(suggestBullposts({ count: 0 })).toHaveLength(1);
  });
});
