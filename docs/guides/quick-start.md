# Quick Start

ODIN Sentinel runs as a local MCP server over stdio. It returns protocol
resources, startup packets, validation results, delegation envelopes, closeout
checklists, and optional telemetry redaction helpers.

Plain version: install the package, connect it to an agent app, run one smoke
test, then check that each selected agent can sign in, use its model, and follow
the role instructions. If any step blocks, stop there and choose the safest next
step. You are still in control.

## Which Path Should I Choose?

- New to this: use the pinned `pnpm dlx` path, then run the smoke test.
- Avoid pnpm: use the pinned npm global install or pinned `npx` command.
- Using Claude Code plugin support: use the plugin README, then come back here
  for readiness checks.
- Local model users: run the normal smoke test and a separate local inference
  smoke test before launching agents.

## 1. Prerequisites

- Node.js `>=22.13.0`
- pnpm recommended; npm/npx supported when pinned to the release version
- at least one MCP-capable harness
- CMUX for governed team mode
- account/auth readiness for each selected harness
- local model endpoint readiness if you plan to use local inference

## 2. Install

Recommended zero-install path:

```bash
pnpm dlx --package @bradheitmann/odin-sentinel@0.4.9 odin-sentinel-mcp
```

Supported npm global install:

```bash
npm i -g @bradheitmann/odin-sentinel@0.4.9
```

Supported npx zero-install path:

```bash
npx -y -p @bradheitmann/odin-sentinel@0.4.9 odin-sentinel-mcp
```

## 3. Configure MCP

Point each selected harness at the `odin-sentinel-mcp` stdio command. Restart the
harness after editing config.

```json
{
  "mcpServers": {
    "odin-sentinel": {
      "command": "pnpm",
      "args": ["dlx", "--package", "@bradheitmann/odin-sentinel@0.4.9", "odin-sentinel-mcp"]
    }
  }
}
```

## 4. Install Skill Or Fallback Context

Use the best available context path for each harness:

1. Native skill, if the harness supports it.
2. Plugin/install path that bundles the skill and MCP server, if available.
3. Full prompt injection from `odin.get_bootstrap_skill`, if skill/plugin support
   is unavailable.
4. Protocol snapshot from `odin.export_protocol_snapshot` for non-MCP or bridge
   clients.

MCP supplies tools/resources. Native skill context improves automatic invocation.
Prompt injection is fallback only.

## 5. Smoke Test

Global install smoke test:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}\n' \
  | odin-sentinel-mcp
```

Zero-install smoke test:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}\n' \
  | pnpm dlx --package @bradheitmann/odin-sentinel@0.4.9 odin-sentinel-mcp
```

Expect `serverInfo.name = odin-sentinel` and `serverInfo.version = 0.4.9`.
Minimum compatible child MCP version: `0.4.5`.

## 6. Auth And Provider Readiness

Ask whether selected harnesses are already provisioned. Do not ask users to paste
API keys into prompts or docs. Verify provider status without printing secret
values. Common secret/provider paths include Doppler, 1Password CLI, environment
variables, direnv, mise, and dotenv-style files.

If those names are unfamiliar, use this safer question instead: "Is this agent
already signed in or configured outside this chat?" If the answer is no, pause
launch and either sign in through the tool's normal UI, ask someone to configure
the provider outside chat, choose another harness, or keep the role slot empty.

For local inference, endpoint reachability is not enough. The selected model must
return visible content within the timeout and must not return only
`reasoning_content`.

## Onboarding Plan (Guided Or Assisted Setup)

Use `odin.get_onboarding_plan` to turn harness discovery into a concrete, zero-secret setup
plan. It reuses the same readiness classification as `odin.get_harness_probe_matrix` (no
second taxonomy) and returns harness readiness rows, a blocker summary, the recommended
setup mode, guided steps, assisted-mode eligibility, the install-ledger path, and the next
user action.

Two setup modes:

- Guided manual setup is the safe default. You run each install, configure, and verify step
  yourself and review every change. It works without any computer-use capability and covers
  MCP config, native skill or full-prompt fallback context, hook deployment, and readiness
  probes.
- Assisted computer-use setup is offered only when `computerUseAvailable` is true. An
  available computer-use-capable harness (for example Codex Desktop, Claude Desktop, or
  Claude Code) can perform the guided steps on your behalf after you choose it.

The MCP server returns plans only. It never controls the GUI or desktop itself; actual
computer use is performed by an available computer-use-capable harness after you explicitly
choose assisted setup.

Readiness probes and no-secret behavior: the plan classifies auth, login, permission, MCP,
and skill blockers per harness and reports secret/provider readiness by status only. Do not
paste API keys, tokens, OAuth values, or provider secrets into chat — report only whether
each harness is already provisioned through an account, environment, secret manager, or
local config.

Hook deployment: install the activation hooks with
`node scripts/protocol/install-activation-hooks.mjs` so the full-instruction-read precheck
runs before governed edits. The onboarding plan lists this as a guided step.

The onboarding plan only reports where ODIN-owned artifacts will be tracked (the install
ledger path). It does not write the install ledger or any harness config file; ledger-aware
install behavior is a separate step.

## 7. CMUX Governed-Team Launch

Governed team mode requires CMUX. Keep EXEC PM in the same CMUX workspace as the
rest of the team by default. Use spatial/pod organization, not tab-only layouts,
for the canonical operator surface.

Slot provisioning may happen before readiness is complete. Do not launch role
occupants until readiness passes or EXEC PM records a waiver/substitution.

## 8. Deterministic Bootstrap Order

1. Confirm Node.js and package version.
2. Configure and smoke-test ODIN MCP.
3. Install native skill or prepare full prompt fallback.
4. Open CMUX and compute the target layout.
5. Select harnesses and check auth/account readiness.
6. Smoke-test local inference if used.
7. Run role-compatibility smoke tests.
8. Launch EXEC PM in the CMUX workspace.
9. Stage role slots and collect boot receipts.
10. Activate work only after the manifest validates.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| MCP unavailable | Restart the host, re-check config path, and run the stdio smoke test. |
| Skill missing | Install the native skill where supported or use `odin.get_bootstrap_skill` as full prompt fallback. |
| Auth/login required | Ask the user to provision the provider; verify status without printing secrets. |
| Permission prompt | Stop and route to PM/user; do not bypass silently. |
| Stale MCP version | Use a pinned `@bradheitmann/odin-sentinel@0.4.9` command, restart host, and confirm `0.4.9`. |
| Local inference stall | Require visible content within timeout; endpoint-only success is insufficient. |
| Role refusal | Mark the role `NON_GOVERNED_ONE_SHOT_ONLY` unless MCP/skill/full protocol proof is established. |

`NON_GOVERNED_ONE_SHOT_ONLY` means the agent may help with one bounded task, but
is not suitable for a persistent governed role.
