# ODIN Sentinel

**Multi-harness terminal-pane team builder and orchestrator.**

ODIN Sentinel is a portable control layer for visible agent teams running across
terminal panes, local CLIs, editors, and MCP-capable harnesses. It does not try
to be another agent. It gives the agents a room, a roster, and a way to work
without dissolving into chatter.

The questions are practical. Who is here? What role do they hold? Who may
delegate? Who may verify? What changed, what passed, what failed, and how does
the session end without leaving a pane stack full of unfinished business?

ODIN starts with shape: an executive office, development pods, and ODIN
roles across the mesh. Then it provides the protocol pieces that keep the shape
honest: startup packets, role contracts, model and harness defaults, delegation
envelopes, receipts, manifests, and closeout checklists.

No hand-copied ritual. No private lore. Any MCP-capable harness can ask. Codex,
Claude, Droid, Crush, Goose, Zed, OpenCode, or a client written in Rust, Go,
Zig, or WebAssembly all fit the same boundary when they can launch or bridge
stdio MCP. These are examples, not bundled dependencies. One server. Many
harnesses. Same map, same names, same flame.

The repository is named `odin-sentinel` to avoid confusion with the Odin
programming language.

For a recommended first team, see
[docs/guides/recommended-starter-team.md](docs/guides/recommended-starter-team.md).

For copy-paste setup and team-bootstrap prompts you can hand to Claude Code or
Codex on a fresh machine, see
[docs/guides/quickstart-prompts.md](docs/guides/quickstart-prompts.md).

## Quick Start

### 1. Install

```bash
npm i -g @bradheitmann/odin-sentinel
```

Or use `npx` without installing — see the host-specific configs below.

### 2. Configure your MCP host

Pick the one you use. Restart the host after editing.

**Claude Code**

```bash
claude mcp add odin-sentinel -- npx -y -p @bradheitmann/odin-sentinel odin-sentinel-mcp
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.odin-sentinel]
command = "npx"
args = ["-y", "-p", "@bradheitmann/odin-sentinel", "odin-sentinel-mcp"]
```

**Cursor / Cursor CLI / VS Code / Factory (Droid) / Pi** (`mcpServers` JSON)

```json
{
  "mcpServers": {
    "odin-sentinel": {
      "command": "npx",
      "args": ["-y", "-p", "@bradheitmann/odin-sentinel", "odin-sentinel-mcp"]
    }
  }
}
```

**Zed** (`~/.config/zed/settings.json` → `context_servers`)

```json
"odin-sentinel": {
  "source": "custom",
  "command": "npx",
  "args": ["-y", "-p", "@bradheitmann/odin-sentinel", "odin-sentinel-mcp"]
}
```

**Goose** (`~/.config/goose/config.yaml` → `extensions`)

```yaml
odin-sentinel:
  type: stdio
  cmd: npx
  args: ["-y", "-p", "@bradheitmann/odin-sentinel", "odin-sentinel-mcp"]
  enabled: true
```

**Crush** (`~/.config/crush/crush.json` → `mcp`)

```json
{
  "mcp": {
    "odin-sentinel": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "-p", "@bradheitmann/odin-sentinel", "odin-sentinel-mcp"]
    }
  }
}
```

**OpenCode** (`~/.config/opencode/opencode.json` → `mcp`)

```json
{
  "mcp": {
    "odin-sentinel": {
      "type": "local",
      "command": ["npx", "-y", "-p", "@bradheitmann/odin-sentinel", "odin-sentinel-mcp"],
      "enabled": true
    }
  }
}
```

**OpenHands** (`~/.openhands/config.toml`)

```toml
[mcp.stdio_servers.odin-sentinel]
name = "odin-sentinel"
command = "npx"
args = ["-y", "-p", "@bradheitmann/odin-sentinel", "odin-sentinel-mcp"]
```

### 3. Use it

After restarting the host, give the agent an instruction like:

> Use the `odin-sentinel` MCP server. Call `odin.get_startup_packet`, then bootstrap an executive office and one development pod.

The agent will read the protocol resources (`odin://protocol/*`), follow the role contracts, and stay inside the SCP governance rules.

### 4. Verify (optional)

A one-line smoke test that works without any host:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}\n' \
  | npx -y -p @bradheitmann/odin-sentinel odin-sentinel-mcp
```

A successful response includes `"serverInfo":{"name":"odin-sentinel","version":"0.4.5"}`.

### Claude Code plugin (optional)

If you're on Claude Code, you can install the SCP skill + MCP server together as a plugin:

```bash
claude plugin marketplace add bradheitmann/odin-sentinel
claude plugin install sentinel-coordination-protocol@odin-sentinel
```

## Terms

- ODIN Sentinel: this MCP server and its portable team-coordination protocol.
- SCP: Sentinel Coordination Protocol, the ODIN startup, delegation, receipt,
  manifest, and closeout contract. It is not Secure Copy.
- CMUX: a compatible terminal-pane control surface. ODIN can support CMUX-style
  teams, but CMUX is not required by this repository.
- Harness: a local agent runtime, CLI, editor integration, or MCP client.

## How It Works

```text
                    MCP-capable clients
          ┌─────────────────────────────────────┐
          │ Codex │ Claude │ Droid │ Crush │ UI │
          └───┬──────┬────────┬───────┬─────┬───┘
              │      │        │       │     │
              └──────┴────────┴───────┴─────┘
                            │
                            ▼
                  ┌───────────────────┐
                  │  odin-sentinel    │
                  │  MCP server       │
                  └─────────┬─────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  ┌───────────┐       ┌───────────┐       ┌────────────┐
  │ Resources │       │   Tools   │       │  Exports   │
  │ protocol  │       │ validate  │       │ standalone │
  │ roles     │       │ startup   │       │ protocol   │
  │ topology  │       │ closeout  │       │ snapshots  │
  └───────────┘       └───────────┘       └────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
              ┌─────────────────────────┐
              │ Visible role topology   │
              │ EXEC PM, EXEC ODIN,     │
              │ TEAM PM, TEAM ODIN,     │
              │ DEV, QA, SHADOW         │
              └─────────────────────────┘
```

## Provided MCP Resources

- `odin://protocol/main` - core coordination protocol
- `odin://protocol/roles` - generic role contracts
- `odin://protocol/topology` - executive office, pod, and ODIN mesh defaults
- `odin://protocol/model-profiles` - recommended starter model/harness profiles
- `odin://protocol/closeout` - continuity parking and full shutdown checklists
- `odin://protocol/delegation` - visible-role delegation contract
- `odin://protocol/receipts/boot` - boot receipt template
- `odin://protocol/receipts/team-manifest` - team manifest template
- `odin://protocol/bootstrap-skill` - full Sentinel Coordination Protocol skill

## Provided MCP Tools

- `odin.get_version`
- `odin.get_startup_packet`
- `odin.get_role_profile`
- `odin.get_bootstrap_skill`
- `odin.validate_boot_receipt`
- `odin.validate_team_manifest`
- `odin.get_delegation_packet`
- `odin.validate_delegation_packet`
- `odin.get_closeout_checklist`
- `odin.get_runtime_notice`
- `odin.export_protocol_snapshot`
- `odin.compute_surface_layout`
- `odin.compute_surface_layout_gate`
- `odin.compile_session_report`
- `odin.preview_telemetry_redaction`
- `odin.submit_session_report`
- `odin.get_telemetry_config`

## Self-Contained Protocol

ODIN Sentinel must not depend on external local extensions. Concepts such as
delegation, handoff discovery, startup topology, model/harness profiles, receipt
validation, and closeout are implemented as MCP resources and tools inside this
server.

A client may have other local extensions installed, but those extensions are optional
and cannot be required for the ODIN Sentinel protocol to work.

## Client Compatibility

ODIN Sentinel is implemented in TypeScript and runs on Node.js, but MCP clients
can be written in Rust, Zig, Go, WebAssembly, Python, or any other environment
that can speak MCP over stdio.

The boundary is plain MCP JSON-RPC:

```text
native / WASM / CLI client
          │
          │ MCP over stdio
          ▼
node dist/src/bin/index.js
```

For clients that cannot spawn stdio subprocesses, use a host bridge or consume
the fallback files returned by `odin.export_protocol_snapshot`.

See [docs/reference/client-compatibility.md](docs/reference/client-compatibility.md).
For the current release-surface inventory, see
[docs/reference/public-surface-audit.md](docs/reference/public-surface-audit.md).

## Install

For a step-by-step setup, see [docs/guides/quick-start.md](docs/guides/quick-start.md).

For local source builds:

```bash
pnpm install
pnpm run build
```

Or install from npm:

```bash
npm i -g @bradheitmann/odin-sentinel
```

Then run the MCP server directly:

```bash
odin-sentinel-mcp
```

For zero-install use from any MCP host config:

```bash
npx -y -p @bradheitmann/odin-sentinel odin-sentinel-mcp
```

See [docs/reference/distribution.md](docs/reference/distribution.md).

## Run Over stdio

```bash
pnpm run dev
```

After building:

```bash
node dist/src/bin/index.js
```

When installed from a package, the executable names are:

```bash
odin-sentinel
odin-sentinel-mcp
```

## Example MCP Client Configuration

```json
{
  "mcpServers": {
    "odin-sentinel": {
      "command": "node",
      "args": ["/absolute/path/to/odin-sentinel/dist/src/bin/index.js"]
    }
  }
}
```

For local development, clients that support direct command execution can use:

```json
{
  "mcpServers": {
    "odin-sentinel": {
      "command": "pnpm",
      "args": ["exec", "tsx", "/absolute/path/to/odin-sentinel/src/bin/index.ts"]
    }
  }
}
```

## Harness Setup Notes

MCP-capable harnesses should point at the built stdio server:

```text
node /absolute/path/to/odin-sentinel/dist/src/bin/index.js
```

Common config shapes:

- Claude/Cursor-style: add `odin-sentinel` under `mcpServers`.
- Codex CLI: use `codex mcp add odin-sentinel -- node /path/to/dist/src/bin/index.js`.
- Droid CLI: use `droid mcp add odin-sentinel node /path/to/dist/src/bin/index.js --type stdio`.
- OpenCode-style: add a local `mcp.odin-sentinel` command entry.
- Goose-style: add an enabled `type: mcp` extension entry.
- Zed-style: add an enabled custom `context_servers.odin-sentinel` entry.

These are MCP client patterns, not a compatibility certification for every
release of every harness. For harnesses without discoverable MCP configuration,
use the self-contained protocol snapshot from `odin.export_protocol_snapshot`
or a thin prompt that directs the agent to an MCP-capable host bridge.

ODIN Sentinel does not provide hosted inference and should not cost the
maintainer money when users run it locally. See
[docs/reference/cost-and-privacy.md](docs/reference/cost-and-privacy.md).

## Startup Defaults

Fresh startup returns an executive office plus one development pod unless the
user or a handoff overrides it.

Executive office:

- `A/EXEC-PM`
- `A/EXEC-ODIN`
- `A/EXEC-ASST`
- `A/EXEC-RSCH`
- `A/EXEC-QA`

Development pod:

- `<TEAM>/TEAM-PM`
- `<TEAM>/ODIN`
- `<TEAM>/DEV-1`
- `<TEAM>/QA-1`
- `<TEAM>/SHADOW-1`

## Closeout Modes

- `PARK_FOR_CONTINUITY`: keep role slots open and park occupants.
- `FULL_SESSION_SHUTDOWN`: quit occupants, verify exit, and close panes except
  the final user-designated surface.

## Development

Source layout:

- `src/bin/` - stdio entry point
- `src/mcp/` - MCP resource and tool adapter
- `src/protocol/` - ODIN protocol loading, packet construction, and validation
- `protocol/` - portable protocol data
- `docs/guides/` - onboarding and starter team guidance
- `docs/reference/` - compatibility, distribution, cost, and privacy notes
- `scripts/audit/` - package and public-surface release checks

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run validate
```

## License

MIT. See [LICENSE](LICENSE).
