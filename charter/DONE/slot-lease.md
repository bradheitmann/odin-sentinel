# Done list — slot-lease (written BEFORE dispatch; does not grow during it)
Base bytes: c3240fd (main)
Problem: agent teams run recurring jobs from more than one runner (a primary and a backup). They coordinate through an append-only event log, which is not an atomic lock: a stalled runner's pre-send check and another runner's recovery claim can interleave within seconds, and both act (field case 2026-11-01: a multi-repo feedback loop documents this as its one remaining race). The durable fix is a lease, one holder per slot with an expiry and a fencing token, which is execution-layer mechanics owned by ODIN. Consumers cite ODIN's mechanism rather than building their own.
Design (fixed for this slice):
- A lease store in a configurable directory (flag or env; no default inside any repository): one record per slot holding slot id, holder id, fencing token (a per-slot integer that only ever increases), acquired time, and expiry time.
- Every read-modify-write of a slot's record happens under ODIN's existing cross-process registry lock policy (the lock in src/protocol/event-registry/storage.ts; fail closed, generous budget). Reuse it; do not write a second lock.
- Operations: acquire (succeeds if the slot is free, held by the same holder, or expired; taking over an expired lease increments the token), renew (current holder and token only), release (current holder and token only), check (is this holder still the holder with this token and unexpired), status (read-only).
- Fencing contract, documented: an actor checks its lease immediately before acting and stamps every action with its token; for a slot, the action with the highest token wins and lower-token actions are void. This turns the interleaving race into a detectable, resolvable conflict even when an expired holder acts late.
- Clock: expiry uses wall-clock time with an explicit skew allowance (configurable, documented default) applied before a takeover.
- A CLI: `odin-sentinel lease <acquire|renew|release|check|status> --dir <dir> --slot <id> [--holder <id>] [--ttl <seconds>] [--token <n>]`, printing one JSON object and exiting 0 on success, non-zero with a typed reason otherwise. The CLI loads the lease module lazily, respecting the runtime-isolation invariant.
Write scope: src/protocol/lease/ (new module), src/bin/index.ts (the lease subcommand only), tests/protocol/lease.test.ts and tests/protocol/lease-cli.test.ts (new), protocol/SCP.md (a short lease and fencing section, if the doctrine audit requires documentation of the new identifiers), tests/fixtures/govdisp/baseline-manifest.json (generator only, standing ruling).
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. one-holder: N processes (at least 4) racing to acquire one free slot, repeated at least 20 times, always yield exactly one holder and one token per round.
   - Reopen: `pnpm vitest run tests/protocol/lease.test.ts --testTimeout=30000` from a clean clone of the frozen tip.
   - Fail-without mutant: do the read-modify-write outside the lock; the race test must go red within its repetitions (record how many).
2. expiry-and-fencing: an expired lease can be taken over and the token increments; the old holder's check, renew and release all fail with typed reasons; an action stamped with the old token is reported void against the new one.
   - Reopen: same vitest command.
   - Fail-without mutant: allow takeover without incrementing the token; the fencing test must go red.
3. holder-only: renew and release by a different holder, or with a stale token, are refused and change nothing.
   - Reopen: same vitest command.
   - Fail-without mutant: drop the token check from renew; the test must go red.
4. cli-contract: the CLI prints one JSON object per call, exits 0 on success and non-zero with a typed reason on refusal, and never writes outside --dir.
   - Reopen: `pnpm vitest run tests/protocol/lease-cli.test.ts --testTimeout=30000`.
   - Fail-without mutant: make a refused acquire exit 0; the CLI test must go red.
5. no-regression: `pnpm run typecheck`, `pnpm vitest run tests --testTimeout=30000`, `pnpm run audit:public`, `pnpm run audit:doctrine`, `charter/slice-zero.sh`, `charter check --strict` green; CI green on the PR.
   - Reopen: the same commands; `gh pr checks`.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands):
- pnpm run typecheck
- pnpm vitest run tests --testTimeout=30000
- pnpm run audit:public
- pnpm run audit:doctrine
- charter/slice-zero.sh
- charter check --strict   (charter e27e00a)
Out of scope (recorded obligations, not fixed here):
- Wiring any specific consumer (for example a multi-repo feedback loop's runners) to the lease; the consumer adopts it in its own repository.
- The idle-seat watcher itself (it may use this lease later).
Owner decision points:
- none.
