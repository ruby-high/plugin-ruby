# @elizaos/plugin-ruby

Ruby agent plugin for elizaOS — loads the Ruby character from eliza config and operates the Ruby Trivia platform via admin API.

## Purpose / role

Ruby is a **platform operator** agent. This plugin:

1. Loads personality from eliza config (`agents.list[].name === "Ruby"`) — not hardcoded copy.
2. Exposes full Ruby Trivia admin API tooling via `RUBY_TRIVIA`.
3. Polls platform happenings every 5 minutes, fills a TTL-bound platform cache, persists cursor + Discord dedup state.
4. Injects four providers so every turn has playbook, API boundaries, taxonomy, and live numbers without duplicate API calls.

**Why separate from ruby-trivia:** The trivia server is the product backend; this plugin is the Eliza integration layer (actions, service, providers, pulse).

**Operator playbook:** `ruby-trivia/docs/RUBY-AGENT.md`  
**Design doc (WHYs):** [docs/DESIGN.md](./docs/DESIGN.md)  
**Domain nouns:** [docs/API-OBJECTS.md](./docs/API-OBJECTS.md)

## Plugin surface

| Registration | ID | Role |
|---|---|---|
| Export | `getRubyCharacter` | Load Ruby `Character` from eliza config |
| Export | `applyRubyCharacter` | Merge config into runtime on init (empty fields only) |
| Export | `resolveRubyTriviaConfig` | Resolve API URL, secret, pulse, Discord settings |
| Provider | `RUBY_CONTEXT` | Operator playbook + voice (no live numbers) |
| Provider | `RUBY_API_LIMITS` | Admin API boundaries — can/cannot access, guardrails |
| Provider | `RUBY_OBJECTS` | API noun catalog, op routing, structured cached views |
| Provider | `RUBY_PLATFORM` | Live cache: freshness, counts, highlights, stale hints |
| Action | `RUBY_TRIVIA` | Router for admin API ops (`op` param); read ops cache-first |
| Action | `CHECK_TRIVIA_VISITS` | Health check compat alias |
| Service | `ruby_trivia_pulse` | Scheduled poll + cache population + Discord digests/alerts |

**Provider order:** `RUBY_CONTEXT` → `RUBY_API_LIMITS` → `RUBY_OBJECTS` → `RUBY_PLATFORM`.

**Why:** Playbook → boundaries → taxonomy → live numbers.

## Layout

```
plugins/plugin-ruby/
  auto-enable.ts              shouldEnable — agent name Ruby / features.ruby / env
  docs/
    DESIGN.md                 Architecture and design decisions (WHYs)
    API-OBJECTS.md            Domain noun catalog (summary / list / detail)
  CHANGELOG.md                Version history
  ROADMAP.md                  Planned work
  src/
    index.ts                  rubyPlugin export + pulse init/dispose
    load-ruby-character.ts    resolve eliza.json + map agents.list Ruby entry
    character.ts              getRubyCharacter + applyRubyCharacter
    config.ts                 resolveRubyTriviaConfig + timing constants
    admin-client.ts           authenticated fetch + public-safe summarizers
    admin-ops.ts              RUBY_TRIVIA op handlers (20 ops)
    api-limits.ts             formatApiLimitsGuide — can/cannot access boundaries
    domain-catalog.ts         DOMAIN_OBJECTS registry + routing guide
    domain-views.ts           summary / listing / detail formatters
    platform-cache.ts         TTL slices + freshness + stale refresh hints
    pulse-state.ts            persisted cursor + announced key dedup
    announcements.ts          cool-event filter + Discord send helpers
    types/
      admin.ts                HTTP response types (happenings, community, health)
      domain.ts               Domain noun types (User, PublishedDaily, …)
    actions/ruby-trivia.ts    RUBY_TRIVIA router action
    actions/check-trivia-visits.ts
    providers/context.ts      RUBY_CONTEXT playbook
    providers/limits.ts       RUBY_API_LIMITS boundaries
    providers/objects.ts      RUBY_OBJECTS catalog + structured views
    providers/platform.ts     RUBY_PLATFORM live cache
    services/ruby-trivia-pulse.ts
    tasks/pulse.ts
```

## Platform cache

| Slice | TTL | Populated by |
|-------|-----|--------------|
| Health + happenings | 5 min | Every pulse |
| Community + difficulty | 15 min | Every 3rd pulse |

Read ops check cache when fresh; writes always hit API. Stale slices surface refresh ops in `RUBY_PLATFORM`.

**Why cache-first:** Pulse already paid for the fetch; repeating on every chat turn wastes latency.

## Commands

```bash
bun run --cwd plugins/plugin-ruby build
bun run --cwd plugins/plugin-ruby test
bun run --cwd plugins/plugin-ruby typecheck
bun run --cwd plugins/plugin-ruby lint
```

## Config / env vars

| Var | Default | Purpose |
|---|---|---|
| `RUBY_TRIVIA_API_URL` | `https://app.ruby-trivia.com` | Ruby Trivia API base (local dev: `http://localhost:5175`) |
| `RUBY_ANALYTICS_SECRET` | falls back to `ANALYTICS_SECRET` | Admin API secret |
| `RUBY_PULSE_INTERVAL_MINUTES` | `5` | Pulse interval |
| `RUBY_PULSE_ENABLED` | `1` when secret set | Enable scheduled pulse |
| `RUBY_DISCORD_CHANNEL_ID` | unset | Discord announcements channel |
| `RUBY_DISCORD_ACCOUNT_ID` | `default` | Discord connector account |
| `RUBY_DISCORD_ANNOUNCE_ENABLED` | `1` | Toggle Discord posts |
| `RUBY_PLUGIN_ENABLED` | unset | Force enable with `1` |
| `ELIZA_CONFIG_PATH` | unset | Override config file path |

Resolution order: `runtime.getSetting(key)` → `process.env[key]`.

## Conventions / gotchas

- **Character content** comes from eliza config; `applyRubyCharacter` only fills **empty** fields.
- **Auto-enable** reads `config.agents.list[].name`, not runtime character alone.
- **Service registration:** `services: [RubyTriviaPulseService]` only — do not call `registerService` again in `init`.
- **Pulse task** starts only when `isRubyAgent(runtime)`; `runPulse` noops without secret.
- **Pulse state** loads at service `start()`; not reloaded every poll tick.
- **Discord sends** use `sendMessageToTarget` and never throw from the pulse loop.
- **Public chat:** never expose URLs, hosts, ports, or model names — use `userFacingText` + `verifiedUserFacing`.
- **Provider dedup:** PLATFORM = counts; OBJECTS = structured listings — do not merge back into one block.
- **Routine polls** must not use `includeAnswers=true` — floods the feed (see operator manual).
- **Sacred default:** no `publish_daily` unless explicitly invoked.
- See root `AGENTS.md` for logger, ESM, and architecture rules.

## Testing

```bash
bun run --cwd plugins/plugin-ruby test
```

36 cases: config, pulse state, admin client, ops, announcements, pulse service, domain catalog/views, platform cache, character fixture.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) — smoke harness, backoff on transient errors, staging URL, richer provider values, scenario-runner e2e.
