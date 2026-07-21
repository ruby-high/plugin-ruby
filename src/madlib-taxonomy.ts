/**
 * Canonical mad-lib enums — themes and blank types.
 *
 * WHY one module (mirrors trivia-taxonomy.ts): madlib-authoring, any future RUBY_OBJECTS view,
 * and the eventual `/api/admin/madlibs` server schema must share one list instead of drifting
 * copies. Blank types are a CLOSED set because the game UI renders a keyboard hint per type and
 * cannot label a type the model invents ("gerund-of-motion").
 */

/** Story settings. Deliberately generic and family-safe — a theme is a setting, not a fact to check. */
export const MADLIB_THEMES = [
  "adventure",
  "sci-fi",
  "fantasy",
  "mystery",
  "school",
  "sports",
  "cooking",
  "space",
  "underwater",
  "haunted",
  "office",
  "road-trip",
  "pirates",
  "superhero",
  "wildlife",
] as const;

/** Word classes a player can be prompted for. Each must have a UI label + keyboard hint. */
export const MADLIB_BLANK_TYPES = [
  "noun",
  "plural-noun",
  "adjective",
  "adverb",
  "verb",
  "verb-past",
  "verb-ing",
  "person",
  "place",
  "animal",
  "food",
  "color",
  "number",
  "exclamation",
  "body-part",
  "occupation",
] as const;

/** Story length target — drives blank count and prose volume in the prompt. */
export const MADLIB_LENGTHS = ["short", "medium", "long"] as const;

export type MadlibTheme = (typeof MADLIB_THEMES)[number];
export type MadlibBlankType = (typeof MADLIB_BLANK_TYPES)[number];
export type MadlibLength = (typeof MADLIB_LENGTHS)[number];

/** Playable range. Under 3 isn't a mad lib; over 12 is a form to fill out, not a story. */
export const MADLIB_MIN_BLANKS = 3;
export const MADLIB_MAX_BLANKS = 12;

export function isMadlibTheme(value: string): value is MadlibTheme {
  return (MADLIB_THEMES as readonly string[]).includes(value);
}

export function isMadlibBlankType(value: string): value is MadlibBlankType {
  return (MADLIB_BLANK_TYPES as readonly string[]).includes(value);
}

/** Blank-count target per length; the prompt asks for this, validation enforces the hard range. */
export function blanksForLength(length: MadlibLength): number {
  const byLength: Record<MadlibLength, number> = { short: 4, medium: 6, long: 9 };
  return byLength[length];
}

/** Compact taxonomy block, matching formatQuestionTaxonomyGuide's shape. */
export function formatMadlibTaxonomyGuide(): string {
  return `[RUBY OBJECTS — mad lib taxonomy]
Themes (${MADLIB_THEMES.length}): ${MADLIB_THEMES.join(", ")}
Blank types (${MADLIB_BLANK_TYPES.length}): ${MADLIB_BLANK_TYPES.join(", ")}
Lengths: ${MADLIB_LENGTHS.join(", ")} (blanks per story ${MADLIB_MIN_BLANKS}-${MADLIB_MAX_BLANKS})
A blank in the story text is written {N:type}, e.g. {1:adjective}; indices are 1..N, each used once.`;
}
