# odin-scp (Claude Code plugin)

A Claude Code plugin that installs the Sentinel Coordination Protocol skill
and auto-wires the `@bradheitmann/odin-sentinel` MCP server.

## Install

Before running these commands, make sure `claude` works in your terminal. If the
command is missing, install or open Claude Code first. If Claude asks you to
sign in, use its normal sign-in flow. Do not paste API keys, OAuth tokens, or
passwords into plugin commands or chat.

```bash
# Add this repo as a marketplace
claude plugin marketplace add bradheitmann/odin-sentinel

# Install the plugin
claude plugin install odin-scp@odin-sentinel
```

Restart Claude Code. The plugin will:

- Install the `odin-scp` skill (so `/odin-scp` is available as a slash command).
- Register the `odin-sentinel` MCP server, spawned via `pnpm dlx --package @bradheitmann/odin-sentinel@0.5.0 odin-sentinel-mcp`.

If install fails, treat it as setup state, not user failure. Check whether
Claude Code is installed, signed in, and allowed to use plugins; otherwise use
the direct install paths below.

## What you get

- **Skill content**: the full SCP governance contract (boot receipts, role topology, delegation, CMUX delivery proof, heartbeat cadence, adversarial QA, finish audit) plus the referenced prompt, harness target, boot receipt, and team bootstrap runbook files.
- **MCP tools**: 31 `odin.*` tools including `compute_surface_layout`, `get_role_profile`, `get_role_card`, `get_onboarding_plan`, `validate_boot_receipt`, `compile_session_report`, `get_bootstrap_skill`, and `get_mission_frontrun_pack`.
- **MCP resources**: 18 protocol documents addressable via `odin://protocol/*` URIs.

## Use without Claude Code

If you're on another MCP-capable host (Cursor, Codex, Zed, Goose, Crush, OpenCode, OpenHands, Droid, Pi, VS Code), skip the plugin and point the host at a pinned package command.

Recommended:

```bash
pnpm dlx --package @bradheitmann/odin-sentinel@0.5.0 odin-sentinel-mcp
```

Supported npm global install:

```bash
npm i -g @bradheitmann/odin-sentinel@0.5.0
```

Supported npx zero-install:

```bash
npx -y -p @bradheitmann/odin-sentinel@0.5.0 odin-sentinel-mcp
```

Then point your host's MCP config at the `odin-sentinel-mcp` binary. The bundled SCP skill is exposed there too via the `odin.get_bootstrap_skill` tool and the `odin://protocol/bootstrap-skill` resource. The referenced runbooks are exposed under `odin://protocol/skill-references/*` so MCP-only users get the same governance contract and supporting files.

## License

MIT
