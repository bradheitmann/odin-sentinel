# Done list — ci-charter-job (standard gap CS-7, fleet pattern C; written BEFORE dispatch; does not grow during it)
Base bytes: c3240fd (main)
Problem: CS-7 — `charter check` does not run in odin's CI, because the charter tool's repository is private and odin is public. A/EXEC-PM ruled one fleet shape on 2026-11-01 (pattern C), distributed by PM-CHARTER: a CI job that probes the charter repository without credentials; while it is private the job prints `charter not run: repo private (owner decision pending)` and exits 0; once reachable, it installs the pinned charter commit, checks that `charter --version` names it, and runs `charter check --strict`, with no edit. No credential is ever added.
Design (fixed for this slice):
- Copy the job byte for byte from the distributed file (sha256 a09faba36e5def26bb8643f5612dbc66074649ea850b0a769fdaed662277934e) into .github/workflows/ci.yml under `jobs:`; the only edit is CHARTER_REV, set to odin's local pin e27e00aae1178d81f480119d08a80ba968281b7f.
- The job is NOT added to any required check or branch-protection rule.
- odin's existing guard test (tests/audit/actions-pinned.test.ts) must still pass on the new job. If it rejects the job's SHA-pinned `actions/checkout` v4 alongside the existing v6 pin, adjust the test only as far as needed to accept a second immutable SHA for the same action (every `uses:` still a 40-hex sha), never by loosening the sha requirement.
Write scope: .github/workflows/ci.yml (the new job only), tests/audit/actions-pinned.test.ts (only if needed, as above). Nothing else.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. byte-identical: the new job's text, with CHARTER_REV restored to the template placeholder, equals the distributed file byte for byte.
   - Reopen: extract the job from ci.yml in a clean clone of the frozen tip, substitute the placeholder back, and compare its sha256 with a09faba3...
   - Fail-without mutant: change one character in the job; the comparison must differ.
2. runs-and-skips: on the PR, the new job runs and passes with the log line `charter not run: repo private (owner decision pending)`; validate, telemetry-validate and odin-say still pass.
   - Reopen: `gh pr checks` and the job log for the PR carrying the tip.
   - Fail-without mutant: n/a (CI observation).
3. pins-still-enforced: `pnpm vitest run tests/audit/actions-pinned.test.ts` passes, and still fails on a planted tag ref (`@v4`) in the new job.
   - Reopen: the vitest command; plant `@v4` in a scratch copy.
   - Fail-without mutant: replace the job's checkout sha with `@v4`; the test must go red.
4. not-required: the job does not appear among required status checks (`gh api repos/<owner>/<repo>/branches/main/protection/required_status_checks` reports no such context, or protection is absent).
   - Reopen: that command.
   - Fail-without mutant: n/a (configuration read).
5. no-regression: `pnpm run typecheck`, `pnpm vitest run tests/audit --testTimeout=30000`, `pnpm run audit:public`, `charter check --strict` green; actionlint on ci.yml if available.
   - Reopen: the same commands.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands):
- pnpm run typecheck
- pnpm vitest run tests/audit --testTimeout=30000
- pnpm run audit:public
- charter check --strict   (charter e27e00a)
Out of scope (recorded obligations, not fixed here):
- Bump CHARTER_REV (and odin's local pin, per-repo install per charter TODO 67) when PM-CHARTER announces the next fleet pin. The current pin's `charter --version` may not print its commit, which the job checks once the repository is public; the next pin is expected to.
- Making the charter repository public or adding a read token (owner list).
Owner decision points:
- none (EXEC-PM ruled the pattern).
