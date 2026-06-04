# ODIN Sentinel Agent Instructions

These instructions are for public repo-local agents working with ODIN Sentinel.
They are intentionally lightweight starter guidance, not a replacement for a
user's own development process.

## Role Pattern

ODIN uses a simple PM/DEV/QA pattern for visible multi-agent work.

- EXEC PM owns launch and activation decisions, readiness waivers or
  substitutions, CMUX topology, staffing, final claim framing, and escalation to
  the human operator.
- TEAM PM owns local routing, worker activation, and status inside an assigned
  team after EXEC PM activation. TEAM PM does not create staff, waive readiness,
  mutate CMUX topology, or close lifecycle unless EXEC PM explicitly delegates
  that authority.
- DEV implements only the assigned write scope. DEV cannot QA-accept its own
  work and must report changed files plus verification commands and results.
- QA starts fresh, reviews adversarially, verifies DEV work independently,
  does not fix code during QA, and reports PASS or FAIL with evidence.
- ODIN monitors health, scope, readiness, delivery, and drift. ODIN may prod,
  halt, or escalate, but is not a DEV, not a QA acceptor, and not the PM launch
  authority.

## Operating Rules

- Stay inside the assigned files and task scope.
- Do not print secrets. Report secret status by provider/name only.
- Do not assume MCP alone is enough for governed team mode. Confirm MCP,
  native skill or prompt fallback, CMUX layout, auth readiness, and model smoke
  tests before launch.
- Governed readiness is fail-closed: MCP configured or a skill on disk is not authority.
  `GOVERNED_READY` requires verified protocol uptake (prove with
  `scripts/protocol/verify-governed-context.mjs`); otherwise the role is `FIXABLE_BLOCKED`,
  `NON_GOVERNED_ONE_SHOT_ONLY`, or `UNSUPPORTED`, and a governed occupant must not activate.
- Use CMUX for governed team mode. Without CMUX, ODIN can still provide protocol
  resources and validation tools, but the visible governed-team experience is not
  active.
- Treat local operator planning folders as optional private workspace, not
  required product internals.
- Use `templates/` as starter material. Replace placeholders with project-owned
  criteria before dispatching work.

## Operator Ergonomics

- Assume the operator may be new to terminals, agent harnesses, and API-key
  setup. Explain blockers in plain language before using protocol labels.
- Never frame setup gaps as user failure. Say what is blocked, what is safe, and
  what choice the operator has next.
- Treat prod, halt, freeze, warn, and stalled language as safety language. Pair
  it with the reason and the next human choice so the operator feels protected,
  not punished.
- Prefer short status lines: "KiloCode needs sign-in", "Crush is waiting for
  permission", "Goose is still producing hidden reasoning", or "OpenHands needs
  provider credentials".
- Do not ask the operator to paste secrets. Ask whether each harness is already
  provisioned through an account, environment, secret manager, or local config.

## Completion Report

Every agent handoff should include:

- role and assigned scope
- files changed
- commands run and results
- blocked or waived readiness checks
- risks or integration notes
