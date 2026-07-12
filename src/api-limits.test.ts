import { describe, expect, it } from "vitest";
import { buildApiLimitsContext, formatApiLimitsGuide } from "./api-limits.js";

describe("api-limits", () => {
  it("lists accessible and forbidden surfaces", () => {
    const guide = formatApiLimitsGuide(
      buildApiLimitsContext({
        analyticsSecret: "test-secret",
        pulseIntervalMinutes: 5,
        questionAuthoringIntervalMinutes: 60,
        questionsPerCycle: 1,
      }),
    );
    expect(guide).toContain("[RUBY API LIMITS]");
    expect(guide).toContain("What you CAN access");
    expect(guide).toContain("What you CANNOT access");
    expect(guide).toContain("/api/me/*");
    expect(guide).toContain("Sacred default");
    expect(guide).toContain("Background authoring");
    expect(guide).toContain("learnGoals");
    expect(guide).toContain("get_openapi");
    expect(guide).toContain("list_audit_questions");
    expect(guide).toContain("422 pre-insert audit");
    expect(guide).toContain("configured");
  });

  it("warns when admin secret is missing", () => {
    const guide = formatApiLimitsGuide(
      buildApiLimitsContext({
        analyticsSecret: null,
        pulseIntervalMinutes: 5,
        questionAuthoringIntervalMinutes: 60,
        questionsPerCycle: 1,
      }),
    );
    expect(guide).toContain("NOT configured");
  });
});
