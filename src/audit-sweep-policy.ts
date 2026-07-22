/**
 * Pure decision logic for the audit sweep — prompt text and verdict-to-action translation.
 *
 * WHY a separate module: `audit-sweep.ts` imports `@elizaos/core` at module load, which is a
 * workspace dependency of the private eliza-ruby monorepo. Keeping the rules here means they are
 * importable, testable, and reviewable without a runtime. Same split as the trivia server's
 * `x-poll-fit.ts`. No imports on purpose - keep it that way.
 */

/** Warnings worth a second opinion. Codes outside this list are noise we deliberately tolerate. */
export const SWEEPABLE_ISSUE_CODES = [
  "verbose_options",
  "missing_explanation",
  "short_question",
  "duplicate_options",
  "placeholder_options",
] as const;

export type SweepVerdict = "keep" | "hide" | "needs_human";

export interface AuditQuestionItem {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string | null;
  category?: string;
  difficulty?: string;
  audit?: { issues?: { code: string; severity: string; message?: string }[] };
}

export interface SweepJudgement {
  verdict: SweepVerdict;
  reason: string;
  /** False when the judge was unreachable or returned garbage - we then leave the row alone. */
  judgeOk: boolean;
}

export interface AuditSweepCycleResult {
  scanned: number;
  hidden: number;
  kept: number;
  flaggedForHuman: number;
  skipped: number;
  errors: string[];
}

/** Server's reason column limit. */
export const MAX_REASON_CHARS = 280;

export function buildSweepPrompt(item: AuditQuestionItem): string {
  const codes = (item.audit?.issues ?? []).map((i) => `${i.code} (${i.severity})`).join(", ");
  const options = item.options
    .map((opt, index) => `${index + 1}. ${opt}${index === item.correctIndex ? "  <- correct" : ""}`)
    .join("\n");

  return `You are reviewing a live trivia question that an automated check flagged as questionable.
It is currently PLAYABLE. Decide whether it should stay that way.

Question: ${item.question}
Options:
${options}
Explanation: ${item.explanation?.trim() || "(none)"}
Automated flags: ${codes || "(none)"}

The automated check already confirmed the question is structurally valid. Judge only what a rule
cannot:
1. Is the correct answer actually correct, and the only correct one?
2. Would a player be confused or misled by the wording or the distractors?
3. Are the options short enough to read on a phone or an X poll button (about 25 characters)?
4. Is it factually current and not ambiguous?

Return ONLY this JSON (no other text):
{"verdict":"keep|hide|needs_human","reason":"one sentence"}

- keep: a player would be fine with this; the flag was cosmetic
- hide: wrong, misleading, ambiguous, or unreadable at size - pull it from the bank
- needs_human: you genuinely cannot tell without a subject expert or a source check`;
}

/**
 * Translate verdicts into one batch call. `hide` pulls the question; `needs_human` leaves it
 * playable but marks it so a person can find it. `keep` is deliberately a no-op - we do NOT clear
 * the flag, because the judge is not authoritative enough to overrule the deterministic check.
 *
 * Judgements with `judgeOk: false` are dropped entirely, including `hide`. Fail-closed: an
 * unreachable judge must never remove a question that live players can currently answer.
 */
export function buildAuditActions(
  judged: { item: AuditQuestionItem; judgement: SweepJudgement }[],
  logPrefix = "[AuditSweep]",
): { questionId: string; action: string; reason: string }[] {
  return judged
    .filter(({ judgement }) => judgement.judgeOk)
    .filter(({ judgement }) => judgement.verdict === "hide" || judgement.verdict === "needs_human")
    .map(({ item, judgement }) => ({
      questionId: item.id,
      action: judgement.verdict === "hide" ? "hide" : "needs_human",
      reason: `${logPrefix} ${judgement.reason}`.slice(0, MAX_REASON_CHARS),
    }));
}

export function summarizeCycle(result: AuditSweepCycleResult): string {
  return `scanned ${result.scanned}, hid ${result.hidden}, kept ${result.kept}, flagged ${result.flaggedForHuman} for a human, skipped ${result.skipped}`;
}

/** Recognise only the verdicts `buildAuditActions` understands; anything else is judge garbage. */
export function isSweepVerdict(value: unknown): value is SweepVerdict {
  return value === "keep" || value === "hide" || value === "needs_human";
}
