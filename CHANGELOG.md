# Changelog

## Unreleased

- Moved proactive community daily publish off the agent into the ruby-trivia background worker (CT105). Pulse/Discord and question authoring stay here; API `resolveOrGenerateDailyPollQuestion` remains the last-resort fallback for X-poll.


All notable changes to `@elizaos/plugin-ruby` are documented here.
This project follows [Semantic Versioning](https://semver.org/) where the published package uses it; monorepo consumers may pin `workspace:*`.

## [Unreleased] — 2.1.0 operator-complete

### Changed

- **Pulse cursor is durable on disk** — `pulse-state.json` under the Eliza state dir advances `since=` across restarts; announced keys are marked after each digest attempt.
  **Why:** `runtime.setSetting` does not survive process restart, so cold-start was re-announcing the same hour of events (duplicate Discord pulses).

- **Pulse Discord digests filter bots** — skip multi-account fingerprint users and routine crew practice scores (`scored N in …`) before announcing.
  **Why:** Farm/grind accounts were flooding `#clanker` every 5 minutes; RUBY-AGENT already says to check fingerprints before trusting growth.

- **Production OpenAPI sync** — 16 new `RUBY_TRIVIA` ops: audit API, categories, analytics, locale coverage, feedback, `get_openapi`; `expert` difficulty; `hasLearnGoals` on `list_users`; `locale` on create_question.
- **ruby-trivia sync (2026-06-05)** — Added French (`fr`) to question locales; `ActiveChallenge` type and formatters match `GET /api/admin/challenges` (`assignedDate`, `name`, `completed`, …).

### Added

- **ruby-trivia sync (2026-06)** — `trivia-taxonomy.ts` mirrors server enums; `learnGoals` on users/knowledge; question i18n fields (`language`, `culture`, `translationSuitable`); achievement group `members[]`; email stripped from operator payloads.
  **Why:** ruby-trivia admin API grew (locales, coaching fields, feedback/locale routes); plugin must match server Zod or the LLM invents wrong shapes.

- **Domain object catalog** — `types/domain.ts`, `domain-catalog.ts` (22 nouns), `domain-views.ts` (summary / listing / detail formatters).
  **Why:** The admin API exposes many nouns (User, PublishedDaily, WeakCategory, …); the LLM needs a stable vocabulary and op routing every turn, not ad-hoc guessing.

- **`RUBY_OBJECTS` provider** — Injects catalog, routing guide, and structured cached views (timeline bullets, live rooms, weak-category easiness, difficulty tiers).
  **Why:** Taxonomy belongs in prompt context; markdown docs in the repo are not readable at runtime.

- **`RUBY_PLATFORM` provider** — Live cache with freshness lines, counts, highlights, weak category names, stale refresh hints.
  **Why:** Operators ask "how are players doing?" every turn; cache-first reads avoid hammering the API and give explicit freshness guarantees.

- **Platform cache** — `platform-cache.ts` with TTL slices (happenings 5m, community 15m), populated by `RubyTriviaPulseService`.
  **Why:** Pulse already pays for API calls; repeating them on every chat turn wastes latency. Community refreshes every 3rd pulse because SM-2 aggregates change slowly.

- **Stale refresh hints** — `getStaleRefreshOps()` maps expired slices to `RUBY_TRIVIA` ops (`health`, `poll_happenings`, `get_community`, …).
  **Why:** When cache is stale, the LLM must know which op to call — not guess from memory.

- **Full Ruby Trivia admin API surface** — `RUBY_TRIVIA` action routes 20 `op` values through `admin-ops.ts`.
  **Why:** The operator manual describes workflows Ruby must run; one router keeps the LLM tool surface small while handlers stay typed.

- **`RubyTriviaPulseService` + 5-minute scheduled pulse** — Polls happenings, persists cursor, fills cache, Discord digests/outage alerts.
  **Why:** Operators need ambient awareness without asking Ruby every turn.

- **Persisted pulse cursor and announced-key dedup** — `RUBY_PULSE_LAST_GENERATED_AT` and `RUBY_PULSE_ANNOUNCED_KEYS` via `runtime.setSetting`.
  **Why:** Restarts must not replay Discord digests or miss events between polls.

- **Discord digests and outage alerts** — Cool events batched per poll; throttled outage messages after 30 minutes.
  **Why:** Platform owner should notice outages and celebrations without notification spam.

- **`admin-client.ts`** — Shared authenticated fetch, timeouts, HTTP error mapping, public-safe summarizers.
  **Why:** Actions and pulse share auth and error semantics; duplicating fetch logic would drift from `ADMIN-API.md`.

- **`CHECK_TRIVIA_VISITS` compat alias** — Thin wrapper over `op=health`.
  **Why:** Existing prompts reference the old action name; removing it breaks deployed agents mid-upgrade.

- **Test suite** — 36 cases across config, pulse state, admin client, ops, announcements, pulse service, domain catalog/views, platform cache, character fixture.
  **Why:** Operator tooling touches production trivia data; regressions in cache freshness or outage throttling are expensive live.

- **`RUBY_API_LIMITS` provider** — Can/cannot access boundaries, write guardrails (4xx), public-chat rules, sacred default.
  **Why:** OBJECTS catalog describes nouns; LIMITS describes forbidden paths so the LLM does not invent `/api/me` ops or auto-publish.

### Changed

- **Provider order** — `RUBY_CONTEXT` → `RUBY_API_LIMITS` → `RUBY_OBJECTS` → `RUBY_PLATFORM`.
  **Why:** Boundaries before taxonomy; playbook before numbers.

- **Provider deduplication** — PLATFORM owns counts/highlights; OBJECTS owns structured listings only (no duplicate health/happenings summary lines).
  **Why:** Context window is finite; repeating the same numbers in two providers wastes tokens.

- **`admin-ops.ts` formatters** — List/detail ops use `formatObjectListing` / `formatObjectDetail` with public-safe `userFacingText`.
  **Why:** Consistent shapes per API-OBJECTS.md; Discord never sees infra strings.

- **Plugin init** — Pulse via `services: [RubyTriviaPulseService]` only; no second `registerService` in `init`.
  **Why:** Double registration created duplicate service instances.

- **Pulse task timing** — First tick deferred with `setTimeout(tick, 0)`.
  **Why:** Immediate tick raced service registration during boot.

- **In-memory pulse state** — Loaded at service `start()`, not reloaded every poll.
  **Why:** Reloading masked silent `setSetting` failures and added I/O.

- **Bool settings** — Any explicit non-false value enables flags.
  **Why:** Operators use mixed env/dashboard truthy strings.

### Fixed

- **Health reply formatting** — `userFacingText` + `verifiedUserFacing: true` on all ops.
  **Why:** Planner otherwise paraphrases tool output and drops structured details.

- **Public chat infra leaks** — Sanitized health/failure messages; no URLs, hosts, or model names in Discord.
  **Why:** Ruby posts to public channels; infra strings confuse players and leak deployment details.

- **Double Discord messages** — Removed action handler callbacks.
  **Why:** Handler + planner both posted the health result.

- **Award achievement false path** — Non-award returns accurate user-facing text.
  **Why:** `earned_badge` formatter previously said "awarded" even when `awarded: false`.

- **Community WeakCategory listing** — No fabricated `meanEasiness: 0` from overview slice.
  **Why:** Overview only has category names; showing zero easiness misled the LLM.

- **Outage throttle timing** — Post–30-minute alerts use `(failures - 6) % 3 === 0`.
  **Why:** First throttled alert lands at ~45 minutes, not ~35.

### Documentation

- **README**, **AGENTS.md** / **CLAUDE.md**, **docs/DESIGN.md**, **docs/API-OBJECTS.md**, **ROADMAP.md**, and inline WHY comments across source modules.

---

## [2.0.3-beta.1] — prior baseline

- Ruby character loader from eliza config (`getRubyCharacter`, `applyRubyCharacter`).
- `RUBY_CONTEXT` provider with basic persona hints.
- `CHECK_TRIVIA_VISITS` health probe stub.
- Auto-enable when agent is named Ruby or `config.features.ruby` is on.
- No admin API router, scheduled pulse, platform cache, or Discord announcements.
