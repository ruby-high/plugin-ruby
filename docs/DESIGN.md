# Design — @elizaos/plugin-ruby

Architecture and design decisions for the Ruby Trivia operator plugin. Read this when changing pulse behavior, admin routing, or Discord announcements.

**Operator playbook (external):** `ruby-trivia/docs/RUBY-AGENT.md`  
**API contract (external):** `ruby-trivia/docs/ADMIN-API.md`

---

## Problem

Ruby is an Eliza agent that **operates** a live trivia platform — not just chats about it. The agent must:

1. Know platform state (who's playing, what's struggling, what's worth celebrating).
2. Call admin endpoints safely (auth, errors, no routine answer floods).
3. Stay on voice and policy from eliza config without hardcoding copy in the plugin.
4. Alert humans when the backend dies.

Before 2.1, the plugin only loaded character + a health stub. Operators had no scheduled pulse, no admin router, and no Discord loop.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Eliza agent (name === "Ruby")                                   │
├─────────────────────────────────────────────────────────────────┤
│  RUBY_CONTEXT provider ──► operator playbook + voice             │
│  RUBY_PLATFORM provider ─► cached platform state + freshness     │
│  RUBY_BULLPOSTS provider ► $RUBY social/bullpost voice + themes  │
│  RUBY_OBJECTS provider ──► API noun catalog + cached views       │
│  RUBY_TRIVIA action ──────► admin-ops (cache-first reads)        │
│  SUGGEST_BULLPOST ───────► on-brand $RUBY social drafts          │
│  CHECK_TRIVIA_VISITS ─────► health (compat)                      │
├─────────────────────────────────────────────────────────────────┤
│  RubyTriviaPulseService ◄── tasks/pulse.ts (setInterval)         │
│       │                                                          │
│       ├── platform cache (happenings 5m, community 15m TTL)     │
│       ├── rubyHealthFetch → /api/health                          │
│       ├── rubyAdminFetch  → happenings + community slices        │
│       ├── pulse-state     → runtime.setSetting (cursor + dedup)  │
│       └── announcements   → runtime.sendMessageToTarget (Discord)│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    Ruby Trivia API (default https://app.ruby-trivia.com)
```

### Why cache + providers (not action-only)?

| Approach | Problem |
|----------|---------|
| **Action per question** | Planner must pick the right op every turn; extra latency; duplicate API hits |
| **Provider-only, no service** | No freshness guarantee; stale data mixed with live chat |
| **Service cache + providers** | Pulse maintains TTL-bound slices; LLM reads `RUBY_PLATFORM` every turn; actions for writes or stale refresh |

Read ops (`health`, `poll_happenings`, `get_community*`) check cache first when fresh. Write ops always hit the API.

### Why four providers (context / limits / objects / platform)?

| Provider | Injects | Why separate |
|----------|---------|--------------|
| **RUBY_CONTEXT** | Voice + operator rules | Persona is stable; mixing it with live numbers bloats every turn |
| **RUBY_API_LIMITS** | Can/cannot access, write guardrails, public-chat rules | Stops invented endpoints and auto-publish; OBJECTS alone does not state forbidden paths |
| **RUBY_OBJECTS** | 22-noun catalog, op routing, structured listings | LLM needs taxonomy at runtime; repo markdown is not in context |
| **RUBY_PLATFORM** | Freshness, counts, highlights, stale refresh ops | Operational dashboard — "what's happening now" |

Provider order: context → limits → objects → platform.

**Why that order:** Routing guidance and noun vocabulary should appear before raw counts so the model knows *which op* to use when a slice is stale.

**Dedup rule:** PLATFORM owns counts and one-line summaries; OBJECTS owns structured listing/detail shapes (timeline bullets, live rooms, weak-category easiness, difficulty tiers with attempt counts). Neither provider repeats the other's primary job.

---

## Domain object catalog

Implementation mirrors [docs/API-OBJECTS.md](./API-OBJECTS.md):

| Module | Role |
|--------|------|
| `types/domain.ts` | Typed models per API noun |
| `domain-catalog.ts` | `DOMAIN_OBJECTS` registry (22 entries), routing guide, `suggestOpForKinds` |
| `domain-views.ts` | `formatObjectSummary` / `formatObjectListing` / `formatObjectDetail` / `formatCachedObjectViews` |
| `admin-ops.ts` | Uses formatters for consistent public-safe `userFacingText` |

### Summary / listing / detail

| View | When used | Example |
|------|-----------|---------|
| **Summary** | One-line status | "Community struggle: science (easiness 1.7)" |
| **Listing** | Collection index (max 5 preview) | `• Alice (u1) · level 3` |
| **Detail** | Single record, richer fields | SM-2 row with seen/correct counts |

**Why three views:** Operator questions range from "how's the platform?" (summary) to "show me weak categories with easiness" (listing) to "what's in this publish result?" (detail). One formatter shape cannot serve all without either losing detail or flooding Discord.

### Stale slice → op mapping

`getStaleRefreshOps()` in `platform-cache.ts` maps expired cache slices to `RUBY_TRIVIA` ops via `suggestOpForKinds`.

**Why:** A stale happenings slice is useless for "who's in the live queue?" — the LLM must call `poll_happenings` explicitly. Surfacing the op name in PLATFORM text removes guesswork.

---

## Platform cache TTLs

| Slice | TTL | Refresh trigger |
|-------|-----|-----------------|
| Health | 5 min | Every pulse |
| Happenings (+ timeline, live rooms) | 5 min | Every pulse |
| Community overview | 15 min | Every 3rd pulse (`COMMUNITY_REFRESH_EVERY_PULSES`) |
| Community difficulty | 15 min | Every 3rd pulse |

**Why happenings every pulse:** Signups, badge earns, and live queue change on minute-scale — operators care within one poll window.

**Why community every 15m:** SM-2 community aggregates are slow-moving; fetching them every 5m doubles admin load for marginal freshness gain.

---

| Layer | Responsibility | Why separate |
|-------|----------------|--------------|
| **Action** (`RUBY_TRIVIA`) | On-demand operator commands from chat | LLM invokes explicitly; user sees result in thread |
| **Service** (`RubyTriviaPulseService`) | Stateful pulse + snapshot | `RUBY_CONTEXT` reads last poll without re-fetching |
| **Task** (`startPulseTask`) | Wall-clock interval | Services don't own timers in elizaOS; plugin `init`/`dispose` manages lifecycle |

---

## Configuration

Settings resolve **runtime.getSetting first**, then **process.env** with the same key.

**Why:** Per-agent dashboard settings override global `.env` without redeploying. Bool parsing accepts `yes`/`on` because operators use mixed config UIs.

| Constant | Value | Why |
|----------|-------|-----|
| `DEFAULT_PULSE_INTERVAL_MINUTES` | 5 | Matches operator manual; 30m was too slow for live queue / signup moments |
| `COLD_START_SINCE_HOURS` | 1 | First boot without cursor still sees recent activity without replaying entire history |
| `ANNOUNCED_KEYS_MAX` | 500 | Bounded storage; FIFO trim keeps recent dedup keys |
| `OUTAGE_ALERT_EVERY_POLL_UNTIL` | 6 | Six polls × 5 min = 30 min loud window |
| `OUTAGE_ALERT_THROTTLE_EVERY` | 3 | Every third poll after that = 15 min between alerts |
| `HEALTH_FETCH_TIMEOUT_MS` | 8s | Health should be fast; fail quick for outage detection |
| `ADMIN_FETCH_TIMEOUT_MS` | 15s | Happenings payloads can be larger |

Pulse defaults **on** when `RUBY_ANALYTICS_SECRET` or `ANALYTICS_SECRET` is set.

**Why:** Secret presence implies an operator deployment; disabling pulse should be explicit (`RUBY_PULSE_ENABLED=0`).

---

## Pulse cursor & dedup

### Cursor (`RUBY_PULSE_LAST_GENERATED_AT`)

Each successful poll stores `payload.generatedAt` from the happenings response. Next poll uses `?since=<cursor>`.

**Why:** Server-side `since` is authoritative; client clocks drift. Storing server `generatedAt` avoids gaps and duplicates.

### Announced keys (`RUBY_PULSE_ANNOUNCED_KEYS`)

JSON array of dedup keys: `at:event:userId`.

**Why:** Restarting the agent must not re-post "Alice earned badge X" to Discord. Cursor + announced keys are written to `$ELIZA_STATE_DIR/plugin-ruby/pulse-state.json` because `runtime.setSetting` is in-memory only.

### In-memory authority

State loads once in `RubyTriviaPulseService.start()`. `runPulse` does not reload settings each tick.

**Why:** Reloading every poll hid `setSetting` failures and added DB reads. Memory is source of truth between polls; disk updates on cursor save and announce mark.

---

## Cool events vs routine noise

`announcements.ts` classifies timeline items:

| Class | Examples | Discord? |
|-------|----------|----------|
| **Cool** | `badge_earned`, `user_registered`, non-routine crew, streak ≥ 5; multi-account fingerprint users filtered | Yes (batched) |
| **Routine** | `answer_submitted`, `user_login`, `login_failed` | No |
| **Live queue spike** | `queueWaiting` 0 → N | Yes (appended to digest) |

**Why:** Answer events dominate volume and drown signal. One digest per poll caps spam while keeping celebrations visible.

Outage messages use rotating loud templates.

**Why:** Repeated identical text gets ignored in busy Discord channels; escalation copy stays noticeable.

`sendDiscordAnnouncement` never throws.

**Why:** A Discord connector failure must not crash the pulse loop; the trivia backend might be healthy while chat is misconfigured.

---

## Admin client

### Typed `RubyFetchResult`

Every fetch returns `{ ok, data }` or `{ ok: false, kind, message }` — never throws to callers.

**Why:** Actions must return user-facing text; pulse must branch to outage handling. Exceptions would skip recovery paths.

### Health before happenings

Pulse checks `/api/health` before admin happenings.

**Why:** Distinguishes "server up, bad secret" from "server down". Health is unauthenticated; faster timeout.

### No `includeAnswers` on routine polls

`poll_happenings` uses default happenings without answer payloads.

**Why:** Operator manual forbids routine answer floods; friction debugging is a deliberate opt-in.

---

## Character loading

`applyRubyCharacter` fills **empty** fields only.

**Why:** Teams customize Ruby in `ruby.json`; the plugin must not clobber dashboard edits on every init. Auto-enable reads **config agent name**, not runtime alone, because plugin resolution runs before the runtime character is fully hydrated.

---

## Plugin lifecycle

```ts
services: [RubyTriviaPulseService]  // core registers once
init:
  applyRubyCharacter(runtime)
  if (!isRubyAgent) return
  stopPulseTask = startPulseTask(runtime)
dispose:
  stopPulseTask?.()
```

**Why no `registerService` in init:** Duplicate registration created two pulse service instances. **Why gate pulse on `isRubyAgent`:** Other agents in a multi-agent workspace may load the plugin via auto-enable but must not poll trivia APIs.

---

## Testing strategy

| Area | What we assert | Why |
|------|----------------|-----|
| `config` | Setting > env, bool parsing | Misconfig is the #1 production failure |
| `pulse-state` | Cold start, cap trim, dedup keys | Restart correctness |
| `announcements` | Cool filter, outage throttle, safe send | Discord policy |
| `admin-client` | HTTP mapping, timeouts | Operator error messages |
| `ruby-trivia-pulse` | Outage + success paths | Integration of above |

Live `ruby-trivia` smoke remains manual (see ROADMAP).

---

## Related files

| File | Role |
|------|------|
| `src/index.ts` | Plugin export, init/dispose |
| `src/config.ts` | Settings resolution |
| `src/admin-client.ts` | HTTP + summarizers |
| `src/admin-ops.ts` | `RUBY_TRIVIA` op handlers |
| `src/pulse-state.ts` | Cursor + dedup persistence |
| `src/announcements.ts` | Discord policy |
| `src/services/ruby-trivia-pulse.ts` | Pulse orchestration |
| `src/tasks/pulse.ts` | Interval scheduler |
| `src/providers/context.ts` | `RUBY_CONTEXT` |
| `src/providers/objects.ts` | `RUBY_OBJECTS` |
| `src/providers/platform.ts` | `RUBY_PLATFORM` |
| `src/platform-cache.ts` | Cache slices + freshness |
| `src/domain-catalog.ts` | API noun registry |
| `src/domain-views.ts` | Summary/listing/detail formatters |
| `src/types/domain.ts` | Domain type models |
| `auto-enable.ts` | Plugin gate |
