# Roadmap — @elizaos/plugin-ruby

Prioritized follow-ups for the Ruby Trivia operator plugin. Each item states **what** and **why**.

## Shipped in 2.1.0 (operator-complete)

| Item | Why it mattered |
|------|-----------------|
| Full admin API router (`RUBY_TRIVIA`, 20 ops) | Operator manual workflows need typed, testable handlers |
| 5-minute pulse + Discord digests/outage alerts | Ambient platform awareness without per-turn API calls |
| Platform cache + `RUBY_PLATFORM` provider | Freshness-guaranteed reads; cache-first for hot paths |
| Domain object catalog + `RUBY_OBJECTS` provider | LLM noun vocabulary and op routing at runtime |
| `RUBY_API_LIMITS` provider | Forbidden paths, write guardrails, public-chat rules |
| Periodic question authoring | Rotates 14 categories × 3 difficulties; weak-category bias |
| Public-safe action formatting | Discord must not leak URLs, hosts, or model names |
| Persisted pulse cursor + announce dedup | Restart-safe; no duplicate celebration posts |

## Now (stability & operator confidence)

| Item | Why |
|------|-----|
| **Smoke harness against live `ruby-trivia`** | Unit tests mock fetch; one scripted run (health → happenings → list_users) before production deploys catches secret/URL misconfig. |
| **Discord channel allowlist docs** | Operators see `Channel not allowed` when the bot's allowed-channel config omits `RUBY_DISCORD_CHANNEL_ID`. Document alongside Discord plugin settings. |
| **Pulse failure metrics** | Expose `consecutiveFailures` and last error via structured log or small status surface so uptime monitors do not rely on Discord alone. |
| **Regenerate action spec** | Ensure `packages/prompts/specs/actions/plugins.generated.json` reflects `RUBY_TRIVIA` + `CHECK_TRIVIA_VISITS` after prompt changes. |

## Next (smarter operator loops)

| Item | Why |
|------|-----|
| **SM-2–driven remedial suggestions** | `get_community_difficulty` surfaces weak categories; next step is a provider hint ("consider remedial daily for science") without auto-publishing — sacred default stays manual. |
| **Admin API backoff** | On 429/503 bursts, pulse should exponential-backoff instead of counting every failure as an outage. **Why:** Transient deploy restarts should not trigger 30 minutes of "PLATFORM DEAD" messages. |
| **Multi-environment config** | `RUBY_TRIVIA_API_URL_STAGING` / profile switch for safe dry-runs. **Why:** Operators test publishes against staging without swapping `.env` by hand. |
| **On-demand cache for heavy lists** | Optional ephemeral cache for `list_users` / `list_questions` with short TTL. **Why:** Repeated player lookups in one session should not re-fetch 50 users every op. |

## Later (breadth & integrations)

| Item | Why |
|------|-----|
| **Non-Discord announcement targets** | Slack, Telegram, or generic `sendMessageToTarget` profiles. **Why:** Some communities do not use Discord; send path is already connector-agnostic. |
| **Webhook outbound events** | POST cool pulses to an operator dashboard. **Why:** Discord is human-facing; SRE tooling wants JSON. |
| **Achievement / daily templates** | Parameterized `publish_daily` helpers with guardrails (max questions, category allowlist). **Why:** Reduces foot-guns when the LLM publishes without reading question bank rules. |
| **Deprecate `CHECK_TRIVIA_VISITS`** | Single release cycle with migration note → `RUBY_TRIVIA op=health` only. **Why:** Two entry points for one endpoint confuse action planners. |
| **E2E in scenario-runner** | Scripted turn: read `RUBY_PLATFORM` → assert happenings summary in response. **Why:** Catches regressions in provider wiring across core upgrades. |
| **Split `formatObjectDetail` per noun tests** | Golden-file tests for each formatter output shape. **Why:** Public-safe formatting is a contract; prose drift breaks Discord policy. |

## Non-goals (explicit)

- **Replacing `ruby-trivia/docs/RUBY-AGENT.md`** — That doc is the operator playbook for the LLM; this plugin implements it, not duplicates it.
- **Auto-publishing dailies without explicit `publish_daily`** — Sacred default (`pickDaily`) must remain untouched.
- **Second scheduling mechanism** — Pulse + question authoring share the same interval-task pattern; authoring runs on a slower cadence than platform pulse.
- **In-plugin question authoring UI** — Dashboard lives in `ruby-trivia`; the plugin is API + pulse + providers only.
- **Caching `list_users` in the 5m pulse** — User lists are heavy and change slowly; on-demand fetch with optional short TTL is the right model.

## Version targets

| Milestone | Target | Scope |
|-----------|--------|-------|
| **2.1.0** | Operator-complete | Admin API + pulse + cache + four providers + domain catalog + question authoring (current) |
| **2.2.0** | Hardening | Backoff, metrics, staging URL, richer provider values, smoke harness |
| **2.3.0** | Integrations | Extra connectors, webhook, scenario-runner e2e |
