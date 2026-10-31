# Done list — delivery-verdicts (written BEFORE dispatch; does not grow during it)
Base bytes: fe4938a (chore/charter-adoption)
Problem: senders log every attempt, including pre-send refusals (busy pane, permission prompt, stranded input). Today odin.validate_cmux_delivery_proof reports those records as "invalid", and it reads PANE_STILL_THINKING as "delivered, still processing" while field senders use the same state name for "not sent because the pane was busy". One field log held 2,451 records, 1,485 of them such refusals.
Design (fixed for this slice): an optional field `record_kind` on the proof. Absent or "delivery" = today's behaviour, byte-for-byte. "send_refusal" = a typed non-delivery record. Every result gains an additive field `delivery` with one of: "delivered", "delivered_no_ack", "not_delivered", "not_proven".
Write scope: src/protocol/service.ts (validateCmuxDeliveryProofProse and its constants only), src/mcp/server.ts (the tool's input schema description only, if needed), protocol/SCP.md (the CMUX delivery-proof section only), tests/protocol/delivery-verdicts.test.ts (new), tests/fixtures/delivery-verdicts/ (new). Nothing else.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. legacy-verdicts-unchanged: for proofs without record_kind, valid/missing/invalid/warnings are identical to fe4938a for the seven field samples (DELIVERED_ACKED, DELIVERED_NO_ACK, PANE_STILL_THINKING, PANE_BLOCKED_ON_PERMISSION, three INPUT_BAR_ONLY) and for every existing case in tests/protocol/activation-gates.test.ts and tests/protocol/epic-020-delivery-contract.test.ts. charter/slice-zero.sh stays green.
   - Reopen: from a clean checkout of the frozen tip, run `pnpm vitest run tests/protocol/delivery-verdicts.test.ts tests/protocol/activation-gates.test.ts tests/protocol/epic-020-delivery-contract.test.ts --testTimeout=30000` and `charter/slice-zero.sh`.
   - Fail-without mutant: make a proof without record_kind and submitted=false return valid=true; the legacy test and slice-zero must go red.
   - reopened: OD-QA-delivery-verdicts-b6d435e 91723abb9e93599c455192169da475a38169f8800b1f6ca9e1faa2a782d9bb6f
2. refusal-typed: a proof with record_kind="send_refusal", submitted=false and observed_processing_state in {PANE_STILL_THINKING, PANE_BLOCKED_ON_PERMISSION, INPUT_BAR_ONLY} returns valid=true and delivery="not_delivered", and carries the state as `non_delivery_reason`. All five refusal samples (2 busy/blocked + 3 INPUT_BAR_ONLY, rewritten with record_kind) pass.
   - Reopen: same vitest command; compare the per-sample verdict table in the test output.
   - Fail-without mutant: drop the send_refusal branch; the five refusal samples must fail.
   - reopened: OD-QA-delivery-verdicts-b6d435e 91723abb9e93599c455192169da475a38169f8800b1f6ca9e1faa2a782d9bb6f
3. refusal-cannot-claim-delivery: a send_refusal with submitted=true, or with state DELIVERED_ACKED or DELIVERED_NO_ACK, returns valid=false with a named warning (a refusal record cannot attest a delivery). An unknown record_kind value is invalid.
   - Reopen: same vitest command.
   - Fail-without mutant: accept submitted=true on a send_refusal; the test must go red.
   - reopened: OD-QA-delivery-verdicts-b6d435e 91723abb9e93599c455192169da475a38169f8800b1f6ca9e1faa2a782d9bb6f
4. delivery-field: every result carries `delivery`: DELIVERED_ACKED valid -> "delivered"; DELIVERED_NO_ACK valid -> "delivered_no_ack"; a valid send_refusal -> "not_delivered"; any invalid delivery record -> "not_proven". The field is additive: no existing key is renamed or removed.
   - Reopen: same vitest command plus the MCP round trip in tests/mcp/server.test.ts.
   - Fail-without mutant: return "delivered" for an invalid record; the test must go red.
   - reopened: OD-QA-delivery-verdicts-b6d435e 91723abb9e93599c455192169da475a38169f8800b1f6ca9e1faa2a782d9bb6f
5. doctrine-documented: protocol/SCP.md's delivery-proof section names record_kind, the send_refusal kind, the delivery field, and the pre-send versus post-send meaning of PANE_STILL_THINKING. pnpm run audit:public and audit:doctrine stay green.
   - Reopen: `pnpm run audit:public && pnpm run audit:doctrine` on the frozen tip; read the section.
   - Fail-without mutant: delete the record_kind paragraph; the reviewer's checklist item fails (documentation proof is a QA read, recorded in the receipt).
   - reopened: OD-QA-delivery-verdicts-b6d435e 91723abb9e93599c455192169da475a38169f8800b1f6ca9e1faa2a782d9bb6f
Gates (exact commands):
- pnpm run typecheck
- pnpm vitest run tests/protocol tests/mcp --testTimeout=30000
- charter/slice-zero.sh
- pnpm run audit:public
- pnpm run audit:doctrine
- charter check
Out of scope (recorded obligations, not fixed here):
- The Rust sidecar sender, pane rules as data, the bounded wait for busy panes and the OpenCode leftover "Thinking:" fixture (team-tooling export; next slices).
- Renaming the PANE_STILL_THINKING state (a vocabulary change needs a migration plan for existing logs).
Owner decision points:
- none (the design keeps every existing verdict).
