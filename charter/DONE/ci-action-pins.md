# Done list — ci-action-pins (standard gap CS-4; written BEFORE dispatch; does not grow during it)
Base bytes: 4814075 (main)
Problem: the common engineering standard (§5) requires GitHub Actions and other CI inputs pinned to immutable references. .github/workflows/ci.yml pins actions/checkout and actions/setup-node to commit shas; .github/workflows/release.yml still uses the mutable `@v6` tags on six steps, so the release path can run code that changed after review.
Design (fixed for this slice): pin every `uses:` in .github/workflows/*.yml to a full 40-character commit sha with the tag as a trailing comment (`# v6`), reusing the exact shas already in ci.yml for the same actions. Add a test that reads every workflow file and fails on any `uses:` that is not a 40-hex sha (local `./` actions excepted).
Write scope: .github/workflows/release.yml (the six `uses:` lines only), tests/audit/actions-pinned.test.ts (new, strict TypeScript). Nothing else.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. all-pinned: every `uses:` in .github/workflows/*.yml is pinned to a 40-hex commit sha, and release.yml uses the same shas as ci.yml for the same actions.
   - Reopen: `grep -n 'uses:' .github/workflows/*.yml` from a clean clone of the frozen tip; every line carries a 40-hex sha.
   - Fail-without mutant: change one release.yml step back to `@v6`; the test must go red naming the file and line.
2. guard-test: tests/audit/actions-pinned.test.ts passes on the tip and names the offending file and line when a tag or branch ref is planted.
   - Reopen: `pnpm vitest run tests/audit/actions-pinned.test.ts`.
   - Fail-without mutant: make the test accept any `@` ref; the planted-ref case must go red.
3. no-regression: `pnpm run typecheck`, `pnpm vitest run tests/audit --testTimeout=30000`, `pnpm run audit:public`, `charter check` green; CI validate and telemetry-validate pass on the PR.
   - Reopen: the same commands; `gh pr checks` on the PR.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands):
- pnpm run typecheck
- pnpm vitest run tests/audit --testTimeout=30000
- pnpm run audit:public
- charter check
Out of scope (recorded obligations, not fixed here):
- CS-7 (`charter check` in CI): blocked on how a public repository can obtain the pinned charter tool (the tool's repository is private; release or owner decision pending).
- The release workflow itself is not run (no release in this slice).
Owner decision points:
- none.
