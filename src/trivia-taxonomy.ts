/**
 * Canonical trivia enums — mirrors ruby-trivia server Zod schemas.
 *
 * WHY one module:
 * - question-authoring, RUBY_OBJECTS, and api-limits must stay aligned with
 *   server/admin/routes.ts without duplicating drift-prone string lists.
 */

export const TRIVIA_CATEGORIES = [
  "history",
  "science",
  "geography",
  "world-geography",
  "film",
  "comics",
  "cartoons",
  "pop-culture",
  "sports",
  "literature",
  "technology",
  "art",
  "music",
  "general",
] as const;

export const TRIVIA_DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;

export const TRIVIA_LANGUAGES = [
  "en",
  "zh",
  "ko",
  "ja",
  "es",
  "fr",
  "de",
  "it",
  "hu",
] as const;

export const ACHIEVEMENT_TRIGGERS = [
  "answer_submitted",
  "daily_quiz_completed",
  "rush_hour_completed",
  "login_streak",
  "friend_added",
  "manual",
] as const;

export type TriviaCategory = (typeof TRIVIA_CATEGORIES)[number];
export type TriviaDifficulty = (typeof TRIVIA_DIFFICULTIES)[number];
export type TriviaLanguage = (typeof TRIVIA_LANGUAGES)[number];

export function isTriviaCategory(value: string): value is TriviaCategory {
  return (TRIVIA_CATEGORIES as readonly string[]).includes(value);
}

/** Compact taxonomy block for RUBY_OBJECTS — categories, tiers, locales, triggers. */
export function formatQuestionTaxonomyGuide(): string {
  return `[RUBY OBJECTS — taxonomy]
Categories (${TRIVIA_CATEGORIES.length}): ${TRIVIA_CATEGORIES.join(", ")}
Difficulties: ${TRIVIA_DIFFICULTIES.join(", ")}
Question locales (optional on create/list): ${TRIVIA_LANGUAGES.join(", ")} (default en)
Question filters: category (slug or list via list_categories), difficulty (easy|medium|hard|expert), source (static|dynamic), status (active|hidden), language, culture, translationSuitable, locale
Achievement triggers: ${ACHIEVEMENT_TRIGGERS.join(", ")}
Player coaching: learnGoals on list_users / get_user_knowledge (max 1000 chars) — use for remedial dailies/challenges; never expose email in public chat.`;
}
