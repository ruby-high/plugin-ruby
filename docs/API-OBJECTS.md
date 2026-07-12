# Ruby Trivia API — domain objects

Catalog of **nouns** exposed by the Ruby Trivia admin API (`/api/admin/*` + `/api/health`). Each entry has a **summary** (one line), a **listing** shape (collections / indexes), and a **detail** shape (single record or write payload).

**HTTP reference:** `ruby-trivia/docs/ADMIN-API.md`  
**Ruby plugin ops:** `RUBY_TRIVIA` action (`admin-ops.ts`)  
**Runtime injection:** `RUBY_OBJECTS` provider (catalog + structured views)  
**Live numbers:** `RUBY_PLATFORM` provider (freshness + counts)  
**Code:** `domain-catalog.ts` (22 nouns), `domain-views.ts` (formatters), `types/domain.ts` (types), `platform-cache.ts` (TTL slices)

### Provider split (WHY)

| Provider | Shows | Does not show |
|----------|-------|---------------|
| `RUBY_PLATFORM` | Freshness, counts, highlights, weak category names, stale refresh ops | Full timeline bullets, easiness per category |
| `RUBY_OBJECTS` | Noun catalog, op routing, timeline/live-room/weak-category structured listings | Duplicate count lines from PLATFORM |

---

## Taxonomy (summary)

| Layer | Nouns | Purpose |
|-------|-------|---------|
| **Platform** | ServiceHealth, PlatformHappenings, HappeningTimelineItem, LiveSnapshot, LiveRoom | Is the game up? What happened recently? Who's in live queue? |
| **Community** | CommunityOverview, CommunityDifficulty, WeakCategory | Where is the player base struggling? |
| **Players** | User, UserKnowledgeProfile, Sm2Row | Who plays? What does one player need? |
| **Content** | Question, QuestionBank | What can be asked? Agent-authored bank rows. |
| **Dailies** | PublishedDaily, DailyPublishResult, DailyRevokeResult | Curated daily quizzes (community or per-user). |
| **Achievements** | AchievementDefinition, AchievementGroup, EarnedBadge, ActiveChallenge, UserAchievementStats | Badges, mastery groups, daily orders. |
| **Meta** | AgentDoc (Changelog) | What shipped? (product changes, not player activity) |

**Sacred default:** absent `PublishedDaily` → auto `pickDaily` for everyone.

---

## Quick listing (all objects)

| Noun | List endpoint / source | `RUBY_TRIVIA` op | Cached? |
|------|------------------------|------------------|---------|
| ServiceHealth | `GET /api/health` | `health` | Yes (5m) |
| PlatformHappenings | `GET /api/admin/happenings` | `poll_happenings` | Yes (5m) |
| HappeningTimelineItem | inside happenings `.timeline[]` | `poll_happenings` | Yes |
| LiveSnapshot | happenings `.live` | `poll_happenings` | Yes |
| LiveRoom | happenings `.live.rooms[]` | `poll_happenings` | Yes |
| CommunityOverview | `GET /api/admin/community` | `get_community` | Yes (15m) |
| CommunityDifficulty | `GET /api/admin/community/difficulty` | `get_community_difficulty` | Yes (15m) |
| WeakCategory | inside community responses | `get_community*` | Yes |
| User | `GET /api/admin/users` | `list_users` | No |
| UserKnowledgeProfile | `GET /api/admin/users/:id/knowledge` | `get_user_knowledge` | No |
| Sm2Row | inside knowledge `sm2Sample[]` | `get_user_knowledge` | No |
| Question | `GET /api/admin/questions` | `list_questions` | No |
| Question (create) | `POST /api/admin/questions` | `create_question` | — |
| Question (hide) | `PATCH /api/admin/questions/:id` | `hide_question` | — |
| PublishedDaily | `GET /api/admin/daily` | `list_dailies` | No |
| PublishedDaily (publish) | `POST /api/admin/daily/publish` | `publish_daily` | — |
| DailyRevokeResult | `DELETE /api/admin/daily/publish` | `revoke_daily` | — |
| AchievementDefinition | `GET /api/admin/achievements` | `list_achievements` | No |
| AchievementDefinition (create) | `POST /api/admin/achievements` | `create_achievement` | — |
| EarnedBadge (manual award) | `POST /api/admin/achievements/:id/award` | `award_achievement` | — |
| AchievementGroup | `GET /api/admin/achievement-groups` | `list_achievement_groups` | No |
| AchievementGroup (create) | `POST /api/admin/achievement-groups` | `create_achievement_group` | — |
| ActiveChallenge | `GET /api/admin/challenges` | `list_challenges` | No |
| ActiveChallenge (assign) | `POST /api/admin/challenges/assign` | `assign_challenges` | — |
| AgentDoc | `GET /api/admin/changelog` | `get_changelog` | No |

---

## Platform layer

### ServiceHealth

**Summary:** Liveness of the trivia API and optional AI assist (operator-internal detail; public replies are sanitized).

| View | Fields |
|------|--------|
| **Listing** | N/A — singleton probe |
| **Detail** | `ok`, `ai.enabled`, `ai.reachable`, `ai.model` (internal only) |

**Detail example (internal):**
```json
{ "ok": true, "ai": { "enabled": true, "reachable": true, "model": "llama3.2:3b" } }
```

**Public-safe summary:** `"Ruby Trivia is online. Game services are responding."`

**WHY:** Fast unauthenticated check before admin calls; distinguishes “server down” vs “bad secret”.

---

### PlatformHappenings

**Summary:** Unified “what’s going on” feed — analytics + crew + live state for one poll window.

| View | Fields |
|------|--------|
| **Listing** | One document per poll (`since` / `until` window) |
| **Detail** | `generatedAt`, `since`, `until`, `summary`, `live`, `timeline[]` |

**Summary block (counts):**

| Field | Meaning |
|-------|---------|
| `timelineCount` | Items in merged timeline |
| `registrations` | New signups in window |
| `dailyCompletions` | Daily quizzes finished |
| `badgeEarns` | Badges awarded |
| `liveQueueWaiting` | Players waiting for live match |
| `activeLiveRooms` | In-progress live rooms |
| `analyticsEventCounts` | Per-event tallies |
| `crewActivityCount` | Crew feed rows merged |

**WHY:** Agent situational awareness without per-answer noise (`includeAnswers=false` by default).

**Agent pattern:** store `generatedAt` → next poll `?since=<generatedAt>`.

---

### HappeningTimelineItem

**Summary:** One human-readable moment in the happenings feed.

| View | Fields |
|------|--------|
| **Listing** | `PlatformHappenings.timeline[]` (max `limit`, default 200) |
| **Detail** | `kind`, `at`, `event`, `userId`, `displayName`, `summary`, `data` |

| `kind` | Source |
|--------|--------|
| `analytics` | `analytics.db` events |
| `crew` | `crew_activity` social feed |

**Cool events (Discord digest):** `badge_earned`, `user_registered`, `referral_signup`, non-routine crew (not practice scores), streak ≥ 5 daily complete, live queue spike. Multi-account fingerprint users are filtered via `GET /api/analytics/device-fingerprints`.

**Routine (filtered):** `answer_submitted`, `user_login`, `login_failed`.

---

### LiveSnapshot

**Summary:** Current live matchmaking pressure.

| View | Fields |
|------|--------|
| **Listing** | Embedded in happenings (singleton per poll) |
| **Detail** | `queueWaiting`, `activeRooms`, `rooms[]` |

---

### LiveRoom

**Summary:** One active or waiting live trivia room.

| View | Fields |
|------|--------|
| **Listing** | `live.rooms[]` |
| **Detail** | `roomId`, `phase`, `playerCount`, `createdAt` |

**WHY:** Operator sees matchmaking backlog; complements `liveQueueWaiting` count.

---

## Community layer

### CommunityOverview

**Summary:** Bundled community health — overview + friction + difficulty signals.

| View | Fields |
|------|--------|
| **Listing** | N/A — aggregate document |
| **Detail** | `overview`, `friction`, `difficulty`, `weakCategories[]` |

**Query:** `?since=<ISO date>` optional window.

**WHY:** One call for “what should we publish today?” without stitching analytics + SM-2 manually.

---

### CommunityDifficulty

**Summary:** SM-2 aggregates — accuracy by difficulty tier + community weak categories.

| View | Fields |
|------|--------|
| **Listing** | `byDifficulty[]` — one row per difficulty tier |
| **Detail (tier)** | `difficulty`, `accuracy`, `attempts` |
| **Listing** | `weakCategories[]` |
| **Detail (weak)** | `category`, `meanEasiness`, `questions` |

**WHY read-only:** Does not change auto `pickDaily`; agent chooses explicitly at publish time.

---

### WeakCategory

**Summary:** A category the community retains poorly (low SM-2 easiness).

| View | Fields |
|------|--------|
| **Listing** | `weakCategories[]` on community endpoints |
| **Detail** | `category`, `meanEasiness` (overview) or `meanEasiness` + `questions` (difficulty) |

**Operator use:** pick remedial dailies, dynamic questions, or harder community publish.

---

## Player layer

### User

**Summary:** Registered player with progression summary.

| View | Fields |
|------|--------|
| **Listing** | `GET /api/admin/users` → `users[]`, `total` |
| **Detail** | Per-user fields from list payload (id, display, XP, level, `totalTracked` SM-2 rows) |

**Query:** `limit` (max 200), `offset`.

---

### UserKnowledgeProfile

**Summary:** One player’s learning gaps for remediation.

| View | Fields |
|------|--------|
| **Listing** | N/A — one profile per `userId` |
| **Detail** | Profile + `weakCategories[]` + `sm2Sample[]` (top 50 lowest easiness SM-2) + `learnGoals` |

**Endpoint:** `GET /api/admin/users/:userId/knowledge`

**WHY lowest easiness first:** Hardest-retained items are best remediation candidates.

**WHY learnGoals:** Player-stated study intent — use with weak categories for remedial dailies/challenges (never expose email in public chat).

---

### Sm2Row

**Summary:** Spaced-repetition state for one user × question pair.

| View | Fields |
|------|--------|
| **Listing** | `knowledge.sm2Sample[]` (sorted by lowest easiness) |
| **Detail** | Question id, category, easiness, interval, due state (per server shape) |

**WHY:** Drives per-user `publish_daily` and targeted coaching.

---

## Content layer

### Question

**Summary:** A trivia prompt (static JSON bank or agent-authored dynamic row).

| View | Fields |
|------|--------|
| **Listing** | `GET /api/admin/questions` → `questions[]`, `count` |
| **Detail** | `id`, `category`, `difficulty`, `question`, `options[4]`, `correctIndex`, `explanation`, `source`, `status`, `language`, `culture`, `translationSuitable` |

**Filters:** `category`, `difficulty`, `source` (`static`|`dynamic`), `status` (`active`|`hidden`), `language`, `culture`, `translationSuitable` (`true`|`false`).

| `status` | Behaviour |
|----------|-----------|
| *(omit / active)* | Playable bank (static + active dynamic) |
| `hidden` | Retired dynamic rows (admin only) |

**Create (write):** `POST /api/admin/questions` → ids `dyn-####`, `409` on duplicate text.

**Hide (write):** `PATCH …/:id` `{ "status": "hidden" }` — dynamic only; static is version-controlled JSON.

---

### QuestionBank

**Summary:** Merged static + dynamic question inventory (not a separate table — materialized by `loadQuestions()`).

| View | Fields |
|------|--------|
| **Listing** | `list_questions` with filters |
| **Detail** | Single `Question` |

**WHY dynamic in DB:** Agent writes via API; `invalidateQuestionCache()` picks up new rows without redeploy.

---

## Daily layer

### PublishedDaily

**Summary:** Agent-curated daily quiz for a date — community-wide or per-user.

| View | Fields |
|------|--------|
| **Listing** | `GET /api/admin/daily` → `publishes[]` |
| **Detail** | `date`, `scope` (`community`|`user`), `userId?`, `gameId`, `questionIds[]`, `notes`, `turn_ids` |

**Priority at play time:** per-user publish → community publish → cached `daily_turn_ids` → auto `pickDaily`.

---

### DailyPublishResult

**Summary:** Outcome of `POST /api/admin/daily/publish`.

| View | Fields |
|------|--------|
| **Detail** | `date`, `scope`, `questionIds[]`, `notes`, `difficultyBreakdown`, `warnings[]` |

**Guardrails:** `422` missing IDs, `409` existing (use `force: true`), warnings if date in past.

---

### DailyRevokeResult

**Summary:** Outcome of revoking a publish — returns to auto daily for unaffected users.

| View | Fields |
|------|--------|
| **Detail** | `revokedAt`, `affectedUsersEstimate` |

**WHY estimate:** Users who have not locked in that date's daily still pick up the published set.

---

## Achievement layer

### AchievementDefinition

**Summary:** Data-driven badge rule (trigger + JSON condition).

| View | Fields |
|------|--------|
| **Listing** | `GET /api/admin/achievements` → `achievements[]` (+ `earnedCount` per def) |
| **Detail** | `id`, `gameId`, `name`, `description`, `icon`, `trigger`, `condition`, `tier`, `groupId`, `hidden`, `sortOrder` |

**Triggers:** `answer_submitted`, `daily_quiz_completed`, `rush_hour_completed`, `login_streak`, `friend_added`, `manual`.

**Create:** `POST /api/admin/achievements` — `409` if id exists.

---

### AchievementGroup

**Summary:** Mastery cluster — award meta-badge when all member badges earned.

| View | Fields |
|------|--------|
| **Listing** | `GET /api/admin/achievement-groups` → `groups[]` |
| **Detail** | `id`, `gameId`, `name`, `description`, `masteryBadgeId`, `members[]` (id, name, tier) |

**Create:** `POST /api/admin/achievement-groups`

---

### EarnedBadge

**Summary:** A badge row awarded to a user (runtime `badges` table).

| View | Fields |
|------|--------|
| **Listing** | Player `GET /api/me/achievements` → `earned[]` |
| **Detail** | `badge_id`, user, earned timestamp (server shape) |

**Manual award:** `POST /api/admin/achievements/:id/award` `{ "userId" }`

---

### ActiveChallenge

**Summary:** Today's assigned daily order for one user (progress bar).

| View | Fields |
|------|--------|
| **Listing** | `GET /api/admin/challenges?userId&date` → `challenges[]` |
| **Detail** | `id`, `name`, `achievementId`, `progress`, `target`, `assignedDate`, `completed`, `assignedBy` |

**Assign (write):** `POST /api/admin/challenges/assign` — up to 3 `achievementIds` per user per date.

**WHY stored progress:** Agent sets target at assign; evaluator increments; GET is plain SELECT.

---

### UserAchievementStats

**Summary:** Lifetime counters per user × game for condition evaluation.

| View | Fields |
|------|--------|
| **Detail** | `lifetime_correct`, `lifetime_sessions`, `lifetime_hard_correct`, `lifetime_speed_correct` |

**Not a direct admin list endpoint** — merged into achievement evaluation context and surfaced via triggers.

---

## Meta layer

### AgentDoc (Changelog)

**Summary:** Shipped product history as markdown (allowlisted file read).

| View | Fields |
|------|--------|
| **Listing** | N/A — single slug today |
| **Detail** | `slug`, `path`, `content`, `updatedAt` |

**Endpoint:** `GET /api/admin/changelog`

**WHY:** Happenings = *activity*; changelog = *product changes* for accurate announcements.

---

## Object relationships

```
User ──has──► UserKnowledgeProfile ──contains──► Sm2Row[]
User ──earns──► EarnedBadge ──definedBy──► AchievementDefinition
User ──assigned──► ActiveChallenge ──tracks──► AchievementDefinition
AchievementDefinition ──memberOf──► AchievementGroup
PublishedDaily ──references──► Question[] (by id)
PlatformHappenings ──mentions──► User (via timeline userId / displayName)
CommunityOverview ──aggregates──► WeakCategory ──informs──► PublishedDaily / Question
```

---

## How Ruby should use each layer

| Question type | Read from | Write via |
|---------------|-----------|-----------|
| Is the game up? | `RUBY_PLATFORM` health slice or `CHECK_TRIVIA_VISITS` | — |
| How are players doing? | `RUBY_PLATFORM` happenings slice | — |
| Where do players struggle? | `RUBY_PLATFORM` community slices | — |
| Drill into one player | `get_user_knowledge` | `publish_daily` (user scope), `assign_challenges` |
| Change content | `list_questions` | `create_question`, `hide_question` |
| Change today's quiz | `list_dailies` | `publish_daily`, `revoke_daily` |
| Badges / orders | `list_achievements`, `list_challenges` | `create_achievement`, `assign_challenges`, `award_achievement` |
| What shipped? | `get_changelog` | — |

**Public chat rule:** listing/detail views for players use summaries only — never expose URLs, hosts, or model names.

---

## Related docs

- [DESIGN.md](./DESIGN.md) — plugin cache + provider architecture
- [ruby-trivia/docs/ADMIN-API.md](https://github.com/elizaOS/ruby-trivia/blob/main/docs/ADMIN-API.md) — full HTTP reference
- [ruby-trivia/docs/RUBY-AGENT.md](https://github.com/elizaOS/ruby-trivia/blob/main/docs/RUBY-AGENT.md) — operator workflows
