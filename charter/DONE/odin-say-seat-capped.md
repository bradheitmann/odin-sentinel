# Done list — odin-say-seat-capped (written BEFORE dispatch; does not grow during it)
Base bytes: 95ee94a (main)

## Problem (field case, 2026-11-02)
Three agent seats in a consumer repository silently stopped on a provider's free-tier daily cap. The panes show "429 … free-models-per-day…", and on one harness the raw `X-RateLimit-Reset` header. Nothing surfaced it until a human read the panes hourly.

odin-say classifies all three panes as `idle` today (PM baseline, read-only `odin-say status`). So it would deliver work into seats that cannot run it.

Two facts shape the fix:
- The cap error is NOT in the last three lines that the busy rule reads. It sits in the pane's most recent output block, above the input bar and footer.
- One harness labels its footer "thinking" as a mode while capped. odin-say already reads that as idle, not busy.

Proposal from PM-CHARTER (ROUND11), routed by A/EXEC-PM. Real captures are kept outside this repository (sha256 noted in STATE at acceptance).

## Design (fixed for this slice)
- **New state `SEAT_CAPPED`.** It sits in the pane-rules JSON beside the existing states, with no hard-coded literals in the sender. Cap markers come from the rules:
  - "free-models-per-day";
  - `"code":429` together with "Rate limit exceeded";
  - `limit_source` of a daily free tier;
  - "Retry failed after N attempts: 429".
- **When a pane is capped.** It is capped when the newest output block above the input bar and footer chrome contains a cap marker, and no later turn output follows it. A cap message followed by later normal output is not capped (a stale cap).
- **Precedence:** blocked, then busy, then capped, then stale_input, then idle. A pane that is working is not capped.
- **Reset time.** When the screen shows `X-RateLimit-Reset` (epoch milliseconds), report `reset_at` as ISO UTC. Otherwise `reset_at` is null. Never guess a reset from a provider's habits.
- **`odin-say status <surface>`** prints `capped` (plus `reset_at` when known).
- **`odin-say say`** refuses before typing anything:
  - exit code 10 (`SEAT_CAPPED`), documented in the README exit table;
  - one proof record of kind `send_refusal`, with `observed_processing_state: "SEAT_CAPPED"`, plus `reset_at` and the matched marker.
  - It never sends, never waits for the cap to clear, and never retries.
- **ODIN's TypeScript validator** (src/protocol/service.ts) knows `SEAT_CAPPED`:
  - verdict: not delivered, refusal, safe (nothing was typed);
  - the PlanGraph delivery-fact mapping maps it to no fact.
  - The say-validator round trip stays total over the corpus.
- **Fixtures** come from the three real captures. Private paths, seat names and identifiers are replaced with placeholders, and the shape and the cap lines are kept verbatim. A stale-cap fixture is built from a real capture with later output appended, and labelled constructed.

## Write scope
- crates/odin-say/** (rules, sender, status, pane-rules JSON, tests, fixtures, README, PROVENANCE)
- src/protocol/service.ts (delivery-state lists and verdicts only)
- src/mcp/server.ts (only if a state list or description there must name the new state)
- tests/protocol/say-validator-roundtrip.test.ts and its golden corpus
- tests/fixtures/govdisp/baseline-manifest.json (generator only)

## Proofs
Each proof gives what it guarantees, how to reopen it, and its fail-without mutant.

1. **real-captures-capped.** `status` on each of the three sanitized real captures prints `capped`. The harness with the reset header reports `reset_at` = 2026-11-03T00:00:00Z. The two without it report `reset_at` null. Before the change all three were `idle`.
   - Reopen: `cargo test -p odin-say` from a clean clone of the frozen tip.
   - Fail-without mutant: remove the cap markers from the rules; the three tests go red.
2. **no-false-capped.** These are not capped:
   - the stale-cap fixture (later output after the cap);
   - a busy pane whose scrollback holds an old cap line;
   - every existing pane fixture in the corpus, all of which keep their previous verdicts.
   - Reopen: the same command.
   - Fail-without mutant: judge "cap marker anywhere on screen"; the stale and busy tests go red.
3. **say-refuses-capped.** `say` on a capped fixture:
   - types nothing (the scripted cmux records no send and no key);
   - exits 10;
   - writes exactly one `send_refusal` record with SEAT_CAPPED, `reset_at` and the marker.
   - Reopen: the same command.
   - Fail-without mutant: let `say` proceed on a capped pane; the test goes red.
4. **validator-roundtrip.** The golden corpus gains SEAT_CAPPED records, as `send_refusal` and in any delivery form the sender can produce. ODIN's validator gives each the expected verdict, through the function and through the MCP tool. The PlanGraph mapping is total.
   - Reopen: `pnpm vitest run tests/protocol/say-validator-roundtrip.test.ts --testTimeout=30000`.
   - Fail-without mutant: drop SEAT_CAPPED from service.ts; the round trip goes red.
5. **no-regression.** These pass, and PR CI is green before acceptance:
   - `cargo fmt --check`, `cargo clippy -D warnings` and `cargo test` for odin-say;
   - `pnpm run typecheck`;
   - `pnpm vitest run tests --testTimeout=30000` (only the known timeout-policy cases in STATE are tolerated);
   - `pnpm run audit:public`, `pnpm run audit:doctrine`;
   - `charter/slice-zero.sh`, `charter check --strict`.
   - Reopen: the same commands, plus `gh pr checks`.
   - Fail-without mutant: n/a (aggregate).

## Gates (exact commands)
- cargo fmt --check, cargo clippy --all-targets -- -D warnings, cargo test (in crates/odin-say, with its own CARGO_TARGET_DIR)
- pnpm run typecheck
- pnpm vitest run tests --testTimeout=30000
- pnpm run audit:public
- pnpm run audit:doctrine
- charter/slice-zero.sh
- charter check --strict (charter 7b12eeaf, $HOME/.local/share/charter/bin/7b12eeaf8c4d734386a863dc01c06da6c7ac4cb8/bin/charter)

## Out of scope (recorded obligations, not fixed here)
- Consumers adopting the state, for example reveng's own sender copying the rule.
- Waking an orchestrator when a seat is capped (the watcher's job).
- Other provider limits (monthly, credit) until a real capture exists.

## Owner decision points
- none.
