# Done list — say-validator-roundtrip (written BEFORE dispatch; does not grow during it)
Base bytes: c6bb48f (main: odin-say slices 1–3 and delivery-verdicts landed)
Problem: ODIN now has both halves of the delivery seam: a Rust sender (crates/odin-say) that writes proof records, and a TypeScript validator (odin.validate_cmux_delivery_proof, with record_kind and the delivery field) that judges them. Nothing proves they agree. Every odin-say slice recorded this as an open obligation; it is also the evidence base for mapping ODIN's delivery records onto PlanGraph delivery facts (multi-repo swarm study, experiment E2).
Design (fixed for this slice):
- A golden corpus: crates/odin-say/tests/fixtures/records/golden.jsonl, one record per sender outcome (delivered acked, delivered no-ack, queued mid-turn on Pi, busy refusal after the wait, blocked refusal, input-bar-only after a queue send without evidence). It is produced by a Rust test that runs the real sender flow against the stub cmux and writes the records, and the same test fails if the committed file differs from what the code produces now (drift check; regenerate only with an explicit env flag such as ODIN_SAY_REGEN_GOLDEN=1).
- A TypeScript test, tests/protocol/say-validator-roundtrip.test.ts, reads that file and runs every record through validateCmuxDeliveryProof and through the real MCP tool path, asserting for each record the expected `valid` and `delivery` value (delivered / delivered_no_ack / not_delivered / not_proven) and that every send_refusal is valid with delivery not_delivered.
- A mapping table (docs-free, in the TS test as data) from each record to the PlanGraph delivery fact it would produce, per the agreed mapping: submitted -> transport_accepted; DELIVERED_ACKED read-back -> recipient_observed; DELIVERED_NO_ACK and queued sends -> transport_accepted only; send_refusal -> no fact. The test asserts the table is total over the corpus (every record has a row). No PlanGraph code is imported.
Write scope: crates/odin-say/tests/** (new golden test and fixture only; no src change), tests/protocol/say-validator-roundtrip.test.ts (new). Nothing else.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. golden-is-live: the Rust test regenerates the corpus from the real sender flow and fails on drift.
   - Reopen: `cd crates/odin-say && cargo +1.88.0 test --locked` from a clean clone of the frozen tip.
   - Fail-without mutant: hand-edit one record's observed_processing_state in golden.jsonl; the Rust test must go red.
2. validator-agrees: every corpus record gets the expected valid/delivery verdict from validateCmuxDeliveryProof and through the MCP tool.
   - Reopen: `pnpm vitest run tests/protocol/say-validator-roundtrip.test.ts`.
   - Fail-without mutant: change one expected verdict in the test (or make the sender omit record_kind on refusals in a scratch copy); the test must go red.
3. mapping-total: every corpus record maps to exactly one PlanGraph fact outcome (a fact state or "no fact"), and refusals map to no fact.
   - Reopen: same vitest command.
   - Fail-without mutant: delete one mapping row; the totality assertion must go red.
4. no-regression: crate fmt/clippy/tests green; `pnpm run typecheck`, `pnpm vitest run tests/protocol tests/mcp --testTimeout=30000`, `pnpm run audit:public`, `charter/slice-zero.sh`, `charter check` green; CI green on the PR.
   - Reopen: the gates; `gh pr checks`.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands):
- cd crates/odin-say && cargo +1.88.0 fmt --check && cargo +1.88.0 clippy --locked --all-targets -- -D warnings && cargo +1.88.0 test --locked   (own CARGO_TARGET_DIR outside the repo, under nice)
- pnpm run typecheck
- pnpm vitest run tests/protocol tests/mcp --testTimeout=30000
- pnpm run audit:public
- charter/slice-zero.sh
- charter check
Out of scope (recorded obligations, not fixed here):
- Emitting real PlanGraph board facts from odin-say (needs PlanGraph's owner and a pinned interface).
Owner decision points:
- none.
