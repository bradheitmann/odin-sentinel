# Done list — odin-say (slice 1 of the team-tooling ingest; written BEFORE dispatch; does not grow during it)
Base bytes: bdc6aab (fix/advisories-2026-10-31, on top of the accepted charter)
Problem: ODIN validates CMUX delivery proofs but ships no sender. A field team wrote one (reveng-ops `say`, Rust): read the pane, refuse busy or blocked panes, send one line, press Enter, read back, write a proof record. Field defects to fix on ingest: (a) the busy pattern "Thinking" matches anywhere in the last 14 screen lines, so leftover scrollback in an idle OpenCode pane reads as busy (false PANE_STILL_THINKING); (b) a busy pane is refused instantly, so two agents that both reply through the sender can keep each other busy indefinitely (observed 2026-10-31: 1,485 of 2,451 field proof lines were such refusals, and a live DEV/PM pair stalled the same way); (c) paths to one team's directories are hard-coded.
Design (fixed for this slice):
- A Rust crate `odin-say` at crates/odin-say/ (edition 2021, pinned toolchain, Cargo.lock committed) with one binary `odin-say`. Ingest ONLY the sender: cmux seam (trait + real + stub), screen classification, say flow, proof record writer, the fake-cmux test double. Do not ingest inbox/status/forward/control/finish-line/watch-content/paths.
- Pane rules as data: crates/odin-say/pane-rules.json (from the export's pane-rules.json), embedded at build time; an optional `--pane-rules <file>` / ODIN_SAY_PANE_RULES override.
- Busy detection counts only live status regions: a busy pattern matches only on a line that also carries a spinner glyph or a harness status marker, or on the last 3 non-empty lines; plain scrollback text never makes a pane busy.
- Bounded wait: when the pane is busy, re-read every `--poll-secs` (default 5) up to `--wait-secs` (default 180); send as soon as it is idle; refuse with PANE_STILL_THINKING only after the budget, recording waited_ms and polls. Blocked-on-permission still refuses at once.
- Proof records (JSONL): every record carries record_kind ("delivery" for a send, "send_refusal" for a refusal) plus the existing fields target_surface_locator, submitted, verification_method, observed_processing_state, timestamp, sender_role. Proof log path from `--proof <file>` or ODIN_SAY_PROOF, else $XDG_STATE_HOME/odin/delivery-proof.jsonl (fallback $HOME/.local/state/odin/...). Sender role from `--sender-role` or ODIN_SAY_SENDER_ROLE, default "EXEC PM". cmux binary from ODIN_SAY_CMUX, default `cmux` on PATH.
- No private paths, machine names or team names in any committed file; a provenance note (crates/odin-say/PROVENANCE.md) names the source as "a field team's reveng-ops crate, export of 2026-10-31" with its MANIFEST sha256 for say.rs, proof.rs and cmux.rs, without home paths.
- CI: one new job in .github/workflows/ci.yml running cargo fmt --check, clippy -D warnings and cargo test --locked for crates/odin-say.
Write scope: crates/odin-say/** (new), .github/workflows/ci.yml (the new job only), .gitignore (crates/odin-say/target only if needed). Nothing else.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. screens-classify: every one of the export's 11 screen fixtures classifies exactly as in the export's say_screens tests (ported), and a new synthesized fixture crates/odin-say/tests/fixtures/screens/opencode_thinking_scrollback.txt (an idle OpenCode pane whose scrollback contains a "Thinking:" line above an idle prompt) classifies idle.
   - Reopen: `cd crates/odin-say && cargo test --locked` from a clean clone of the frozen tip.
   - Fail-without mutant: restore "match busy patterns anywhere in the last 14 lines"; the new fixture test must go red.
   - reopened: OD-QA-odin-say-27d065d 9ab29f69883bc78368301f1b9e4e2c749dc6fedcc1f14ab368f94d2b30af243e
2. bounded-wait: with the stub cmux, a pane busy for 2 polls then idle is delivered (DELIVERED_*, record_kind delivery, polls=3); a pane busy past --wait-secs is refused as PANE_STILL_THINKING with record_kind send_refusal, submitted=false, waited_ms >= the budget; a blocked pane refuses at once (polls=1).
   - Reopen: same cargo test command.
   - Fail-without mutant: set the wait budget to 0 internally; the busy-then-idle test must go red.
   - reopened: OD-QA-odin-say-27d065d 9ab29f69883bc78368301f1b9e4e2c749dc6fedcc1f14ab368f94d2b30af243e
3. proof-records: each written JSONL record parses, carries record_kind and the six legacy fields with the right types, and the log path / sender role / cmux binary come from flag, then env, then the cloud-friendly default (tested with temp dirs and env overrides; no home path baked in).
   - Reopen: same cargo test command.
   - Fail-without mutant: drop record_kind from refusal records; the proof-record test must go red.
   - reopened: OD-QA-odin-say-27d065d 9ab29f69883bc78368301f1b9e4e2c749dc6fedcc1f14ab368f94d2b30af243e
4. end-to-end-fake: the real `odin-say` binary against the fake cmux executable (examples/fake_cmux.rs ported) delivers to an idle pane (exit 0) and refuses a blocked pane (non-zero exit), writing one proof record each.
   - Reopen: same cargo test command (tests/cli.rs).
   - Fail-without mutant: make the binary exit 0 on refusal; the CLI test must go red.
   - reopened: OD-QA-odin-say-27d065d 9ab29f69883bc78368301f1b9e4e2c749dc6fedcc1f14ab368f94d2b30af243e
5. public-clean-and-ci: `grep -rniE '/User[s]/|bradheitman[n]|superpower[s]|open_protoco[l]s|reveng' crates/odin-say` finds nothing except the PROVENANCE.md source name line; `pnpm run audit:public` PASS; the new CI job passes on the PR.
   - Reopen: run the grep and `gh pr checks` on the PR carrying the tip.
   - Fail-without mutant: plant a home path in crates/odin-say/README.md; the grep must catch it.
   - reopened: OD-QA-odin-say-27d065d 9ab29f69883bc78368301f1b9e4e2c749dc6fedcc1f14ab368f94d2b30af243e
Gates (exact commands):
- cd crates/odin-say && cargo +<pinned> fmt --check && cargo +<pinned> clippy --locked --all-targets -- -D warnings && cargo +<pinned> test --locked   (use a CARGO_TARGET_DIR outside the repo; run under nice)
- pnpm run audit:public
- pnpm run typecheck
- charter/slice-zero.sh
- charter check
Out of scope (recorded obligations, not fixed here):
- Validating odin-say's records with odin.validate_cmux_delivery_proof in a cross-language test (needs delivery-verdicts on main; next slice).
- A file-inbox reply path so agents never type into each other's panes; pull queue, nudge, roster, landing guard, finish-line board (later slices or other repos).
- Shipping the binary in the npm package or as a release asset.
Owner decision points:
- none (owner approved the Rust sidecar sender, pane rules as data and the bounded wait on 2026-10-31).
