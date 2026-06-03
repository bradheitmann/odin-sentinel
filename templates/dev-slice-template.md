# DEV Slice Template

Use this as a public starter template. Replace every placeholder before launch.

## Goal

- Task: `<what to build or change>`
- Owner: `<DEV role slot or agent>`
- PM contact: `<PM role slot or human>`

## Scope

- Write-allowed files:
  - `<path>`
- Read-only context:
  - `<path or doc>`
- Out of scope:
  - `<explicit non-goals>`

## Requirements

- Functional acceptance criteria:
  - `<criterion 1>`
  - `<criterion 2>`
- User-defined criteria:
  - `<project-specific criterion>`

## Verification

- Required commands:
  - `<command>` -> expected `<result>`
- Manual checks:
  - `<check>`

## Instruction-Read Proof (before editing)

Before changing any file, read the full reading-list and context sources, then record a
full-instruction-read proof (each file with a byte or line count and a SHA-256 digest).
Generate it with `node scripts/protocol/verify-instruction-read.mjs --record <file...>` and
verify it with `node scripts/protocol/verify-instruction-read.mjs <proof.json>`. First-screen
or partial reads are insufficient.

## DEV Report

Return:

- files changed
- summary of implementation
- verification commands and results
- unmet criteria or blockers
- risks for QA/integration

## Boundaries

DEV implements only the assigned scope and does not QA-accept its own work.

## Minimal Filled Example

- Task: `Update one README paragraph to clarify install steps`
- Owner: `B/DEV-1`
- Write-allowed files: `README.md`
- Out of scope: `package code, release scripts, unrelated docs`
- Required command: `pnpm test` -> expected `passes`
- DEV report: `changed README.md; tests passed or blocker reported`
