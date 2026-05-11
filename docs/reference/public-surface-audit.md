# Public Surface Audit

This document records the current public-release audit scope for ODIN Sentinel.

## Current Tree Result

Current tracked source, docs, protocol files, tests, and package metadata pass
the public-surface audit:

```bash
pnpm run audit:public
```

The audit checks for:

- local home-directory paths
- local agent configuration paths
- legacy extension terminology from adjacent agent systems
- secret-looking assignments

## Named External Concepts

ODIN Sentinel intentionally names these external concepts:

- MCP / Model Context Protocol
- stdio
- Node.js
- TypeScript / JavaScript
- pnpm / npm / npx
- Codex CLI
- Claude Code
- Droid
- Crush
- Goose
- Zed
- OpenCode
- Cursor
- Rust
- Go
- Zig
- WebAssembly / WASM
- Homebrew

These are examples, runtimes, package managers, languages, or harnesses. They
are not bundled dependencies unless listed in `package.json`.

## Named ODIN Concepts

- ODIN Sentinel
- ODIN
- SCP / Sentinel Coordination Protocol
- CMUX-compatible terminal-pane teams
- EXEC PM
- EXEC ODIN
- EXEC ASST
- EXEC RSCH
- EXEC QA
- TEAM PM
- TEAM ODIN
- DEV WORKER
- QA WORKER
- SHADOW REVIEWER

## Local Paths

ODIN Sentinel intentionally mentions these project-local paths:

- `docs/handoffs/`
- `.odin/handoffs/`
- `.odin/audit/`

These are caller-created paths for projects that use ODIN. They are not bundled
private state.

Docs also use placeholder install paths such as:

- `/absolute/path/to/odin-sentinel/dist/src/bin/index.js`
- `/path/to/odin-sentinel/dist/src/bin/index.js`

These are examples, not real local paths.

## Scripts Mentioned

Repo scripts in `package.json`:

- `pnpm run clean`
- `pnpm run build`
- `pnpm run dev`
- `pnpm run audit:public`
- `pnpm run test:package`
- `pnpm test`
- `pnpm run typecheck`
- `pnpm run validate`

Referenced local script files:

- `scripts/audit/public-surface.mjs`
- `scripts/audit/verify-pack.mjs`

No missing repo-local scripts are known.

External commands mentioned in docs:

- `node`
- `pnpm`
- `npm`
- `npx`
- `codex mcp add`
- `droid mcp add`

These are external user-installed tools, not files this repository must provide.

## Snapshot Tools

Current MCP snapshot tool:

- `odin.export_protocol_snapshot`

No external local extension is required for ODIN Sentinel to work.

## Git History Warning

The current tree is sanitized, but this private development repository has older
commits that contain removed terminology and experimental paths.

Do not make this private development history public as-is. For an open-source
release, publish from a fresh repository, a squashed root commit, or a sanitized
history rewrite after re-running:

```bash
pnpm run validate
pnpm run audit:public
```
