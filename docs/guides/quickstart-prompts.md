# ODIN Sentinel Quickstart Prompts

These prompts are starter material for a fresh machine and a fresh CMUX session.
Adjust harnesses and models to what you actually have installed.

## Prompt 1 - Setup

Paste into a capable coding agent on the target machine.

```text
Set up @bradheitmann/odin-sentinel for this machine.

Rules:
- Detect first; install only missing prerequisites.
- Required runtime: Node.js >=22.13.0.
- Install or use @bradheitmann/odin-sentinel@0.4.13.
- Configure only MCP hosts that already exist on this machine.
- Do not ask me to paste API keys, tokens, or OAuth values.
- Verify provider/auth status without printing secret values.
- If local inference is used, smoke-test actual visible content within timeout, not endpoint reachability alone.
- Install or prepare SCP native skill context where supported; otherwise prepare the full prompt fallback from odin.get_bootstrap_skill.
- Print configured hosts, skipped hosts, package version, and warnings.

Smoke test:
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}\n' | pnpm dlx --package @bradheitmann/odin-sentinel@0.4.13 odin-sentinel-mcp

Expected version: 0.4.13.
```

Restart any host whose MCP config changed.

## Prompt 2 - Governed Team Bootstrap

Open CMUX first. Paste into the agent that will act as EXEC PM.

```text
You are A/EXEC-PM. Bootstrap a Sentinel Coordination Protocol governed team in this CMUX workspace.

Procedure:
1. Call odin.get_version and confirm version 0.4.13 or newer.
2. Call odin.get_bootstrap_skill and read the public SCP contract.
3. Confirm CMUX is active and you are in the same workspace as the team slots.
4. Compute the target layout with odin.compute_surface_layout using profile=human_cmux_quad.
5. Use human-readable spatial/pod organization. Do not use tab-only layout as the canonical surface.
6. Check each planned role for MCP readiness, skill or prompt fallback readiness, auth/account readiness, and local inference readiness if used.
7. Do not launch occupants until readiness passes or you record a waiver/substitution.
8. Ask each launched role for a boot receipt.
9. Validate the team manifest before dispatching work.

Role policy:
- PM owns routing, activation, scope, acceptance criteria, waivers, and escalation.
- DEV implements only assigned write scope and cannot QA-accept its own work.
- QA starts fresh, verifies independently, and does not fix during QA.
- ODIN monitors actively by default and intervenes on health, scope, delivery, or drift.
- Agents without MCP/skill/full-protocol proof are NON_GOVERNED_ONE_SHOT_ONLY, not persistent governed roles.

After readiness passes, emit:
STAGED_AND_IDLE: <team-count> teams, manifest validated, awaiting first directive.
```

## Scaling

Add pods only after EXEC PM recomputes the CMUX layout and records readiness for
the new role slots. Keep EXEC PM in the same workspace as the governed team by
default.
