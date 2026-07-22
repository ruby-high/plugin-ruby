/**
 * $RUBY bullpost bank + suggester.
 *
 * WHY a bank (not pure LLM invent): operators want on-brand family/token voice that
 * matches shipped marketing copy — emoji-rich, no fluff links, $RUBY diamond cadence.
 */

export type BullpostTheme =
  | "intro"
  | "family"
  | "challenge"
  | "categories"
  | "token"
  | "learning"
  | "any";

export type Bullpost = {
  id: string;
  theme: Exclude<BullpostTheme, "any">;
  text: string;
};

/** Operator style rules — also injected via RUBY_BULLPOSTS provider. */
export const BULLPOST_STYLE_RULES = [
  "Emoji-rich and punchy; diamond 💎 is the signature.",
  "Lead with $RUBY or RUBY — brand first, not a buried mention.",
  "Family-friendly: kids, parents, friends, home game night.",
  "No marketing fluff phrases; concrete invite to play/compete/learn.",
  "Zero links in the first post (kills reach on X).",
  "Use em dashes (—) not en-dashes; clean line breaks, no extra blank spam.",
  "Token posts frame community/curiosity — not price, APY, or financial promises.",
  "Short paragraphs. One idea per beat. End with a hook or CTA when it fits.",
  "Open with a shareable hook — challenge, surprising beat, fill-in tease, or tag-a-friend energy.",
  "Ask: would someone RT/share this? If not, sharpen the hook or stakes.",
] as const;

/**
 * Canonical bullposts from Ruby Labs marketing voice.
 * Keep verbatim — these are the gold standard for SUGGEST_BULLPOST.
 */
export const BULLPOST_BANK: Bullpost[] = [
  {
    id: "meet-ruby",
    theme: "intro",
    text: `Meet $RUBY 💎

A trivia game built for curious minds of all ages. Gather the family, test your knowledge, and turn any night at home into game night.

Who is the trivia champion in your house? 🏆

Play RUBY, challenge your family, and finally settle the debate.`,
  },
  {
    id: "knowledge-meets-fun",
    theme: "intro",
    text: `$RUBY 💎

RUBY is where knowledge meets fun.

Easy to play. Fun to master. Made for kids, parents, friends, and trivia lovers everywhere. 💎`,
  },
  {
    id: "adventure-at-home",
    theme: "family",
    text: `You don't need to leave home to start an adventure.

With RUBY, every question opens the door to something new. Play, learn, laugh, and challenge the people you love.`,
  },
  {
    id: "game-night-upgrade",
    theme: "family",
    text: `Family game night just got an upgrade. 🎮💎

RUBY brings trivia, friendly competition, and crypto-powered community into one experience.`,
  },
  {
    id: "every-category",
    theme: "categories",
    text: `From science and history to movies, music, and everyday knowledge—RUBY has a question for everyone.

How many can you answer correctly? 💎`,
  },
  {
    id: "tests-your-mind",
    theme: "challenge",
    text: `Some games test your reflexes.

RUBY tests your mind. 🧠

Gather your team, choose your answers, and prove who knows the most.`,
  },
  {
    id: "everyone-vs-timer",
    theme: "challenge",
    text: `Kids versus parents.

Friends versus friends.

Everyone versus the timer.

Welcome to RUBY trivia. 💎`,
  },
  {
    id: "learning-feels-like-playing",
    theme: "learning",
    text: `RUBY was created with one simple goal:

Make learning feel like playing.

A trivia experience for all ages, designed to be enjoyed together at home.`,
  },
  {
    id: "celebrate-correct",
    theme: "family",
    text: `Every correct answer deserves a little celebration. 🎉

Play RUBY and turn everyday knowledge into unforgettable family moments.`,
  },
  {
    id: "think-you-know",
    theme: "challenge",
    text: `Think you know everything?

RUBY might have a few questions that change your mind. 💎`,
  },
  {
    id: "bring-people-together",
    theme: "family",
    text: `The best games bring people together.

RUBY creates moments where families can compete, laugh, learn, and make memories—all from home.`,
  },
  {
    id: "no-complicated-setup",
    theme: "intro",
    text: `No complicated setup.

No expensive equipment.

Just your knowledge, your family, and the RUBY trivia experience. 💎`,
  },
  {
    id: "category-pick",
    theme: "categories",
    text: `What category would you dominate?

🌍 Geography
🎬 Entertainment
🔬 Science
🏆 Sports
📚 History

RUBY has something for every kind of trivia player.`,
  },
  {
    id: "more-than-token",
    theme: "token",
    text: `RUBY is more than a cryptocurrency token.

It represents a growing trivia community built around curiosity, entertainment, and friendly competition. 💎`,
  },
  {
    id: "phones-down",
    theme: "family",
    text: `Put the phones down, gather around, and let the questions begin.

RUBY is bringing family trivia night back—with a modern twist.`,
  },
  {
    id: "one-question",
    theme: "learning",
    text: `One question can start a conversation.

One game can create a memory.

That's the idea behind RUBY. 💎`,
  },
  {
    id: "no-age-limit",
    theme: "family",
    text: `Trivia has no age limit.

Whether you're eight or eighty, RUBY gives everyone a chance to play, learn, and shine.`,
  },
  {
    id: "warning-one-more-round",
    theme: "family",
    text: `Warning: Playing RUBY may lead to unexpected knowledge, competitive family members, and requests for "just one more round." 💎`,
  },
  {
    id: "smartest-not-oldest",
    theme: "challenge",
    text: `The smartest person in the room isn't always the oldest.

RUBY gives every generation a chance to prove what they know. 🧠`,
  },
  {
    id: "household-token-community",
    theme: "token",
    text: `A game for the whole household.

A token for the community.

A new way to make knowledge entertaining.

Welcome to RUBY. 💎`,
  },
  {
    id: "tonights-challenge",
    theme: "challenge",
    text: `Tonight's challenge:

Gather your family, choose a trivia category, and see who earns the title of RUBY Champion. 🏆`,
  },
  {
    id: "not-homework",
    theme: "learning",
    text: `Learning doesn't have to feel like homework.

RUBY turns questions, answers, and discovery into a game everyone can enjoy.`,
  },
  {
    id: "great-conversations",
    theme: "learning",
    text: `Great trivia creates great conversations.

RUBY is designed to bring people together through knowledge, laughter, and friendly competition. 💎`,
  },
  {
    id: "ready-to-test",
    theme: "intro",
    text: `Ready to test what you know?

RUBY is the family-friendly trivia game where every question is a new opportunity to learn, compete, and have fun.

Let the game begin. 💎`,
  },
];

export const BULLPOST_THEMES: Exclude<BullpostTheme, "any">[] = [
  "intro",
  "family",
  "challenge",
  "categories",
  "token",
  "learning",
];

export function normalizeBullpostTheme(
  raw: string | null | undefined,
): BullpostTheme {
  const value = String(raw ?? "any")
    .trim()
    .toLowerCase();
  if (!value || value === "any" || value === "all" || value === "random") {
    return "any";
  }
  if ((BULLPOST_THEMES as string[]).includes(value)) {
    return value as Exclude<BullpostTheme, "any">;
  }
  // Soft aliases from operator chat
  if (/(family|home|kids|parents)/.test(value)) return "family";
  if (/(challenge|compete|champion|versus|vs)/.test(value)) return "challenge";
  if (/(categor|science|history|sport|geo|entertain)/.test(value)) {
    return "categories";
  }
  if (/(token|crypto|community|\$ruby)/.test(value)) return "token";
  if (/(learn|educat|homework|discover)/.test(value)) return "learning";
  if (/(intro|meet|welcome|start)/.test(value)) return "intro";
  return "any";
}

function shuffleInPlace<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

export function filterBullpostsByTheme(theme: BullpostTheme): Bullpost[] {
  if (theme === "any") return [...BULLPOST_BANK];
  return BULLPOST_BANK.filter((post) => post.theme === theme);
}

export type SuggestBullpostsOptions = {
  count?: number;
  theme?: string | null;
  /** Inject for tests */
  random?: () => number;
  /** Prefer posts whose ids are not in this set */
  excludeIds?: Iterable<string>;
};

export function suggestBullposts(
  options: SuggestBullpostsOptions = {},
): Bullpost[] {
  const count = Math.min(Math.max(options.count ?? 3, 1), 8);
  const theme = normalizeBullpostTheme(options.theme);
  const excluded = new Set(
    [...(options.excludeIds ?? [])].map((id) => String(id)),
  );
  const pool = filterBullpostsByTheme(theme);
  const fresh = pool.filter((post) => !excluded.has(post.id));
  const source = fresh.length > 0 ? fresh : pool;
  const shuffled = shuffleInPlace([...source], options.random);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export function formatBullpostSuggestions(posts: Bullpost[]): string {
  if (posts.length === 0) {
    return "No bullposts available for that theme.";
  }
  const blocks = posts.map(
    (post, index) =>
      `--- bullpost ${index + 1}/${posts.length} · ${post.theme} · ${post.id} ---\n${post.text}`,
  );
  return `Here are ${posts.length} on-brand $RUBY bullpost(s):\n\n${blocks.join("\n\n")}`;
}

/** Seed character.postExamples when empty — first lines of bank intros. */
export function defaultBullpostExamples(limit = 8): string[] {
  return BULLPOST_BANK.slice(0, limit).map((post) => post.text);
}

export function defaultBullpostStyleLines(): string[] {
  return [
    "emoji-rich $RUBY bullposts with 💎 signature",
    "family trivia night energy — kids, parents, friends",
    "no links in the first post; em dashes; clean line breaks",
    "never promise APY, price, or financial returns",
  ];
}
