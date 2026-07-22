/**
 * Pull snackable trivia from the Ruby question bank for bullpost authoring.
 *
 * WHY: concrete Q/A beats generic "play trivia" vibes — and gives the writer
 * optional real material to tease (without forcing a quiz dump into every tweet).
 */
import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { rubyAdminFetch } from "./admin-client.js";
import { TRIVIA_CATEGORIES } from "./trivia-taxonomy.js";
import type { QuestionListResponse } from "./types/domain.js";

const LOG_PREFIX = "[BullpostTrivia]";

export type TriviaSnack = {
  id: string;
  category: string;
  difficulty: string;
  question: string;
  answer: string;
};

function pickRandom<T>(items: T[], n: number, rng = Math.random): T[] {
  if (items.length <= n) return [...items];
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}

/** Map day-aspect keywords → likely bank categories (soft hints, not a hard filter). */
export function categoriesForAspect(aspect: string | null | undefined): string[] {
  const a = (aspect ?? "").toLowerCase();
  const hits: string[] = [];
  const rules: Array<[RegExp, string[]]> = [
    [/science|space|planet|chem|bio/i, ["science"]],
    [/histor|war|ancient|civil/i, ["history"]],
    [/geo|country|continent|capital|map/i, ["world-geography", "geography"]],
    [/movie|film|tv|cinema/i, ["film"]],
    [/music|song|band/i, ["music"]],
    [/comic|superhero|marvel|dc/i, ["comics"]],
    [/cartoon|anime/i, ["cartoons"]],
    [/pop.?culture|celebrity/i, ["pop-culture"]],
    [/sport|olymp|ball|game night/i, ["sports"]],
    [/book|literatur|novel/i, ["literature"]],
    [/tech|computer|ai|internet/i, ["technology"]],
    [/art|paint|museum/i, ["art"]],
  ];
  for (const [re, cats] of rules) {
    if (re.test(a)) hits.push(...cats);
  }
  // Prefer taxonomy ids that actually exist
  const known = new Set(TRIVIA_CATEGORIES.map((c) => c.toLowerCase()));
  const filtered = hits.filter((c) => known.has(c.toLowerCase()));
  return filtered.length > 0 ? [...new Set(filtered)] : [];
}

function toSnack(q: {
  id?: string;
  category?: string;
  difficulty?: string;
  question?: string;
  options?: string[];
  correctIndex?: number;
}): TriviaSnack | null {
  if (typeof q.question !== "string" || !q.question.trim()) return null;
  if (!Array.isArray(q.options) || q.options.length < 4) return null;
  const idx =
    typeof q.correctIndex === "number" &&
    q.correctIndex >= 0 &&
    q.correctIndex < q.options.length
      ? q.correctIndex
      : 0;
  const answer = q.options[idx];
  if (typeof answer !== "string" || !answer.trim()) return null;
  return {
    id: typeof q.id === "string" ? q.id : "unknown",
    category: typeof q.category === "string" ? q.category : "general",
    difficulty: typeof q.difficulty === "string" ? q.difficulty : "medium",
    question: q.question.trim(),
    answer: answer.trim(),
  };
}

async function fetchCategorySample(
  runtime: IAgentRuntime,
  category: string | undefined,
  difficulty?: string,
): Promise<TriviaSnack[]> {
  const query = new URLSearchParams();
  if (category) query.set("category", category);
  if (difficulty) query.set("difficulty", difficulty);
  // Prefer live bank entries when present; fall back is whatever the API returns.
  query.set("status", "active");
  const path = `/api/admin/questions?${query.toString()}`;
  const result = await rubyAdminFetch<QuestionListResponse>(
    runtime,
    "GET",
    path,
  );
  if (!result.ok) {
    // Retry without status filter — some banks omit status.
    const fallback = new URLSearchParams();
    if (category) fallback.set("category", category);
    if (difficulty) fallback.set("difficulty", difficulty);
    const retry = await rubyAdminFetch<QuestionListResponse>(
      runtime,
      "GET",
      `/api/admin/questions?${fallback.toString()}`,
    );
    if (!retry.ok) return [];
    return (retry.data.questions ?? [])
      .map(toSnack)
      .filter((s): s is TriviaSnack => Boolean(s));
  }
  return (result.data.questions ?? [])
    .map(toSnack)
    .filter((s): s is TriviaSnack => Boolean(s));
}

/**
 * Fetch a handful of real bank snacks for the authoring prompt.
 * Mixes aspect-related categories with a couple random ones for surprise.
 */
export async function fetchTriviaSnacksForBullpost(
  runtime: IAgentRuntime,
  opts: { dayAspect?: string | null; count?: number } = {},
): Promise<TriviaSnack[]> {
  const want = Math.max(2, Math.min(6, opts.count ?? 4));
  const aspectCats = categoriesForAspect(opts.dayAspect);
  const randomCats = pickRandom([...TRIVIA_CATEGORIES], 3);
  const categories = [
    ...aspectCats.slice(0, 2),
    ...randomCats.filter((c) => !aspectCats.includes(c)),
  ].slice(0, 4);

  const pools: TriviaSnack[] = [];
  for (const category of categories) {
    try {
      // Pull approachable difficulties first — better RT fuel than expert dumps.
      for (const difficulty of ["easy", "medium"] as const) {
        const sample = await fetchCategorySample(runtime, category, difficulty);
        pools.push(...pickRandom(sample, 2));
      }
    } catch (error) {
      logger.debug(
        { error, category },
        `${LOG_PREFIX} category fetch failed`,
      );
    }
  }

  // Broad fallback if category filters yielded nothing
  if (pools.length < 2) {
    try {
      const broad = await fetchCategorySample(runtime, undefined);
      pools.push(...pickRandom(broad, want * 2));
    } catch (error) {
      logger.warn({ error }, `${LOG_PREFIX} broad fetch failed`);
    }
  }

  const unique = new Map<string, TriviaSnack>();
  for (const snack of pools) {
    if (!unique.has(snack.id)) unique.set(snack.id, snack);
  }
  // Prefer easy/medium for social — expert dumps rarely get RTs.
  const all = [...unique.values()];
  const approachable = all.filter((s) =>
    /^(easy|medium)$/i.test(s.difficulty),
  );
  const pool = approachable.length >= Math.min(2, want) ? approachable : all;
  const picked = pickRandom(pool, want);
  logger.info(
    {
      count: picked.length,
      categories: [...new Set(picked.map((s) => s.category))],
      aspectCats,
    },
    `${LOG_PREFIX} loaded snacks`,
  );
  return picked;
}

export function formatTriviaSnacksForPrompt(snacks: TriviaSnack[]): string {
  if (snacks.length === 0) return "";
  const lines = snacks.map(
    (s, i) =>
      `${i + 1}. [${s.category}/${s.difficulty}] Q: ${s.question}\n   A: ${s.answer}`,
  );
  return `REAL TRIVIA FROM THE RUBY BANK (optional fuel — use ONLY if it elevates the tweet):
${lines.join("\n")}

TRIVIA USAGE RULES:
- Including trivia is optional. Skip it if it feels forced for today's marketing point.
- If you use one, prefer a tease/hook (challenge, "most people get this wrong", parents-vs-kids stake) — not a dry Q&A dump.
- You may reveal the answer OR withhold it for engagement — whichever is more shareable.
- Never invent facts. Only use snacks listed above.
- Still zero URLs. Still lead with $RUBY / RUBY energy.`;
}
