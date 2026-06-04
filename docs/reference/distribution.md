# Distribution

ODIN Sentinel public artifacts are the GitHub repository, npm package, optional
host plugin, public bootstrap skill/resource, public templates, and docs. When
public protocol semantics change, update them together.

## Current Public Versions

- npm package/server: `0.4.12`
- minimum compatible child MCP version: `0.4.5`

Private local skill copies may differ for personal workflow reasons. Release
checks must not rely on private local paths and must distinguish intentional
private-local divergence from repo-internal public artifact drift.

## Install Paths

Recommended zero-install path:

```bash
pnpm dlx --package @bradheitmann/odin-sentinel@0.4.12 odin-sentinel-mcp
```

Supported npm global install:

```bash
npm i -g @bradheitmann/odin-sentinel@0.4.12
```

Supported npx zero-install path:

```bash
npx -y -p @bradheitmann/odin-sentinel@0.4.12 odin-sentinel-mcp
```

Recommended MCP config:

```json
{
  "mcpServers": {
    "odin-sentinel": {
      "command": "pnpm",
      "args": ["dlx", "--package", "@bradheitmann/odin-sentinel@0.4.12", "odin-sentinel-mcp"]
    }
  }
}
```

Source build:

```bash
pnpm install
pnpm run build
node dist/src/bin/index.js
```

## Release Checklist

Before publishing or updating a plugin/skill listing:

1. Update GitHub source, docs, protocol resources, public templates, and package
   metadata together.
2. Confirm npm package metadata includes repository, homepage, bugs, license,
   engines, and files.
3. Confirm package contents exclude private planning workspaces and local evidence paths.
4. Confirm `protocol/SCP.md` and `protocol/bootstrap-skill.md` carry the same
   public version and minimum compatible child MCP version.
5. Confirm public docs do not contain stale MCP/server version references.
6. Confirm telemetry wording explains that session-report submission is optional
   and user-invoked.
7. Run offline release validation: `pnpm run validate`.
8. Run pack dry-run: `pnpm pack --dry-run`.
9. Tag the release only after GitHub, npm, plugin, public skill/bootstrap, docs,
   and version tags agree.

## Public Templates

The npm package intentionally ships `templates/` plus `AGENTS.md` and
`CLAUDE.md`. They are starter templates, not private planning artifacts.
