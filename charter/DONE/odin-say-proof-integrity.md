# Done list — odin-say-proof-integrity (odin-say slice 3; written BEFORE dispatch; does not grow during it)
Base bytes: 1851746 (feat/odin-say-mid-turn, slice 2, in QA; built on slice 1 27d065d, QA PASS)
Problem: QA of slice 1 (PASS, three findings) showed: F1 (medium) when the proof log cannot be created or written, the message is still sent and the process exits 0 with only a stderr warning, so a delivery with no record looks like a recorded delivery; F2 (low) a record and its newline are written by two syscalls, so concurrent senders sharing one log can interleave; F3 (info) `waited_ms` sums only the poll sleeps and leaves out screen-read time.
Design (fixed for this slice):
- Preflight: before reading or sending to any pane, resolve the proof log path and prove it writable (create parent directories, open for append, write nothing). If that fails, exit non-zero with a typed message (`PROOF_LOG_UNWRITABLE`, a new dedicated exit code) and send nothing.
- If the record write fails after a send (disk full, revoked permission), exit non-zero with a different dedicated exit code (`PROOF_RECORD_LOST`) and print the full record JSON on stderr so the evidence is not lost; never exit 0 for a send whose record was not written.
- One write per record: serialize the record plus its trailing newline into one buffer and write it with a single `write_all` on an O_APPEND handle.
- `waited_ms` is the monotonic wall time from the first busy observation to the send or refusal decision (screen reads included); keep the poll count.
Write scope: crates/odin-say/** only. Nothing else.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. no-record-no-send: with an unwritable proof path (read-only directory, or a path whose parent is a file), the stub cmux receives no send, the exit code is the new PROOF_LOG_UNWRITABLE code, and stderr names the path.
   - Reopen: `cd crates/odin-say && cargo test --locked` from a clean clone of the frozen tip.
   - Fail-without mutant: skip the preflight; the stub must record a send and the test must go red.
2. lost-record-is-loud: a write failure injected after the send exits with PROOF_RECORD_LOST (never 0) and prints the record JSON on stderr.
   - Reopen: same cargo test.
   - Fail-without mutant: map the post-send write error to exit 0; the test must go red.
3. single-write-records: records are written with one write per line; a test running two or more senders (threads or processes) appending N records each to one log yields exactly the expected number of lines, each valid JSON.
   - Reopen: same cargo test.
   - Fail-without mutant: split the write back into record then newline; the concurrency test must go red within its iterations (record how many).
4. waited-ms-is-wall-time: with the stub clock, a wait whose screen reads take time reports waited_ms equal to the monotonic elapsed time (within one poll), not just the sleeps.
   - Reopen: same cargo test.
   - Fail-without mutant: count only sleeps again; the test must go red.
5. no-regression: all slice 1 and slice 2 tests still pass; exit codes are documented in crates/odin-say/README.md; fmt, clippy -D warnings, tests green; CI odin-say job green on the PR.
   - Reopen: the gates below; `gh pr checks` on the PR.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands):
- cd crates/odin-say && cargo +1.88.0 fmt --check && cargo +1.88.0 clippy --locked --all-targets -- -D warnings && cargo +1.88.0 test --locked   (own CARGO_TARGET_DIR outside the repo, under nice)
- pnpm run audit:public
- charter check
Out of scope (recorded obligations, not fixed here):
- Cross-language validation of odin-say records by odin.validate_cmux_delivery_proof.
- A proof-log rotation or retention policy.
Owner decision points:
- none.
