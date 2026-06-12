# ODIN Sentinel

**Portable MCP governance protocol for visible multi-agent teams: 28 tools, 18 resources, role topology, readiness gates, ODIN watchers, receipts, delegation, and closeout over stdio.**

ODIN Sentinel is a local stdio MCP server plus a portable coordination protocol
for visible agent teams. It gives agents a shared roster, startup packet,
delegation contract, receipt shape, layout rule, and closeout checklist. It does
not provide model inference, host a backend, or replace your development process.

Plain version: ODIN Sentinel helps you put coding agents into named visible
roles, check whether they are ready, and keep a human operator in control. If a
tool asks you to sign in, approve a permission prompt, or configure an account,
that is a normal setup blocker, not a personal failure. You can pause, choose a
different harness, keep a role slot empty, or ask for help.

For the fastest path, read [docs/guides/quick-start.md](docs/guides/quick-start.md).
For copy-paste prompts, read [docs/guides/quickstart-prompts.md](docs/guides/quickstart-prompts.md).
For a starter team shape, read [docs/guides/recommended-starter-team.md](docs/guides/recommended-starter-team.md).

## Contributor Setup
- Required: Node.js 22.13+ and pnpm 11.0.3, pinned by `packageManager`.
- Recommended: `corepack enable && pnpm install`.
- Corepack fetches pnpm 11.0.3 automatically; mismatched global pnpm versions may warn or fail.

## Terms In Plain Language

- MCP server: a local tool bridge that lets an agent ask ODIN Sentinel for
  protocol documents and validation checks.
- Harness: the app or CLI running an agent, such as Claude Code, Codex, Goose,
  Crush, OpenHands, Cursor, Zed, or another MCP-capable host.
- CMUX: the visible terminal workspace where the human can see named role slots.
- Governed team mode: the stricter mode where persistent agents must be visible,
  assigned to roles, and monitored.
- Native skill or prompt fallback: the instructions that teach an agent how to
  behave in this system.

## Minimum Governed-Team Checklist

Before launching persistent governed roles, confirm:

- Node.js satisfies `package.json` (`>=22.13.0`).
- `@bradheitmann/odin-sentinel@0.4.13` is installed or available through a pinned
  `pnpm dlx` or `npx` command.
- The ODIN MCP server is configured in each selected harness.
- The SCP native skill is installed where supported, or the full prompt/resource
  fallback is available.
- CMUX is installed and the team will run in one visible CMUX workspace.
- Harnesses and accounts are selected and authenticated.
- Local inference is smoke-tested if used: endpoint reachable, content returned
  within timeout, and not only `reasoning_content`.
- Role-compatibility smoke test passes for each persistent role.

Role slots may be prepared before readiness is complete, but occupants should
not be launched until readiness passes or the PM records a waiver/substitution.

## Install

Recommended zero-install path:

```bash
pnpm dlx --package @bradheitmann/odin-sentinel@0.4.13 odin-sentinel-mcp
```

Supported npm global install:

```bash
npm i -g @bradheitmann/odin-sentinel@0.4.13
```

Supported npx zero-install path:

```bash
npx -y -p @bradheitmann/odin-sentinel@0.4.13 odin-sentinel-mcp
```

A stdio smoke test that does not require an MCP host:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}\n' \
  | pnpm dlx --package @bradheitmann/odin-sentinel@0.4.13 odin-sentinel-mcp
```

A successful response includes `"serverInfo":{"name":"odin-sentinel","version":"0.4.13"}`.
Minimum compatible child MCP version for governed-team docs is `0.4.5`.

## MCP Host Examples

Claude Code:

```bash
claude mcp add odin-sentinel -- pnpm dlx --package @bradheitmann/odin-sentinel@0.4.13 odin-sentinel-mcp
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.odin-sentinel]
command = "pnpm"
args = ["dlx", "--package", "@bradheitmann/odin-sentinel@0.4.13", "odin-sentinel-mcp"]
```

Cursor / VS Code / Droid / Crush (`mcpServers` JSON):

```json
{
  "mcpServers": {
    "odin-sentinel": {
      "command": "pnpm",
      "args": ["dlx", "--package", "@bradheitmann/odin-sentinel@0.4.13", "odin-sentinel-mcp"]
    }
  }
}
```

Zed (`~/.config/zed/settings.json`):

```json
"odin-sentinel": {
  "source": "custom",
  "command": "pnpm",
  "args": ["dlx", "--package", "@bradheitmann/odin-sentinel@0.4.13", "odin-sentinel-mcp"]
}
```

Goose (`~/.config/goose/config.yaml`):

```yaml
odin-sentinel:
  type: stdio
  cmd: pnpm
  args: ["dlx", "--package", "@bradheitmann/odin-sentinel@0.4.13", "odin-sentinel-mcp"]
  enabled: true
```

OpenCode (`~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "odin-sentinel": {
      "type": "local",
      "command": ["pnpm", "dlx", "--package", "@bradheitmann/odin-sentinel@0.4.13", "odin-sentinel-mcp"],
      "enabled": true
    }
  }
}
```

OpenHands (`~/.openhands/config.toml`):

```toml
[mcp.stdio_servers.odin-sentinel]
name = "odin-sentinel"
command = "pnpm"
args = ["dlx", "--package", "@bradheitmann/odin-sentinel@0.4.13", "odin-sentinel-mcp"]
```

If a host cannot run `pnpm`, use the equivalent pinned npx command:

```bash
npx -y -p @bradheitmann/odin-sentinel@0.4.13 odin-sentinel-mcp
```

## MCP, Skill, Plugin, Prompt Fallback

- MCP server: supplies protocol resources and validation tools.
- Native skill: improves discoverability and automatic invocation in supported
  harnesses.
- Plugin: may package the MCP server and native skill together for a host.
- Full prompt injection: fallback only when MCP/native skill/plugin support is
  unavailable.

MCP alone is useful, but governed team mode is strongest when the persistent
roles also have native skill context or the full bootstrap prompt.

## CMUX Requirement

Governed team mode requires CMUX or a compatible visible terminal-pane surface.
The EXEC PM should remain in the same CMUX workspace as the rest of the team by
default. Tab-only layouts are degraded; the canonical layout is human-readable
spatial/pod organization.

Without CMUX, ODIN can still expose MCP resources, validation tools, and protocol
snapshots, but the visible team-management experience is not active governed
mode.

## Public Starter Templates

The `templates/` directory contains intentionally basic PM, DEV, QA, and team
manifest templates. They are starter material only. Add your own criteria before
using them for real work.

Local operator planning folders may be useful private workspaces, but they are
not shipped product internals and are not required for public users.

## Provided MCP Resources (18)

- `odin://protocol/main`
- `odin://protocol/roles`
- `odin://protocol/topology`
- `odin://protocol/model-profiles`
- `odin://protocol/closeout`
- `odin://protocol/delegation`
- `odin://protocol/receipts/boot`
- `odin://protocol/receipts/team-manifest`
- `odin://protocol/bootstrap-skill`
- `odin://protocol/skill-references/boot-receipt-examples`
- `odin://protocol/skill-references/canonical-introduction-prompt`
- `odin://protocol/skill-references/harness-skill-targets`
- `odin://protocol/skill-references/team-bootstrap-runbook`
- `odin://protocol/role-cards/exec-pm`
- `odin://protocol/role-cards/team-pm`
- `odin://protocol/role-cards/dev-worker`
- `odin://protocol/role-cards/qa-worker`
- `odin://protocol/role-cards/exec-asst`

## Provided MCP Tools (28)

- `odin.get_version`
- `odin.get_startup_packet`
- `odin.get_role_profile`
- `odin.get_role_card`
- `odin.get_bootstrap_skill`
- `odin.get_boot_receipt_schema`
- `odin.get_boot_receipt_examples`
- `odin.get_active_watch_packet`
- `odin.get_harness_probe_matrix`
- `odin.get_onboarding_plan`
- `odin.evaluate_readiness_gate`
- `odin.validate_boot_receipt`
- `odin.validate_team_manifest`
- `odin.get_delegation_packet`
- `odin.validate_delegation_packet`
- `odin.validate_cmux_delivery_proof`
- `odin.validate_instruction_read_proof`
- `odin.get_activation_gates`
- `odin.get_closeout_checklist`
- `odin.get_runtime_notice`
- `odin.export_protocol_snapshot`
- `odin.compute_surface_layout`
- `odin.compute_surface_layout_gate`
- `odin.compute_human_cmux_quad_layout`
- `odin.compile_session_report`
- `odin.preview_telemetry_redaction`
- `odin.submit_session_report`
- `odin.get_telemetry_config`

## Development

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run validate
```

## License

MIT. See [LICENSE](LICENSE).
