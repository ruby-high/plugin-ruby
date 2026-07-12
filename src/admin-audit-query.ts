/**
 * Query builders for /api/admin/audit/* list routes.
 * Mirrors OpenAPI parameters in ruby-trivia server/admin/openapi.ts.
 */

export const AUDIT_LIST_QUERY_KEYS = [
  "createdBy",
  "status",
  "category",
  "difficulty",
  "locale",
  "language",
  "minDifficulty",
  "maxDifficulty",
  "needsReview",
  "issueCode",
  "hasIssueCode",
  "minSeverity",
  "missingField",
  "createdAfter",
  "format",
  "limit",
  "cursor",
  "offset",
] as const;

export type AuditListQueryKey = (typeof AUDIT_LIST_QUERY_KEYS)[number];

type QueryReader = {
  readString: (key: string) => string | undefined;
  readNumber: (key: string) => number | undefined;
  readBoolean: (key: string) => boolean | undefined;
};

export function buildAuditListQuery(
  reader: QueryReader,
  extra: Record<string, string | number | boolean | undefined> = {},
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  for (const key of AUDIT_LIST_QUERY_KEYS) {
    const stringValue = reader.readString(key);
    if (stringValue !== undefined) {
      search.set(key, stringValue);
      continue;
    }
    const numberValue = reader.readNumber(key);
    if (numberValue !== undefined) {
      search.set(key, String(numberValue));
      continue;
    }
    const boolValue = reader.readBoolean(key);
    if (boolValue !== undefined) {
      search.set(key, String(boolValue));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}
