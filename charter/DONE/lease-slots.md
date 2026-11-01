# Done list — lease-slots (written BEFORE dispatch; does not grow during it)
Base bytes: a27ffda (main)
Problem: field case, 2026-11-01, reported by the consumer and confirmed by PM from the lease records. A consumer repository used odin's lease (released at f79288c) as a host-wide lock on full test suites: two slots, suite-1 and suite-2, shared by about nine DEV/QA agents, with a TTL of 5400 s. Under the lease, host load fell from about 12 (about 10 concurrent suites) to about 4.9, and recovery-test timeouts that had hit every suite under load stopped recurring (one QA run: 128 passed, 0 failed, in 1951 s). By 14:48Z suite-1 had reached token 5 and suite-2 token 3, and agents had waited for slots; one skipped its run when both were held.
Two gaps showed:
(1) Any slot name is accepted, so a typo creates a new slot instead of failing. One agent took a nonexistent `suite-9`, and a smoke test left a `probe` slot.
(2) "Any free slot of N" is done by hand: each agent tries suite-1, then on slot_held tries suite-2, then waits and retries. Each agent writes these commands itself, so the race between the two tries is repeated in every caller.
A second consumer (a loop-runner repository, which adopted the lease on its own) sent two adopter notes. Slot ids refuse colons, so ISO instants must be written without them. The lease directory must be a local path, never a sync-managed folder.
Design (fixed for this slice):
- Slot allow-list: an optional file `slots.allow` in the lease directory, one slot id per line. Blank lines and lines starting with `#` are ignored. When the file exists, every operation on a slot it does not list is refused with typed reason `slot_not_allowed`, and nothing is written. When the file is absent, behaviour is unchanged. A malformed file (a line that is not a valid slot id) fails closed, with typed reason `slots_allow_invalid`, for every operation.
- Any-of acquire: `odin-sentinel lease acquire --dir <dir> --slots <a,b,...> --holder <id> [--ttl <s>]`. It tries the listed slots in order and grants the first that is free, held by the same holder, or expired. Exactly one slot is granted per call. The result names the slot granted and its token. If every listed slot is held, it is refused with `all_slots_held` and lists each holder and expiry. `--slot` and `--slots` together are `invalid_args`.
- The any-of decision is race-free: under N concurrent callers and K slots, no slot is ever granted twice and no caller holds two. Reuse the existing lock: take each slot's lock in the listed order, one at a time, never two at once. Do not add a new lock.
- The `invalid_slot` refusal detail says that colons are not allowed and gives the instant form `YYYY-MM-DDTHHMMZ`.
- New public doc, docs/reference/lease.md. It covers the operations, fencing (an action is valid only with the current token; a lower token is void), the allow-list, any-of acquire, both adopter notes (no colons; a local, non-synced directory), and a short field-case section. The field case describes the consumers generically, with no repository names, host paths or agent names, and gives the numbers above.
Write scope:
- src/protocol/lease/store.ts and src/protocol/lease/index.ts;
- src/bin/index.ts, the lease subcommand only;
- tests/protocol/lease.test.ts and tests/protocol/lease-cli.test.ts;
- tests/protocol/lease-customer.test.ts (new);
- docs/reference/lease.md (new);
- protocol/SCP.md, only if the doctrine audit requires it;
- tests/fixtures/govdisp/baseline-manifest.json, generator only (standing ruling).
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. customer-two-slot: tests/protocol/lease-customer.test.ts reproduces the field pattern through the real CLI. A lease directory has `slots.allow` listing suite-1 and suite-2. Six concurrent processes run `acquire --slots suite-1,suite-2`, repeated for at least 10 rounds with fresh holders, releasing between rounds. In every round exactly two processes are granted, one per slot, and the rest are refused with all_slots_held. Tokens only increase per slot across rounds. A typo slot (`suite-9`) is refused with slot_not_allowed, and no suite-9 file is created.
   - Reopen: `pnpm vitest run tests/protocol/lease-customer.test.ts --testTimeout=60000` from a clean clone of the frozen tip.
   - Fail-without mutant: in any-of acquire, check whether a slot is free outside its lock; the test must go red (record the round).
2. allow-list: slot_not_allowed covers every operation on an unlisted slot and writes nothing. When the file is absent, behaviour is unchanged (the existing lease tests pass unmodified). A malformed file fails closed with slots_allow_invalid.
   - Reopen: `pnpm vitest run tests/protocol/lease.test.ts tests/protocol/lease-cli.test.ts --testTimeout=60000`.
   - Fail-without mutant: ignore the allow-list for `release`; the test must go red.
3. any-of-semantics: with all slots held, the call is refused, lists each slot's holder and expiry, and writes nothing. A same-holder re-acquire returns the slot that holder already holds, with no second grant. An expired slot is taken over with its token incremented. `--slot` with `--slots` is invalid_args.
   - Reopen: same as proof 2.
   - Fail-without mutant: grant the first slot without checking whether it is held; the test must go red.
4. docs-and-hints: docs/reference/lease.md exists and the public audit passes on it. The invalid_slot detail names colons and the instant form. The doc's field case contains no repository name, host path or agent name.
   - Reopen: `pnpm run audit:public`, plus a grep of the doc.
   - Fail-without mutant: put a home path in the doc; the audit must fail.
5. no-regression:
   - `pnpm run typecheck`;
   - `pnpm vitest run tests --testTimeout=30000` (the only tolerated failures are the known timeout-policy cases recorded in STATE);
   - `pnpm run validate`, sequentially;
   - `pnpm run audit:public` and `pnpm run audit:doctrine`;
   - `charter/slice-zero.sh` and `charter check --strict`;
   - PR CI green before acceptance.
   - No test may run `pnpm run build` or touch dist/; spawn the CLI from source with `--import tsx`.
   - Reopen: the same commands, and `gh pr checks`.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands):
- pnpm run typecheck
- pnpm vitest run tests --testTimeout=30000
- pnpm run validate
- pnpm run audit:public
- pnpm run audit:doctrine
- charter/slice-zero.sh
- charter check --strict   (charter c923a80, $HOME/.local/share/charter/bin/c923a80cca2f74dba701ee073e631cc692b978e7/bin/charter)
Out of scope (recorded obligations, not fixed here):
- Waiting or blocking acquire (the caller still decides how to wait).
- Wiring any consumer to the new flags; consumers adopt them in their own repositories.
- Publishing the CLI to npm.
Owner decision points:
- none.
