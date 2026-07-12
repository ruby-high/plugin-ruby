# @elizaos/plugin-ruby

> **Note:** This repo mirrors the `plugins/plugin-ruby` package from the private
> `eliza-ruby` monorepo (an `elizaOS`/`eliza` fork), where it is actually built and
> deployed as a workspace package (depends on `@elizaos/core` via `workspace:*`).
> This standalone copy exists for visibility/review; it is not wired up to build
> or run outside that monorepo without vendoring `@elizaos/core` and the shared
> tsup/tsconfig build helpers it references.

Ruby agent plugin for elizaOS — loads the **Ruby** character from your on-disk eliza config and operates the Ruby Trivia platform via the admin API.

**Why this plugin exists:** Ruby is a platform *operator*, not a generic chatbot. The trivia server exposes admin endpoints and a happenings feed; this plugin gives the agent scheduled awareness, typed API access, cached platform state, and Discord alerts so humans notice outages and celebrations without babysitting logs.

| Doc | Purpose |
|-----|---------|
| [docs/DESIGN.md](./docs/DESIGN.md) | Architecture and design decisions (WHYs) |
| [docs/API-OBJECTS.md](./docs/API-OBJECTS.md) | Domain nouns — summary, listing, detail per object |
| [CHANGELOG.md](./CHANGELOG.md) | Version history |
| [ROADMAP.md](./ROADMAP.md) | Planned work |
| [AGENTS.md](./AGENTS.md) | Agent-oriented package guide |
| `ruby-trivia/docs/RUBY-AGENT.md` | Operator playbook (external repo) |

## What it provides

| Surface | Role |
|---------|------|
| `getRubyCharacter()` | Reads `agents.list[]` from eliza config for the entry named **Ruby** |
| `applyRubyCharacter` | Merges config into runtime when personality fields are still empty |
| `RUBY_CONTEXT` | Operator playbook + voice (no live numbers — those live elsewhere) |
| `RUBY_API_LIMITS` | What the admin API can/cannot do — guardrails, forbidden paths, public-chat rules |
| `RUBY_OBJECTS` | API noun catalog, op routing, structured cached views |
| `RUBY_PLATFORM` | Live cache: freshness, counts, highlights, stale refresh hints |
| `RUBY_TRIVIA` | Router for all Ruby Trivia admin API operations (`op` param) |
| `CHECK_TRIVIA_VISITS` | Health check compat alias (`op=health`) |
| `RubyTriviaPulseService` | Polls happenings every 5 minutes, fills platform cache, Discord digests/alerts |

### Provider stack (read this first)

```
RUBY_CONTEXT     → who Ruby is + operator rules
RUBY_API_LIMITS  → what you can/cannot access + write guardrails
RUBY_OBJECTS     → what API nouns exist + which op to call + structured listings
RUBY_PLATFORM    → what's happening right now (freshness-guaranteed numbers)
RUBY_TRIVIA      → writes + on-demand fetches (list_users, publish_daily, …)
```

**Why four providers instead of one:** Playbook, boundaries, taxonomy, and live numbers serve different questions; merging them buries "you cannot do X" under counts and invites invented endpoints.

## Quick start

```json
{
  "features": { "ruby": true },
  "agents": {
    "list": [{
      "name": "Ruby",
      "plugins": ["@elizaos/plugin-ruby", "@elizaos/plugin-discord"]
    }]
  }
}
```

```bash
# Required for admin API + pulse
export RUBY_TRIVIA_API_URL=https://app.ruby-trivia.com
# Local dev: export RUBY_TRIVIA_API_URL=http://localhost:5175
export RUBY_ANALYTICS_SECRET=<same as ruby-trivia ANALYTICS_SECRET>

# Optional Discord digests / outage alerts
export RUBY_DISCORD_CHANNEL_ID=<channel snowflake>

cd /root/eliza-ruby && bun run start
```

**Why Discord is separate:** Announcements use `runtime.sendMessageToTarget`; the plugin does not embed Discord SDK — any connector that registers a `discord` handler works.

## Auto-enable

Loads automatically when any of these are true:

- An agent in config is named **Ruby**
- `config.features.ruby` is enabled
- `RUBY_PLUGIN_ENABLED=1`

**Why config name, not runtime:** Plugin resolution runs before the runtime character is fully hydrated; `agents.list[].name` is the stable signal.

## Config

| Variable | Default | Purpose |
|---|---|---|
| `RUBY_TRIVIA_API_URL` | `https://app.ruby-trivia.com` | Ruby Trivia API base URL (use `http://localhost:5175` for local dev) |
| `RUBY_ANALYTICS_SECRET` | falls back to `ANALYTICS_SECRET` | Admin API shared secret |
| `RUBY_PULSE_INTERVAL_MINUTES` | `5` | Happenings poll interval |
| `RUBY_PULSE_ENABLED` | `1` when secret present | Enable scheduled pulse |
| `RUBY_QUESTION_AUTHORING_ENABLED` | `1` when secret present | Periodic LLM question drafting |
| `RUBY_QUESTION_AUTHORING_INTERVAL_MINUTES` | `60` | Minutes between authoring cycles |
| `RUBY_QUESTIONS_PER_CYCLE` | `1` | New dynamic questions per cycle |
| `RUBY_QUESTION_AUTHORING_DEBUG` | `0` | Verbose logs (LLM raw preview) |
| `RUBY_DISCORD_CHANNEL_ID` | unset | Discord channel for digests/alerts |
| `RUBY_DISCORD_ACCOUNT_ID` | `default` | Discord connector account |
| `RUBY_DISCORD_ANNOUNCE_ENABLED` | `1` | Toggle Discord posts |
| `RUBY_PLUGIN_ENABLED` | unset | Force-enable with `1` |
| `ELIZA_CONFIG_PATH` | unset | Override eliza config file path |

Settings resolve `runtime.getSetting(key)` first, then `process.env[key]`. Any explicit non-false bool (`1`, `true`, `yes`, `on`) enables a flag.

## Platform cache

`RubyTriviaPulseService` maintains an in-memory `RubyPlatformCache` with TTL-bound slices:

| Slice | TTL | Refresh |
|-------|-----|---------|
| Health + Happenings | 5 min | Every pulse |
| Community + difficulty | 15 min | Every 3rd pulse |

Read ops (`health`, `poll_happenings`, `get_community*`) are **cache-first** when fresh. Write ops always hit the API.

**Why cache-first reads:** The pulse already paid for the API call; repeating it on every chat turn wastes latency and loads the trivia server. Stale slices tell the LLM which `RUBY_TRIVIA` op to use for refresh.

**Why community refreshes every 15m:** SM-2 aggregates change slowly; polling them every 5m adds two admin calls per pulse with little operator value.

## Domain object catalog

22 API nouns (User, PublishedDaily, WeakCategory, …) are registered in `domain-catalog.ts` with summary / listing / detail formatters in `domain-views.ts`. See [docs/API-OBJECTS.md](./docs/API-OBJECTS.md).

**Why code a catalog, not just markdown:** The LLM needs noun vocabulary and op routing injected every turn; a provider cannot rely on the agent reading repo docs at runtime.

## `RUBY_TRIVIA` operations

| `op` | Purpose |
|---|---|
| `health` | `GET /api/health` |
| `poll_happenings` | Platform pulse feed |
| `get_community` | Community struggle signals |
| `get_community_difficulty` | SM-2 difficulty breakdown |
| `list_users` / `get_user_knowledge` | Player profiles |
| `list_questions` / `create_question` / `hide_question` | Question bank |
| `list_dailies` / `publish_daily` / `revoke_daily` | Published dailies |
| `list_achievements` / `create_achievement` / `award_achievement` | Achievements |
| `list_achievement_groups` / `create_achievement_group` | Mastery groups |
| `list_challenges` / `assign_challenges` | Daily orders |
| `get_changelog` | Shipped features |

**Why one router action:** Twenty endpoints as separate LLM tools would crowd the action planner; `op` keeps the surface small while `admin-ops.ts` stays typed per handler.

## Public chat safety

All action results set `userFacingText` + `verifiedUserFacing: true`. Public replies never include API URLs, hosts, ports, or model names.

**Why:** Ruby posts to Discord; infra strings in player-facing channels leak deployment details and confuse non-operators.

## Pulse & Discord behavior

### Scheduled pulse

Every **5 minutes** (configurable):

1. `GET /api/health` — fast fail if backend is down
2. `GET /api/admin/happenings?since=<cursor>` — incremental feed
3. Every 3rd pulse: community + difficulty slices
4. Populate `RubyPlatformCache` slices
5. Persist `generatedAt` cursor
6. Post Discord digest if new cool events or live-queue spike

**Why 5 minutes:** Matches operator reaction time for signups and live queue without overloading the admin API.

### Scheduled question authoring

Every **60 minutes** by default (configurable):

1. Rotate through category × difficulty slots (14 categories × 3 tiers)
2. Every 3rd slot biases toward weak community categories from pulse cache
3. LLM drafts one question with plausible distractors
4. `POST /api/admin/questions` — dynamic `dyn-####` rows land in the bank immediately
5. 409 duplicate text → skip quietly and advance rotation

Watch logs for `[QuestionAuthoring]` — every cycle logs start, draft, and complete. Set `RUBY_QUESTION_AUTHORING_DEBUG=1` for LLM raw previews.

**Why separate from pulse:** Content authoring is slower and LLM-heavy; platform polling should stay fast and predictable.

**Why persisted cursor:** Agent restarts must not replay old events or skip the gap between last poll and restart.

### Cool events (one batched digest per poll)

- Badge earns, signups, referrals, rush hour, friend adds, crew moments
- Daily quiz completed with streak ≥ 5
- Live queue spike (0 → N waiting)

Routine noise (`answer_submitted`, `user_login`, …) is filtered out.

**Why batch:** Discord channels get unusable if every answer triggers a message.

### Outage alerts

- **First 30 minutes down:** alert every poll (~5 min)
- **After that:** every 15 minutes until recovery
- **Recovery:** short "backend is back" message

**Why loud then throttle:** Immediate visibility for on-call; sustained outage does not spam identical messages every 5 minutes forever.

Requires `@elizaos/plugin-discord` plus `RUBY_DISCORD_CHANNEL_ID` in the bot's allowed channels.

## Sacred default

Ruby must **not** change player-facing dailies unless explicitly calling `publish_daily` or `assign_challenges`.

**Why:** `pickDaily` auto-selection is the default player experience; accidental publishes are high-impact.

## Usage

```ts
import { getRubyCharacter, resolveRubyTriviaConfig } from "@elizaos/plugin-ruby";

const ruby = getRubyCharacter();
const config = resolveRubyTriviaConfig(runtime);
```

## Commands

```bash
bun run --cwd plugins/plugin-ruby build
bun run --cwd plugins/plugin-ruby test
bun run --cwd plugins/plugin-ruby typecheck
bun run --cwd plugins/plugin-ruby lint
```

## See also

- [docs/DESIGN.md](./docs/DESIGN.md) — full architecture
- [docs/API-OBJECTS.md](./docs/API-OBJECTS.md) — domain noun reference
- [ROADMAP.md](./ROADMAP.md) — what's next
- [CHANGELOG.md](./CHANGELOG.md) — what shipped
