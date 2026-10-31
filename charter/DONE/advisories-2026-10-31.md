# Done list — advisories-2026-10-31 (written BEFORE dispatch; does not grow during it)
Base bytes: ea88de6 (chore/charter-adoption, slice-zero accepted)
Problem: CI `validate` fails on every branch, main included: `pnpm run audit:deps` reports two unaccepted high advisories published after the 0.8.0 release, GHSA-mrhx-c7xc-m3w5 (zod < 4.6.6, memory exhaustion on oversized constrained collections) and GHSA-27r3-jxmh-p828 (body-parser >= 2.0.0 < 2.4.0, denial of service via trailing bytes after a compressed body). zod is a direct dependency and is also used by @modelcontextprotocol/sdk; body-parser is transitive through express under the SDK's HTTP transport.
Design (fixed for this slice): fix, do not accept. Raise the direct zod dependency to ^4.6.6. Pin body-parser to ^2.4.0 in the pnpm-workspace.yaml overrides block, with a matching dated record in scripts/audit/audit-exceptions.json (same form as the existing hono/qs pins). Regenerate pnpm-lock.yaml with pnpm (never hand-edited).
Write scope: package.json (zod range only), pnpm-workspace.yaml (overrides block only), pnpm-lock.yaml (regenerated), scripts/audit/audit-exceptions.json (one new record). Nothing else.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. advisories-cleared: `pnpm run audit:deps` passes with 0 unaccepted advisories at or above high, and the installed tree resolves zod >= 4.6.6 and body-parser >= 2.4.0 (`pnpm why zod`, `pnpm why body-parser`).
   - Reopen: from a clean clone of the frozen tip, `pnpm install --frozen-lockfile && pnpm run audit:deps && pnpm why zod && pnpm why body-parser`.
   - Fail-without mutant: remove the body-parser override and reinstall; audit:deps must fail naming GHSA-27r3-jxmh-p828.
2. no-behaviour-change: the MCP server still works end to end with the new zod: `charter/slice-zero.sh` green with `delivered_valid=true refused_valid=false`; `pnpm run typecheck` clean; `pnpm vitest run tests/mcp tests/protocol --testTimeout=30000` green except the known intermittent tests/protocol/event-registry-contention.test.ts (O3), which is rerun alone up to 3 times.
   - Reopen: the same commands from a clean clone of the frozen tip.
   - Fail-without mutant: n/a for the aggregate gate; slice-zero's own mutant still applies.
3. exception-record-valid: the new record names advisory, owner, expires (within the 90-day horizon) and rationale, and its pin matches the overrides block; tests/audit/dependency-audit.test.ts passes.
   - Reopen: `pnpm vitest run tests/audit/dependency-audit.test.ts` from a clean clone.
   - Fail-without mutant: change the record's pin range to ^2.3.0; audit:deps must fail on pin drift.
4. ci-green: the GitHub Actions `validate` job passes on the frozen tip.
   - Reopen: `gh pr checks` on the PR carrying the tip.
   - Fail-without mutant: covered by proof 1 (the same audit runs in CI).
Gates (exact commands):
- pnpm install --frozen-lockfile
- pnpm run audit:deps
- pnpm run audit:public
- pnpm run typecheck
- pnpm vitest run tests/mcp tests/protocol tests/audit --testTimeout=30000
- charter/slice-zero.sh
- charter check
Out of scope (recorded obligations, not fixed here):
- Re-review every 2026-11-20 exception expiry before that date (all existing pins share it).
Owner decision points:
- none (patched versions exist; nothing is accepted as residual risk).
