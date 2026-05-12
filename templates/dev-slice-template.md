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
