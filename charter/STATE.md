# State — odin-sentinel — 2026-10-31T09:00Z, written by PM-ODIN (Claude Opus 5.5)
HEAD: main c6bb48f (odin-say slice 3 landed, PR #15) + this landing (chore/public-roots-crates, carrying its own STATE rewrite).
Proven (with the proof names):
- slice-zero ACCEPTED (DONE pin b087121d). QA: OD/QA, Pi, openrouter/xiaomi/mimo-v2.6-flash, high (author Claude Opus 5.5). Markdown receipt sha256 09bf1d87352c61bdcaebe7d0c5015a5a8235faecbc52cd56b0811b0fd11f5134; validated JSON receipt (reveng.qa-receipt/1) sha256 f883af011ca4dc11905f971d072bcd6a3c305c6d4ace0c06916ce8be53a0b001; accepted with `charter gate slice-zero --accept --receipt` at DONE pin 486916b1, frozen 8533d25 (manifest 2c216de2).
  - slice-zero-live (G1): `charter/slice-zero.sh` prints `delivered_valid=true refused_valid=false` and `slice-zero: GREEN`; mutant prints `refused_valid=true` and exits 1. Reopened by QA in a fresh clone.
  - contract-green: `charter check` prints `charter: ok`; blank-INTENT mutant refused. Reopened by QA.
  - public-surface-clean (G3): `pnpm run audit:public` PASS; home-path mutant fails. Reopened by QA.
- advisories-2026-10-31 ACCEPTED (DONE pin 9b9a9584). QA: same seat, different family from the author (Claude Opus 5.5). Markdown receipt sha256 ddf0398089dbad1c068c8c797b5d9c99dde22c571bdd797462d833fe1888e6e6; validated JSON receipt sha256 0d81a4499eca8c3efd4e3b98cb2e47f0a037078afe85828ddec1b9fe93775512; accepted with `--receipt` at DONE pin 3bd34d31, frozen 8533d25.
  - advisories-cleared: `pnpm run audit:deps` PASS, 0 unaccepted at or above high; zod 4.6.7, body-parser 2.4.0. Mutant (base dependency files) fails naming GHSA-mrhx-c7xc-m3w5 and GHSA-27r3-jxmh-p828. Reopened by QA.
  - exception-record-valid: pin-drift mutant (^2.3.0) refused. Reopened by QA.
  - ci-green: PR #6 validate and telemetry-validate pass on bdc6aab.
  - QA traced the stdio runtime: it never loads express or body-parser.
- delivery-verdicts ACCEPTED (DONE pin 9fae6131), landed on main 27d9193 (PR #9). QA FAIL on b005650 (F1 high: an invalid registry result reported `delivered`), repair 1 of 1, QA PASS on b6d435e (32-case sweep, 5 mutants red). Markdown receipt sha256 91723abb9e93599c455192169da475a38169f8800b1f6ca9e1faa2a782d9bb6f; validated JSON receipt sha256 2851ec179226b75eed32f45ad7fe1b8fb097c3be625494a4bbdc513354f91e6e; frozen f3cb5ba (manifest 48e335b1).
- registry-lock-budget ACCEPTED (DONE pin ebb4a9fd), landed on main 4814075 (PR #10). Contention test 20/20; the old default fails within 20 runs. QA PASS on 1d2b721. Markdown receipt sha256 b50e560f668cefd1acf696fc485e79d84acc2a05e72404d14e214481373254d1; validated JSON receipt sha256 c225c4de4e822a1257e6dd1a077932d49f816b461237467095cbd81af799382f; frozen b66af6d (manifest 2dff64f0).
- public-roots-charter ACCEPTED (DONE pin 3a83d803). charter/ is now inside the public-surface audit (99 files checked: 81 + 18 charter files); planted home path and dropped root both go red. QA PASS on caee0fb. Markdown receipt sha256 c0fad2c67c840324a583f5ac3b1fbd2c09ec31581d4b1e5eecd344924e5c3206; validated JSON receipt sha256 2117577fcd7820ec8b417f941ee05d8c921274104ae203a5e95a17602918ebb2; frozen 00202bc (manifest 4c5d635a).
- odin-say slice 1 ACCEPTED (DONE pin fed42423, after a wording fix: the fallback path is written $HOME-relative so the charter/ audit passes): Rust sender sidecar crates/odin-say (read pane, bounded wait for busy panes, one line + Enter + read-back, typed proof records with record_kind; busy detection ignores scrollback). QA PASS on 27d065d (5 proofs, 5 mutants red, PR #7 CI green, provenance verified). Markdown receipt sha256 9ab29f69883bc78368301f1b9e4e2c749dc6fedcc1f14ab368f94d2b30af243e; validated JSON receipt sha256 2534d28cdb0c208f3f263b4a7e54da4801f4829e8d0606070c3b4234d5ff6518; frozen 4ead1e4 (manifest fb10d754). Not shipped in the npm package; with slice 3 landed it is usable by seats.
- ci-action-pins ACCEPTED (DONE pin ce62fdc4), closing standard gap CS-4: every `uses:` in .github/workflows is pinned to a full sha (checked against the v6 tags) and guarded by tests/audit/actions-pinned.test.ts. QA PASS on ab28b7d. Markdown receipt sha256 9d88935195c86cc88b0252ff74f748f3f8f4fd1f18bf9274ffa3b58ad3de19ba; validated JSON receipt sha256 572834ccbe0a7164298fbc1bc58aba527d175bba60714db65171be5e95003ec3; frozen 9367029 (manifest 4def40db). QA note (info): the guard test also pins the list of workflow files, so a new workflow must be added to it deliberately.
- odin-say slice 2 ACCEPTED (DONE pin ea2c396b): per-harness mid-turn policy in pane-rules.json. Pi queues text typed mid-turn as a steer; a queued send counts only when the read-back shows the sent text on a "Steering:" line with Pi's queued-messages hint (real captures from a live Pi pane, placeholders for private paths); Claude Code, Codex, OpenCode and unknown harnesses keep the bounded wait and refuse until a capture proves they buffer. Records carry harness, harness_source and queued. QA PASS on 1851746 with zero defects. Markdown receipt sha256 27d7d1e69523e170849c0febab8779f6a176643edcf690cb1f0b0203ea808cf8; validated JSON receipt sha256 29b6457cda756da707957f2fb809bffd527695a20ebc57433c2af1426acbad7f; frozen 5e97fcc (manifest 84825347).
- ci-action-pins post-acceptance addition: its guard test caught the slice-1 CI job's movable `dtolnay/rust-toolchain@1.88.0` ref on main; pinned to a full sha by PM ruling and verified by QA (delta 93c1865) before PR #13 merged.
- odin-say slice 3 ACCEPTED (DONE pin f2614794): proof integrity. The sender proves the proof log writable before touching any pane and exits 8 (PROOF_LOG_UNWRITABLE) without sending if it is not; a record lost after a send exits 9 (PROOF_RECORD_LOST) and prints the record on stderr, never exit 0; each record is one write; waited_ms is monotonic wall time. Closes slice 1's QA findings F1 (medium), F2 (low), F3 (info), confirmed by the QA seat that raised them. QA PASS on e0c32b9. Markdown receipt sha256 70971841c9f7d966a5eb87a4a6104c132828e1360e8a41233d3593b77f9250c5; validated JSON receipt sha256 7de43566af0c7dcdbd1e23e77353b6d4ce8016470f85f8dedd5bd0bef521f05b; frozen d44faca (manifest bcde3486).
- public-roots-crates ACCEPTED (DONE pin 8fdf7a72), closing standard gap CS-2 part 1: crates/ is inside the public-surface audit (35 more files checked); two tilde home paths and two Linux home-path test strings in crates/odin-say were reworded (test inputs only, no behaviour change; QA ruled the test-data edit within intent and proved it necessary). QA PASS on 08f1973. Markdown receipt sha256 510be747318e3a3c0147f5a9e3dc7463fb33f724f2274ec97fa3dfbbd006404a; validated JSON receipt sha256 767cde68ea7b6b4cde68da1b6b9a5a38f5d660d037330c33041863a75223f551; frozen 7fc8a5a (manifest fa467ce9).
Reopen markers: every accepted DONE list carries `reopened:` markers added by the Charter-sanctioned interim route (markers, re-pin, clean-clone freeze, QA re-issued JSON receipt, `gate --accept --receipt`). Receipts are kept with the team receipts outside this public repository because they cite local paths; their hashes are recorded here.
Not proven / known gaps:
- INTENT.md awaits owner ratification; GUARANTEES rows are `proposed`.
- fix/sync-mcp-pins: merges clean onto 0.8.0 (merged candidate 8ad4898), never QA'd; queued.
- Registry lock follow-up (QA F2, low): the lock wait is synchronous, so a program that injects ODIN's registry store into the MCP server can block its event loop for up to the 10 s budget. The default MCP binary injects no store (its append tool fails closed), so this affects embedders only; an asynchronous backoff or a shorter interactive budget is a later slice.
Common engineering standard v0.2 (linked from AGENTS.md): gaps recorded as obligations, each a future bounded slice:
- CS-1 (§1) Private paths: research notes, receipts and briefs live under a team directory, not `AGENT_PRIVATE_ROOT/<repo>/{evidence,handoffs,...}`; odin-say defaults its proof log to the XDG state directory. Move to the standard root with an override.
- CS-2 (§1) Public-safety check: part 1 CLOSED (crates/ audited by public-roots-crates); tests/ stays excluded by design (fixtures plant forbidden strings on purpose; QA agreed). Part 2 open: no secret scan of the diff before push.
- CS-3 (§3) Existing JavaScript: 9 tracked .mjs/.js files (audit and protocol scripts) and inline `node -e` in the `clean` and `build` package scripts. Not expanded; porting to strict TypeScript is an obligation.
- CS-4 (§5) GitHub Actions pinned to immutable references: CLOSED by ci-action-pins.
- CS-5 (§6) Each verification run uses its own build output directory: now required in every QA and DEV brief; not yet enforced by a check.
- CS-6 (§6) No repository-wide lease for heavy suites; contention shows up as timeouts.
- CS-7 (§7) `charter check` in CI: BLOCKED, typed reason "charter tool is private; owner decision pending" (a public repository's CI cannot fetch the pinned tool without a credential, and release assets inherit the private visibility). Local `charter check` runs at the current pin.
- CS-8 (§7) Plans and work contracts: the local planning corpus uses its own slice format, not the shared v5 work-contract schema; record the schema pin and list validation as open until a packaged validator release exists.
- CS-9 (§4) Two state surfaces exist: charter/STATE.md (designated here) and a hook-generated local planning status file; the latter must point to STATE.md rather than compete.
- charter check --strict refuses DONE/_template.md at the earlier pin (upstream defect).
Exact last-green command(s):
- charter/slice-zero.sh
- charter check (charter 6f14c0a)
- pnpm run audit:deps
- pnpm run audit:public
- pnpm run typecheck
- charter gate registry-lock-budget --accept --receipt
Exact last-red command(s) and why:
- charter check on this checkout before this rewrite: "STATE.md was not rewritten after slice delivery-verdicts / registry-lock-budget was recorded accepted" (STATE lagged two landings).
Next three bounded items (in order):
1. QA: public-roots-charter receipt update, then odin-say slice 1, odin-say slice 2, ci-action-pins, fix/sync-mcp-pins; land each on a validated JSON receipt and rewrite this file after each landing.
2. Multi-repo swarm study (owner directive 2026-10-31): queued-delivery board trial (E3) once odin-say lands; re-measure at +24 h.
3. Common-standard gap CS-2 (crates/ and tests/ into the public-safety scan) once public-roots-charter lands.
Open owner decisions:
- Ratify charter/INTENT.md.
- How a public repository obtains the charter tool for CI (CS-7): make the charter repository public, host binaries elsewhere, or a per-repository read token (with EXEC-PM).
- The separate Codex worktree on fix/registry-cli-store-20261020.
Where everything is (branches, lanes, receipts):
- Lanes, each in its own worktree outside this checkout: chore/public-roots-charter, feat/odin-say, feat/odin-say-mid-turn, chore/ci-action-pins, fix/sync-mcp-pins (+ integrate/sync-mcp-pins).
- Landed and archived (tag `archive/<branch>`): chore/charter-adoption, fix/advisories-2026-10-31, docs/common-standard-adoption, feat/delivery-verdicts, fix/registry-lock-budget, feat/capability-seams-20261019, fix/security-review-20261019.
- PM ruling: the govdisp baseline manifest re-pin is in scope for lanes that change protocol/ or src/protocol/ (generator only, own rows only).
