# Done list — odin-say-mid-turn (odin-say slice 2; written BEFORE dispatch; does not grow during it)
Base bytes: 27d065d (feat/odin-say slice 1, DEV done, in QA). Lands after slice 1.
Problem: slice 1 refuses every busy pane after a bounded wait. Some harnesses buffer text typed mid-turn and deliver it as a queued steer (field evidence 2026-10-31: Pi delivered urgent STOP messages typed mid-turn; a sender that refused every mid-turn pane blocked a STOP for 50 minutes; filed upstream as an orchestration sender-policy failure). Refusing those panes loses time; queueing into a harness that does not buffer would strand text. The policy must be per harness and evidence-based.
Design (fixed for this slice):
- pane-rules.json gains a `harnesses` table: per harness name, `detect` markers (footer or chrome patterns), `mid_turn` = "queue" or "refuse", and `queue_evidence` markers that show text sitting in that harness's queue or steer region. Shipped values: pi -> queue (with the evidence markers from the real capture below); every other harness (claude-code, codex, opencode, unknown) -> refuse until a captured screen proves buffering. A later slice may flip one with its own capture; this slice never guesses.
- Harness identity: `--harness <name>` flag, then ODIN_SAY_HARNESS, then footer detection; an undetected harness is "unknown" and refuses. The record states how identity was obtained (`harness_source`: flag, env, detected, unknown).
- Mid-turn flow for a "queue" harness: when the pane is busy (not blocked), send the single line and Enter without waiting for idle, then read back; DELIVERED only if the sent text (or its flattened form) appears with a queue_evidence marker. Record observed_processing_state PANE_STILL_THINKING, submitted true, record_kind delivery, plus `queued: true`. (ODIN's validator already reads submitted + PANE_STILL_THINKING as delivered, not yet acknowledged; no new state name.) If the read-back does not show the text queued, record INPUT_BAR_ONLY with submitted true and exit non-zero; no second Enter.
- Blocked-on-permission panes still refuse at once for every harness. Idle panes follow slice 1 unchanged. "refuse" harnesses keep slice 1's bounded wait.
Write scope: crates/odin-say/** only. Nothing else.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. pi-queues-mid-turn: with the stub cmux, a busy Pi pane (real capture fixture) receives the send immediately (polls = 1, waited_ms = 0), the read-back fixture shows the text in Pi's queue region, and the record is delivery / submitted true / PANE_STILL_THINKING / queued true / harness pi.
   - Reopen: `cd crates/odin-say && cargo test --locked` from a clean clone of the frozen tip.
   - Fail-without mutant: set pi's mid_turn to "refuse" in pane-rules.json; the test must go red.
   - reopened: OD-QA-odin-say-mid-turn-1851746 27d7d1e69523e170849c0febab8779f6a176643edcf690cb1f0b0203ea808cf8
2. unknown-and-unverified-refuse: busy panes for claude-code, codex, opencode and an unknown footer keep slice 1's bounded wait and refuse with send_refusal after the budget; none is ever typed into while busy.
   - Reopen: same cargo test.
   - Fail-without mutant: make the default policy "queue"; the test must go red.
   - reopened: OD-QA-odin-say-mid-turn-1851746 27d7d1e69523e170849c0febab8779f6a176643edcf690cb1f0b0203ea808cf8
3. queued-without-evidence-is-not-delivered: a Pi read-back that does not show the text queued records INPUT_BAR_ONLY, submitted true, exits non-zero, and sends exactly one Enter.
   - Reopen: same cargo test.
   - Fail-without mutant: treat any read-back after a queue send as delivered; the test must go red.
   - reopened: OD-QA-odin-say-mid-turn-1851746 27d7d1e69523e170849c0febab8779f6a176643edcf690cb1f0b0203ea808cf8
4. identity-recorded: harness from flag beats env beats detection; `harness_source` is written on every record; blocked panes refuse at once for every harness.
   - Reopen: same cargo test.
   - Fail-without mutant: ignore --harness; the identity test must go red.
   - reopened: OD-QA-odin-say-mid-turn-1851746 27d7d1e69523e170849c0febab8779f6a176643edcf690cb1f0b0203ea808cf8
5. evidence-is-real: crates/odin-say/tests/fixtures/screens/pi_busy_steer_queued.txt and pi_busy.txt are real screen captures (provenance noted in PROVENANCE.md with date and source, private paths and names replaced by placeholders), not synthesized; slice 1's 12 fixtures still classify unchanged; CI job green; the public-path grep from slice 1 stays clean.
   - Reopen: read PROVENANCE.md; `cargo test --locked`; `gh pr checks` on the PR.
   - Fail-without mutant: n/a for provenance (a QA read); slice 1 fixture regression is covered by its own tests.
   - reopened: OD-QA-odin-say-mid-turn-1851746 27d7d1e69523e170849c0febab8779f6a176643edcf690cb1f0b0203ea808cf8
Gates (exact commands):
- cd crates/odin-say && cargo +1.88.0 fmt --check && cargo +1.88.0 clippy --locked --all-targets -- -D warnings && cargo +1.88.0 test --locked   (own CARGO_TARGET_DIR outside the repo, under nice)
- pnpm run audit:public
- charter check
Out of scope (recorded obligations, not fixed here):
- Flipping claude-code, codex or opencode to "queue": each needs its own captured evidence slice.
- Cross-language validation of queued records by odin.validate_cmux_delivery_proof (with the slice-1 obligation).
Owner decision points:
- none (EXEC-PM relayed the field rule; unverified harnesses stay on the safe default).
