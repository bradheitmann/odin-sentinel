# ODIN Sentinel Quickstart Prompts

Two prompts that take a fresh machine from *"agents installed"* to *"team running under the Sentinel Coordination Protocol."* Paste each one into a capable coding agent (Claude Code or Codex) at the indicated moment. The agents do the rest.

The prompts are opinionated. They assume you want a working team in the smallest number of steps, not a customized one. Swap rosters or hosts at the end if you have different agents available.

---

## Prompt 1 — Setup

**When to use:** once per machine. Paste into Claude Code or Codex on the target machine. The agent will detect what's missing, install only what's needed (Homebrew, git, Node.js, pnpm, CMUX, and the `@bradheitmann/odin-sentinel` MCP server), and wire the server into every agent host you actually have installed.

```
Set up the @bradheitmann/odin-sentinel MCP server on this machine. Detect what's missing, install only what's needed, configure only the agent hosts that exist on this machine.

# Plan
Make a 5-task plan and execute in order:
  1. Prereqs (Homebrew, git, node, pnpm, cmux — install only if missing)
  2. Install MCP server with explicit @latest tag
  3. Smoke test the server
  4. Detect installed agent hosts and wire each one
  5. Print final report

# Rules
- Detect first, install only if missing: `command -v <tool>` for CLIs; `test -e <path>` for config dirs.
- After installing pnpm fresh, run `pnpm setup && source ~/.zshrc` once.
- Ignore pnpm warnings of the form "Failed to create bin … @pnpm/exe" — benign Homebrew vs pnpm self-install conflict.
- Always install with `pnpm add -g @bradheitmann/odin-sentinel@latest` — the bare name can return a stale version from registry cache.
- The MCP server has no `--version` flag. To verify, send a JSON-RPC initialize on stdin and parse the response.
- For every JSON / TOML / YAML config file: read, merge the odin-sentinel entry, write back. Never overwrite a whole file. Preserve comments in JSONC. Create the file if missing.
- Do not install agent CLIs the user doesn't have.
- Do not enable telemetry, deploy Cloudflare resources, or edit anything outside the host config files listed below plus one optional line in ~/.zshrc.

# Smoke test (use this exact form)
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}\n' | odin-sentinel-mcp

Expect `"serverInfo":{"name":"odin-sentinel","version":"<X.Y.Z>"}`. If absent, stop and report.

# Hosts to detect and configure
For each: detect → if installed, merge the entry into the listed config file (idempotent). Every entry uses `command = "odin-sentinel-mcp"` with no args.

  - Claude Code:   `command -v claude`        → `claude mcp add odin-sentinel -- odin-sentinel-mcp`
  - Codex:         `command -v codex`         → `~/.codex/config.toml` [mcp_servers.odin-sentinel] command = "odin-sentinel-mcp"
  - Cursor:        `command -v cursor-agent`  → `~/.cursor/mcp.json` mcpServers.odin-sentinel = { command: "odin-sentinel-mcp" }
  - Factory Droid: `command -v droid`         → `~/.factory/mcp.json` mcpServers.odin-sentinel = { type: "stdio", command: "odin-sentinel-mcp", disabled: false }
  - Kilo Code:     `command -v kilocode`      → `~/.kilocode/mcp.json` (same shape as Cursor)
  - Pi:            `command -v pi`            → `~/.pi/mcp.json` (same shape as Cursor)
  - OpenCode:      `command -v opencode`      → `~/.config/opencode/opencode.json` mcp.odin-sentinel = { type: "local", command: ["odin-sentinel-mcp"], enabled: true }
  - Crush:         `command -v crush`         → `~/.config/crush/crush.json` mcp.odin-sentinel = { type: "stdio", command: "odin-sentinel-mcp" }
  - Goose:         `command -v goose`         → `~/.config/goose/config.yaml` extensions.odin-sentinel = { type: stdio, cmd: odin-sentinel-mcp, enabled: true }
  - OpenHands:     `command -v openhands`     → `~/.openhands/config.toml` [mcp.stdio_servers.odin-sentinel] name = "odin-sentinel", command = "odin-sentinel-mcp"
  - Zed:           `test -e ~/.config/zed`    → `~/.config/zed/settings.json` context_servers.odin-sentinel = { source: "custom", command: "odin-sentinel-mcp", enabled: true }
  - VS Code:       `command -v code`          → `~/Library/Application Support/Code/User/mcp.json` servers.odin-sentinel = { type: "stdio", command: "odin-sentinel-mcp" }

# Final report
Print:
  - installed odin-sentinel version
  - which hosts were configured
  - which hosts were skipped (one line each, with reason "not installed")
  - any non-fatal warnings

Then print these three lines and stop:

  Setup complete.
  Restart any agent host you configured (their MCP config is cached at startup).
  To boot a team: open CMUX, launch your Executive PM agent in the first surface, paste your team-roster prompt.
```

After it finishes, **restart any agent host it touched** — each one caches MCP server configs at startup. Skipping the restart is the most common reason "the MCP server isn't showing up" after a clean install.

---

## Prompt 2 — Team Bootstrap

**When to use:** every time you spin up a new project. Open CMUX, launch Codex in the first surface, paste this. Codex acts as `A/EXEC-PM`, reads the Sentinel Coordination Protocol from the bundled skill, and stages a two-team layout (executive office + one development pod). The roster below is opinionated — substitute models or hosts you actually have.

```
You are A/EXEC-PM. Bootstrap a 2-team Sentinel Coordination Protocol session in this CMUX workspace.

# Procedure
1. Call odin.get_version. Confirm >= 0.4.4.
2. Call odin.get_bootstrap_skill. Read the full SCP contract. Follow it for the remainder of this session — particularly: you are the sole staffing authority, sole CMUX surface custodian, and you must complete the pre-staffing gate before every spawn.
3. Call odin.compute_surface_layout with teamCount=2. Confirm the canonical layout is [A] [B].
4. Call odin.compute_surface_layout_gate with fromTeamCount=1, toTeamCount=2. Execute the cmux operations it lists.
5. Stage the team per the roster below. For each surface: create it via cmux, confirm it exists and is empty, send the agent launch command, then send the occupant boot prompt requesting an SCP_BOOT_RECEIPT.

# Roster (substitute hosts/models if you have different agents available)

Team A — Executive Office (column 0, 5 surfaces stacked as tabs):
  | Slot          | Agent host    | Model           |
  |---------------|---------------|-----------------|
  | A/EXEC-PM     | Codex         | (you)           |
  | A/EXEC-ODIN   | Codex         | high-reasoning  |
  | A/EXEC-ASST   | Kilo Code     | Composer-2      |
  | A/EXEC-RSCH   | Cursor        | Kimi-K-2.5      |
  | A/EXEC-QA     | OpenCode      | Kimi-K-2.5      |

Team B — Development Pod (column 1, 5 surfaces stacked as tabs):
  | Slot          | Agent host    | Model           |
  |---------------|---------------|-----------------|
  | B/TEAM-PM     | Claude Code   | Opus-4.7        |
  | B/ODIN        | Codex         | high-reasoning  |
  | B/DEV-1       | Droid (Factory) | Kimi-K-2.6    |
  | B/QA-1        | Crush         | GLM-5.1         |
  | B/SHADOW-1    | Claude Code   | Haiku           |

# Constraints
- You are the only role permitted to invoke cmux surface operations (new-split, new-surface, move-surface, close-surface).
- No hidden subagents. Every agent must occupy a visible CMUX surface.
- TEAM PMs do not staff their own pods. All staffing is yours.
- A/EXEC-ODIN holds binding HALT authority over you. Honor HALT directives.
- Context window soft threshold 70% / hard 90% per agent. Force handoff or lockdown on hard breach.

# Closeout signal
After all 10 surfaces are spawned, all 10 boot receipts received, and odin.validate_team_manifest passes, emit a single line:

  STAGED_AND_IDLE: 2 teams, 10 occupants, layout=[A] [B]

Then wait for the user's first product directive. Do not begin work until dispatched.
```

When `STAGED_AND_IDLE` appears, the team is ready for your first directive.

---

## Scaling beyond 2 teams

To add a third development pod (Team C), tell `A/EXEC-PM`:

> Stage Team C as a new development pod identical in role shape to Team B. Call `odin.compute_surface_layout_gate fromTeamCount=2 toTeamCount=3` first and follow its checklist. The canonical layout becomes `[A] [B/C]` — Team A in the tall column, B and C stacked in the right column.

The same pattern scales out to 4, 5, 6, 7, 8 teams. The packing rule is in `odin://protocol/topology`.
