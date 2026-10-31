# Done list — registry-lock-budget (written BEFORE dispatch; does not grow during it)
Base bytes: fe4938a (chore/charter-adoption)
Problem: the event registry's cross-process lock gives a contending writer 50 attempts x 10 ms (about 0.5 s) before a lock_unavailable rejection. tests/protocol/event-registry-contention.test.ts ("four racing processes produce an intact, complete, line-atomic log", 4 writers x 25 appends) fails about 1 run in 4 even when run alone, because a legitimate writer exhausts that budget. Failing closed is right; the default budget is too tight (owner rule: controls stay, with generous defaults).
Design (fixed for this slice): keep the fail-closed rejection and its code. Replace the default fixed 10 ms x 50 with capped exponential backoff with jitter under a wall-clock budget: start 5 ms, double to a 200 ms cap, random jitter, default total budget 10 000 ms. Explicit maxLockAttempts / lockRetryMs options keep working exactly as today (tests that pass them are unaffected). Add an optional lockBudgetMs option. The rejection detail names the attempts made and the elapsed milliseconds. Apply the same policy in storage.ts (append) and compact.ts (compaction).
Write scope: src/protocol/event-registry/storage.ts, src/protocol/event-registry/compact.ts (lock acquisition and options only), tests/protocol/event-registry-contention.test.ts, tests/protocol/registry-lock-budget.test.ts (new). Nothing else.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. contention-stable: the contention test passes 20 consecutive runs alone (`for i in $(seq 20); do pnpm vitest run tests/protocol/event-registry-contention.test.ts || exit 1; done`), and the log stays intact, complete and line-atomic.
   - Reopen: rerun that loop from a clean checkout of the frozen tip; compare the pass count (20/20).
   - Fail-without mutant: restore the 50 x 10 ms default; the loop must fail within 20 runs (record the failing run number).
   - reopened: OD-QA-registry-lock-budget-1d2b721 b50e560f668cefd1acf696fc485e79d84acc2a05e72404d14e214481373254d1
2. still-fails-closed: a writer facing a lock that is never released gets the same lock_unavailable rejection (same code and field) once its budget is spent, and never writes; with lockBudgetMs set small (e.g. 100) the test finishes in under 2 s.
   - Reopen: `pnpm vitest run tests/protocol/registry-lock-budget.test.ts` from a clean checkout.
   - Fail-without mutant: make acquisition proceed after the budget without the lock; the test must go red.
   - reopened: OD-QA-registry-lock-budget-1d2b721 b50e560f668cefd1acf696fc485e79d84acc2a05e72404d14e214481373254d1
3. explicit-options-unchanged: callers passing maxLockAttempts and lockRetryMs get exactly that many attempts at that fixed interval (existing tests in tests/protocol/govdisp-compaction.test.ts and the contention file that pass these options are unchanged and green).
   - Reopen: `pnpm vitest run tests/protocol/govdisp-compaction.test.ts tests/protocol/registry-lock-budget.test.ts`.
   - Fail-without mutant: ignore the explicit maxLockAttempts; the explicit-options test must go red.
   - reopened: OD-QA-registry-lock-budget-1d2b721 b50e560f668cefd1acf696fc485e79d84acc2a05e72404d14e214481373254d1
4. no-regression: pnpm run typecheck clean; `pnpm vitest run tests/protocol --testTimeout=30000` green; charter/slice-zero.sh green.
   - Reopen: rerun the three commands from a clean checkout.
   - Fail-without mutant: n/a for the aggregate gate (covered by proofs 1 to 3).
   - reopened: OD-QA-registry-lock-budget-1d2b721 b50e560f668cefd1acf696fc485e79d84acc2a05e72404d14e214481373254d1
Gates (exact commands):
- pnpm run typecheck
- pnpm vitest run tests/protocol --testTimeout=30000
- the 20-run loop in proof 1
- charter/slice-zero.sh
- charter check
Out of scope (recorded obligations, not fixed here):
- vitest's 5 s default timeout makes other suites flaky under disk load (seen in tests/scripts/sync-installations.test.ts); a suite-wide timeout policy is a separate slice.
Owner decision points:
- none (fail-closed behaviour and rejection code are kept; only the default budget grows).
