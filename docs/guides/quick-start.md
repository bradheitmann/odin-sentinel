# Quick Start

ODIN Sentinel runs as a local MCP server over stdio.

It does not provide model inference. It does not host a backend. Your MCP client
starts the process, calls ODIN tools, and reads ODIN protocol resources.

## From Source

```bash
pnpm install
pnpm run build
node dist/src/bin/index.js
```

## Client Configuration

Use the built server as a stdio command:

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

For local development:

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

## First Calls

Ask the client to call:

1. `odin.get_version`
2. `odin.get_runtime_notice`
3. `odin.get_startup_packet`

Then read:

1. `odin://protocol/main`
2. `odin://protocol/roles`
3. `odin://protocol/topology`
4. `odin://protocol/delegation`

That is enough for a client to understand the default team shape and how to
start cleanly.

For a suggested starter team, see
[recommended-starter-team.md](recommended-starter-team.md).

## Local State

ODIN may point agents at these project-local locations:

- `docs/handoffs/`
- `.odin/handoffs/`
- `.odin/audit/`

They are not bundled state. Create them in the project where your agents are
working if you want persistent handoffs or audit notes.
