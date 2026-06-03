# PM Role Template

Use this as a public starter template for an ODIN Sentinel PM role.

## Team Objective

- Outcome: `<desired result>`
- Deadline or session boundary: `<timebox>`
- Human operator: `<name or role>`

## Roles

- EXEC PM: owns launch/activation, readiness waivers or substitutions, CMUX
  topology, staffing, final claim framing, and escalation.
- TEAM PM: owns routing and worker activation inside an assigned team after EXEC
  PM launch. TEAM PM cannot staff new occupants, waive launch readiness, mutate
  CMUX topology, or close lifecycle unless EXEC PM explicitly delegates it.
- ODIN: monitors health, scope, delivery, and drift; intervenes or escalates.
- DEV: implements assigned write scope only.
- QA: verifies independently and reports PASS/FAIL.

## Readiness Gates

- Node.js version satisfies package metadata: `<status>`
- ODIN MCP server configured and smoke-tested: `<status>`
- Native skill or prompt fallback available: `<status>`
- CMUX workspace and role slots ready: `<status>`
- Harness auth/account readiness checked: `<status>`
- Local inference smoke-tested if used: `<status>`
- Role compatibility smoke test passed: `<status>`
- Launch/waiver authority holder: `A/EXEC-PM`

## Operator-Friendly Status

- Plain-language summary: `<what is happening in one sentence>`
- Current blocker, if any: `<sign-in | permission prompt | API/account setup | local model smoke test | none>`
- Safe next choice for the human operator: `<approve | sign in | choose fallback harness | keep slot vacant | ask for help>`
- Secret-handling reminder: `Do not paste API keys or tokens into chat.`

## Dispatch Delivery Proof

When dispatching to a CMUX role, delivery is not complete until you:

1. Send the text to the target surface.
2. Submit with Enter (input-bar text is not delivery).
3. Read the target surface.
4. Confirm the agent processed or acknowledged the message.

Record `target_surface_locator`, `submitted`, `verification_method`,
`observed_processing_state`, `timestamp`, and `sender_role`, then validate with
`odin.validate_cmux_delivery_proof`.

## Assignments

- `<role slot>` -> `<agent/harness>` -> `<scope>`

## Blockers And Escalation

- Blocker: `<description>`
- Owner: `<role>`
- Escalate to human when: `<condition>`

## User-Defined Criteria

- `<project-specific criterion>`

## Minimal Filled Example

- Outcome: `Clarify install documentation for first-time users`
- Human operator: `project maintainer`
- Readiness summary: `MCP smoke test passes; Claude Code sign-in still needed`
- Safe next choice: `sign in to Claude Code, choose another harness, or keep that slot vacant`
- Assignment: `B/DEV-1 -> Codex -> README.md only`
- User-defined criterion: `Do not ask the operator to paste API keys`
