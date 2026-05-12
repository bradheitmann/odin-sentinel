# Recommended Starter Team

This is a small, visible starter shape for ODIN Sentinel. It is not a dependency
list and not a guarantee that every named harness is ready on your machine.

## Executive Office

| Role | Suggested Harness Type | Responsibility |
| --- | --- | --- |
| `A/EXEC-PM` | Strong coordination agent | Routing, activation, assignments, waivers, escalation. |
| `A/EXEC-ODIN` | Strong monitoring agent | Health, scope, drift, permission waits, closeout hygiene. |
| `A/EXEC-ASST` | Fast assistant | Ledger notes, reminders, artifact index, delivery checks. |
| `A/EXEC-RSCH` | Research/synthesis agent | Alternatives, context recovery, risk analysis. |
| `A/EXEC-QA` | Independent reviewer | Process review and drift detection. |

## Development Pod

| Role | Suggested Harness Type | Responsibility |
| --- | --- | --- |
| `<TEAM>/TEAM-PM` | Coding-capable coordinator | Pod assignments, follow-up, blocker routing. |
| `<TEAM>/ODIN` | Monitor | Polling, scope reminders, unsafe-lane freezes. |
| `<TEAM>/DEV-1` | Implementer | Bounded code/docs changes inside assigned write scope. |
| `<TEAM>/QA-1` | Independent reviewer | Fresh-context QA; no self-fixes during QA. |
| `<TEAM>/SHADOW-1` | Read-only reviewer | Optional second-pass critique and risk surfacing. |

## Readiness Before Launch

Each persistent role should have:

- MCP server proof or an accepted fallback path.
- Native skill context where supported, or full prompt fallback.
- Auth/account readiness checked without printing secrets.
- Local inference smoke-tested if used.
- CMUX locator recorded in the same workspace.
- Watcher assignment recorded in the team manifest.

Role slots may exist before readiness. Occupants should wait until readiness
passes or EXEC PM records a waiver/substitution.

## ODIN Roles Are Active Monitors

ODIN roles are not passive receipt emitters. Their default job is to watch for
stall, scope drift, missed delivery, permission waits, stale versions, and role
boundary breaches. Default active-watch cadence is 30 seconds. Treat 5 minutes
without meaningful progress as `WATCH_WARN` and 10 minutes without heartbeat or
observable progress as `STALLED`, unless the team manifest explicitly declares a
known long-running command. ODIN roles must re-arm the next watch tick instead
of returning to passive idle.

Human-facing translation: ODIN pauses are safety rails. They protect the
operator from silent failures, surprise costs, secret exposure, and agents going
off task. A warning or halt should explain the blocker in plain language and
offer the next safe choice; it should not blame the operator.
