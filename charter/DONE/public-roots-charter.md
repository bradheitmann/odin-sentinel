# Done list — public-roots-charter (written BEFORE dispatch; does not grow during it)
Base bytes: bdc6aab (fix/advisories-2026-10-31, on top of the accepted charter)
Problem: guarantee G3 (no private paths, markers or secrets on the public surface) covers charter/ only through a manual grep in the slice-zero DONE list, because scripts/audit/public-surface.mjs PUBLIC_ROOTS does not list charter/ (obligation O1, confirmed by QA). charter/ is committed to this public repository.
Design (fixed for this slice): add "charter/" to PUBLIC_ROOTS. Add a focused test that runs the audit's exported checker over a charter/ file containing a home path and expects a named finding, and over the real charter/ directory expecting none. If a current charter/ file trips the audit, fix that text (write scope below), never add an exemption.
Write scope: scripts/audit/public-surface.mjs (PUBLIC_ROOTS only), tests/audit/public-surface-roots.test.ts (new), charter/*.md and charter/DONE/*.md text only if the audit finds something. Nothing else. No other JavaScript is added or grown.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. charter-audited: `pnpm run audit:public` checks the charter/ files (the "N files checked" count rises by the number of charter/ files) and passes.
   - Reopen: from a clean clone of the frozen tip, `pnpm run audit:public`; compare the file count with bdc6aab's 81.
   - Fail-without mutant: append a macOS home path line to charter/STATE.md; the audit must fail naming charter/STATE.md. Restore.
2. roots-test: tests/audit/public-surface-roots.test.ts proves charter/ is in the audited set and that a planted home path under charter/ is reported.
   - Reopen: `pnpm vitest run tests/audit/public-surface-roots.test.ts`.
   - Fail-without mutant: remove "charter/" from PUBLIC_ROOTS; the test must go red.
3. no-regression: `pnpm run typecheck`, `pnpm vitest run tests/audit --testTimeout=30000`, `charter/slice-zero.sh` and `charter check` all green.
   - Reopen: the same commands from a clean clone.
   - Fail-without mutant: n/a (aggregate; proofs 1 and 2 carry the mutants).
Gates (exact commands):
- pnpm run audit:public
- pnpm run typecheck
- pnpm vitest run tests/audit --testTimeout=30000
- charter/slice-zero.sh
- charter check
Out of scope (recorded obligations, not fixed here):
- Porting scripts/audit/*.mjs to strict TypeScript (existing JavaScript; offered as a separate slice).
Owner decision points:
- none.
