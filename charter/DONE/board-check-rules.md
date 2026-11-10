# Done list — board-check-rules (written BEFORE dispatch; does not grow during it)
Base bytes: f39338b (main)
Authority: a defect repair of slice board-seatmap, the one contribution the owner's plan of 2026-11-10 assigned this PARKED repository. No new capability.
Problem: the independent verifier re-ran the landed `board check` on the consumer's live board about half an hour after landing and found two rules that report correct lines as failures. Both rules were written into board-seatmap's design by its author (the PM), so this is a contract defect, not an implementation slip.
- L1: a short stamp whose time of day is later than its line's time is always looked up on the previous day. The consumer adds a stamp to a line after a late delivery on the same day (its "(late)" idiom), so a true same-day delivery is reported DELIVERED_NO_PROOF.
- L2: on a line that names several seats, a delivery must target the first seat named. A correct delivery to any other named seat is reported DELIVERED_WRONG_TARGET.
Design (fixed for this slice; only `board check` and what it shares with `board post` change):
- Stamp date. A full-UTC stamp is used as written. A short stamp (HH:MM:SSZ) is looked up on the line's UTC day first. Only when no delivery matches there, and the stamp's time of day is later than the line's, is the previous UTC day tried. The stamp passes when either lookup finds a delivery.
- Target. With a seat map, the named seats of a line are every word of the state field, after the state word, whose seat key is in the map (punctuation around a word is ignored). When at least one seat is named, a stamp's delivery must target the surface of any named seat, else DELIVERED_WRONG_TARGET. When several deliveries share the stamp's second, any of them may satisfy it. When no word names a mapped seat, any delivery at that second passes, as before.
- Coverage note. For each named seat that no stamp on the line covers, `check` prints a line starting `note:` with the line number, the reason word SEAT_NOT_COVERED and the seat. Notes never change the exit status and are counted separately in the summary line, because a line may mention a seat it did not dispatch to.
- Nothing else changes: line typing, DISPATCH_NO_DELIVERED, hints, exit codes, `seat-map`, `events`, and `post` (whose stamp is still taken from the proof log).
Write scope: crates/odin-say/src/board.rs, crates/odin-say/src/main.rs (output wiring only), crates/odin-say/tests/board_check.rs, crates/odin-say/tests/fixtures/board/ (synthetic only), crates/odin-say/README.md (the Board section). Nothing else; PM-ODIN writes STATE at acceptance.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. late-same-day: a line at 13:47:40Z stamped 13:58:11Z with a delivery on the same day at 13:58:11Z passes; the board-seatmap midnight cases still hold (a line at 00:05:00Z stamped 23:58:00Z passes with a delivery on the previous day and fails DELIVERED_NO_PROOF with none; month boundary; a later stamp with a delivery on neither day fails).
   - Reopen: `cargo test --locked --test board_check`.
   - Fail-without mutant: restore "later than the line means the previous day only"; the same-day case must go red.
2. any-named-seat: a line naming three mapped seats, with one stamp per seat in any order, passes; the same line with one stamp whose only delivery targets an unnamed seat's surface fails DELIVERED_WRONG_TARGET; a line naming no mapped seat passes on any delivery at that second; a seat name followed by a comma or a parenthesis is still recognised.
   - Reopen: `cargo test --locked --test board_check`.
   - Fail-without mutant: compare with the first named seat only; the three-seat case must go red.
3. coverage-note: a line naming two mapped seats with a valid stamp for one exits 0, prints exactly one `note:` line with SEAT_NOT_COVERED and the other seat, and the summary counts one note; a fully covered line prints none.
   - Reopen: `cargo test --locked --test board_check`.
   - Fail-without mutant: turn the note into a finding; the exit-0 assertion must go red.
4. field-read: on the consumer's real board and proof log (private copies, read only), every finding the check reports is true against the raw line and raw records, and the three lines the verifier named as false findings (two late same-day stamps, the multi-seat lines) now pass.
   - Reopen: `board check` on the verifier's own scratch copies, with a fresh seat map.
   - Fail-without mutant: n/a (field read).
5. no-regression: every existing test of the crate, format and lint stay green; `pnpm run audit:public` and `charter check --strict` are green; PR CI is green (charter job red only as NOT CHECKED) before acceptance.
   - Reopen: the gates below; `gh pr checks`.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands, in crates/odin-say unless noted):
- cargo fmt --check
- cargo clippy --locked --all-targets -- -D warnings
- cargo test --locked
- pnpm run audit:public   (repository root)
- charter check --strict   (repository root, pin ef2b92e)
Out of scope (recorded obligations, not fixed here):
- The sender labels a failed transport send as INPUT_BAR_ONLY and discards the multiplexer's error text (found the same day by the developer seat's read-only study); it needs its own slice and an authority to open one.
- A version id for the board line format.
- Requiring one stamp per dispatched seat (the verifier's recommendation): the line format does not say which named seats were dispatched to, so this slice only notes uncovered seats.
Owner decision points:
- none.
