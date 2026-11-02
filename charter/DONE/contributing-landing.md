# Done list — contributing-landing (written BEFORE dispatch; does not grow during it)
Base bytes: 3ab5149 (main)
Problem: the steps for landing a slice in this repository are not written where a new contributor or PM would look. They exist only in STATE prose and in one PM's private notes (polyswarm round R3 finding, 2026-11-01). Each step was learned the hard way:
- an acceptance recorded before PR CI ran had to be voided (slot-lease);
- a test that rebuilt dist/ in parallel with another test broke CI;
- a new packaged doc failed the package check until it was added to the allow-list;
- a DONE list that quoted a forbidden string was refused by the public audit.
AGENTS.md and docs/ ship in the npm package; a root CONTRIBUTING.md does not. So the contributor procedure belongs in CONTRIBUTING.md, with a one-line pointer from AGENTS.md.
Design (fixed for this slice):
- New CONTRIBUTING.md at the repository root, written for a contributor who has never seen this repository, with no private names, home paths or harness-specific detail. It contains:
  - "Landing a slice", in order: write the DONE list and pin it (`charter gate <slice> --dispatch`); implement in its own worktree and branch; independent QA from a different model family writes a JSON receipt; open the PR and wait for CI to be green on the exact commit; then freeze, reopen, validate the receipt, `charter gate <slice> --accept --receipt`, and add measured cost rows and the STATE rewrite in that commit; merge pinned to the verified head commit; push an archive tag; remove the worktree without force.
  - Test hygiene: tests never run `pnpm run build` or touch dist/; child processes run the TypeScript source via `--import tsx`; each verification run uses its own build output directory.
  - Public surface: every tracked file in the audited roots is checked by `pnpm run audit:public`; never write home paths, private project names or secret-looking literals, including inside DONE lists and STATE.
  - Packaged docs: a new file under docs/ needs one line in `requiredPackageFiles` (scripts/audit/verify-pack.mjs) and its mirror in tests/protocol/release-sync.test.ts.
  - Charter checks: run `charter check --strict` by hand before every commit and merge, because charter's git hooks are not installed here (STATE explains why).
- Add CONTRIBUTING.md to PUBLIC_ROOTS in scripts/audit/public-surface.mjs. Update every test that pins the root list.
- Add one line to AGENTS.md (Engineering Standard section) pointing contributors to CONTRIBUTING.md.
Write scope: CONTRIBUTING.md (new), AGENTS.md (one line), scripts/audit/public-surface.mjs (PUBLIC_ROOTS only), tests/audit/public-surface-roots.test.ts (only as needed for the new root). Nothing else; PM-ODIN writes STATE at acceptance.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. procedure-complete: CONTRIBUTING.md contains each step listed in the design, in that order. A reviewer who has not seen this repository can follow it.
   - Reopen: read the file against the design list. QA checks each item and names any step that is missing or out of order.
   - Fail-without mutant: n/a (content review). A missing step is a FAIL.
2. audited: CONTRIBUTING.md is in the public-surface audit. Planting a home path in it makes `pnpm run audit:public` fail.
   - Reopen: `pnpm run audit:public`, then plant a macOS-style home path (the Users directory followed by a name) in a scratch copy.
   - Fail-without mutant: remove CONTRIBUTING.md from PUBLIC_ROOTS; the planted path must then pass unnoticed, and the roots test must go red.
3. not-packaged: `pnpm pack --dry-run` (or the package file list verify-pack uses) does not include CONTRIBUTING.md, and verify-pack still passes.
   - Reopen: `pnpm run build && pnpm run test:package`.
   - Fail-without mutant: n/a (packaging read).
4. no-regression: `pnpm run typecheck`, `pnpm vitest run tests/audit --testTimeout=30000` and `pnpm run audit:public` are green, `charter check --strict` is green, and PR CI is green before acceptance.
   - Reopen: the same commands; `gh pr checks`.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands):
- pnpm run typecheck
- pnpm vitest run tests/audit --testTimeout=30000
- pnpm run audit:public
- pnpm run build && pnpm run test:package
- charter check --strict   (charter c923a80, $HOME/.local/share/charter/bin/c923a80cca2f74dba701ee073e631cc692b978e7/bin/charter)
Out of scope (recorded obligations, not fixed here):
- A private seat roster (outside this repository).
- The Mister Clean retirement record (waits for release 7.1.0).
Owner decision points:
- none.
