# sentinel-coordination-protocol (Claude Code plugin)

A Claude Code plugin that installs the Sentinel Coordination Protocol skill
and auto-wires the `@bradheitmann/odin-sentinel` MCP server.

## Install

```bash
# Add this repo as a marketplace
claude plugin marketplace add bradheitmann/odin-sentinel

# Install the plugin
claude plugin install sentinel-coordination-protocol@odin-sentinel
```

Restart Claude Code. The plugin will:

- Install the `sentinel-coordination-protocol` skill (so `/sentinel-coordination-protocol` is available as a slash command).
- Register the `odin-sentinel` MCP server, spawned via `npx -y -p @bradheitmann/odin-sentinel odin-sentinel-mcp`.

## What you get

- **Skill content**: the full SCP governance contract (boot receipts, role topology, delegation, CMUX delivery proof, heartbeat cadence, adversarial QA, finish audit).
- **MCP tools**: 17 `odin.*` tools including `compute_surface_layout`, `get_role_profile`, `validate_boot_receipt`, `compile_session_report`, and `get_bootstrap_skill`.
- **MCP resources**: 9 protocol documents addressable via `odin://protocol/*` URIs.

## Use without Claude Code

If you're on another MCP-capable host (Cursor, Codex, Zed, Goose, Crush, OpenCode, OpenHands, Droid, Pi, VS Code), skip the plugin and install the npm package directly:

```bash
npm i -g @bradheitmann/odin-sentinel
```

Then point your host's MCP config at the `odin-sentinel-mcp` binary. The bundled SCP skill is exposed there too via the `odin.get_bootstrap_skill` tool and the `odin://protocol/bootstrap-skill` resource — same content, same governance contract.

## License

MIT
