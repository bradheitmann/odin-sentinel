# Public Surface Audit

This document records the current public-release audit scope for ODIN Sentinel.

## Audit Commands

```bash
pnpm run audit:public
pnpm run test:package
pnpm run validate
```

The audits check public distribution files for local home paths, private project
markers, local evidence paths, stale public versions, missing package metadata,
telemetry wording drift, and package contents that should not ship.

## Public Distribution Files

The intended public package includes:

- `dist/`
- `docs/`
- `protocol/`
- `templates/`
- `scripts/audit/`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `LICENSE`
- `package.json`

Private planning workspaces and local evidence directories are optional local
operator spaces. They are not public product internals and must not be packaged.

## Named External Concepts

ODIN Sentinel intentionally names MCP, stdio, Node.js, TypeScript, pnpm, npm,
npx, CMUX, Codex, Claude Code, Droid, Crush, Goose, Zed, OpenCode, Cursor,
Rust, Go, Zig, and WebAssembly as examples, runtimes, package managers,
languages, or harnesses.

## Current Public Surface

- Public package/server version: `0.4.12`
- Minimum compatible child MCP version: `0.4.5`
- MCP resources: 13
- MCP tools: 27
- Optional telemetry tools: user-invoked, not automatic collection

## Release Drift Rule

Public repo/package/plugin/skill artifacts must be updated together when public
protocol semantics change. Private local skill copies may differ, but release
checks must not depend on private local paths.
