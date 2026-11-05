# Done list — close-remediation-1 (written BEFORE dispatch; does not grow during it)
Base bytes: 4745bb2 (main)

## Problem
Owner directive (2026-11-05, orchestrated by PM-MISTER-CLEAN): run Mister Clean CLOSE on odin until it is CLEAN by Mister Clean 7.5.1's own criteria, then pin a new odin version on that exact revision.

The P1 judge run on a fresh clone of 4745bb2 (prepare, mode CLOSE) found 17 real debts:
- **(A)** The native gate `cargo test --all-targets` fails in crates/odin-say. tests/cli.rs expects the example binary at target/debug/examples/fake_cmux, which only plain `cargo test` produces.
- **(B1)** Semantic candidate SEM-ENVIRONMENT-C988A215311C. plugins/odin-scp/skills/odin-scp/scripts/sync-installations.sh uses globs without declaring their semantics when nothing matches (no `nullglob` or `failglob`). This is the same script whose dry-run once hung for 28 hours.
- **(B2)** Semantic candidate SEM-EXECUTABLE-CBB67799E249 (executable-surface coverage). It is handled by the signed attestation route AFTER this slice merges, because the plan binds the revision; it is out of scope here.
- **(C)** 15 public-safety findings, all under tests/:
  - tests/audit/secret-rule.test.ts: 6 credential-assignment;
  - tests/telemetry/redactor.test.ts: 3 email;
  - tests/telemetry/submit.test.ts: email, file-url and home path;
  - tests/protocol/release-sync.test.ts: 2 home paths;
  - tests/protocol/role-card-coverage.test.ts: 1 home path.

The same merge also carries the Charter fleet pin v0.1.0 (ef2b92e) in CI, the local-merge landing rule, and the version 0.9.1 that will be pinned.

## Design (fixed for this slice)
- **(A)** fake_cmux becomes TEST-ONLY support that resolves under every cargo target selection, including `cargo test --all-targets` from a fresh clone. It must never be installed or published. Either a bin behind a test-only feature or a tests/support crate is acceptable, provided `cargo install` / `cargo package` ship only `odin-say`. tests/cli.rs keeps all of its assertions.
- **(B1)** sync-installations.sh declares the glob semantics it actually wants (`shopt -s nullglob`, or `failglob` where an empty match is an error) and handles the empty case explicitly. No behaviour change when files match. The existing tests (60) keep passing on bash 5 and bash 3.2.
- **(C)**
  - Shape-only fixtures (role-card-coverage, release-sync, submit) use plain values that no detector matches, such as relative paths or `fixture` identities.
  - The two detector suites (secret-rule, redactor) build their synthetic positive samples at RUNTIME, with a one-line comment: "synthetic sample built at runtime so tracked bytes carry no detector-shaped literal; value is not real". This follows mister-clean's own scanner tests (src/closeout/inspection.test.ts:102). Every assertion is kept, and the detector must still fire on the runtime value.
  - No exemption records; no encoding of real identifiers.
- **Charter pin v0.1.0:** .github/workflows/ci.yml CHARTER_REV becomes ef2b92e911540155af27759ffadb2d9d3a04fd2a. The job otherwise stays template v3 byte for byte (sha256 f4cb1ef9…, unchanged at ef2b92e).
- **Landing rule:** CONTRIBUTING.md's landing steps say to merge LOCALLY with `git merge --no-ff` under a no-reply identity and push through the gate, never with the GitHub merge button, `gh pr merge` or the REST merge API. GitHub stamps the merge revision with the owner's personal email. Before any push, `git log --format='%ae %ce' origin/main..HEAD` must show only no-reply addresses.
- **Version 0.9.1:** a version sync 0.9.0 → 0.9.1 across every public version surface, following the 0.9.0 release (#38), with a dated 0.9.1 changelog entry naming this remediation. The govdisp baseline is regenerated with its generator only.
- **STATE (PM-ODIN at acceptance):**
  - the pin line (ef2b92e);
  - the hooks note (no own hook chained since the planning gate was removed);
  - the planning-gate decision resolved;
  - the local-merge rule;
  - the 0.9.0 status (tagged and validated, not published);
  - the field-run candidate.

## Write scope
- crates/odin-say/ (Cargo.toml, tests/, examples/ or a new test-support location; no src/ behaviour change)
- plugins/odin-scp/skills/odin-scp/scripts/sync-installations.sh
- tests/audit/secret-rule.test.ts, tests/telemetry/redactor.test.ts, tests/telemetry/submit.test.ts, tests/protocol/release-sync.test.ts, tests/protocol/role-card-coverage.test.ts
- .github/workflows/ci.yml (CHARTER_REV only)
- CONTRIBUTING.md (landing steps only)
- the 0.9.1 version surfaces and the changelog (as in the 0.9.0 release), plus the govdisp baseline (generator only)

PM-ODIN writes STATE at acceptance.

## Proofs
For each proof: what it guarantees, how to reopen it, and its fail-without mutant.

1. **fake-cmux-any-target.** In crates/odin-say, from a fresh clone, `cargo test --all-targets --locked` and `cargo test --locked` both pass. `cargo package --list --allow-dirty` (or the crate's built bins) shows no fake cmux binary shipped.
   - Reopen: the three commands, each run bare.
   - Fail-without mutant: point the support lookup back at target/debug/examples; `--all-targets` fails with "fake_cmux is missing".
2. **glob-semantics.** sync-installations.sh declares nullglob or failglob and handles an empty match. `node $MISTER_CLEAN_ROOT/bin/mister-clean.js audit semantic <fresh clone> --json` no longer lists SEM-ENVIRONMENT-C988A215311C, and no new environment candidate appears. shellcheck is clean, and tests/scripts/sync-installations.test.ts passes.
   - Reopen: the audit, shellcheck and the test file.
   - Fail-without mutant: remove the shopt line; the candidate reappears.
3. **public-safety-zero.** `audit public-safety <fresh clone> --tracked --json` reports 0 findings. tests/audit/secret-rule.test.ts and tests/telemetry/redactor.test.ts pass, and the field run's owner-PII grep finds nothing. Its pattern names the owner's private identifiers, so it is kept outside this public repository, in the field-run brief, and is never quoted here.
   - Reopen: the audit, the two suites and the grep.
   - Fail-without mutant: break the detector in a scratch copy (make the secret rule or the email redaction never match); both suites go RED on the runtime samples.
4. **version-0.9.1.** Every public version surface reads 0.9.1, the release-sync tests pass, the 0.9.1 changelog entry exists, and the packed tarball answers an MCP initialize with serverInfo 0.9.1.
   - Reopen: the 0.9.0 release's proof-1 grep (for 0.9.0), release-sync, and the pack smoke.
   - Fail-without mutant: leave protocol/roles.yaml at 0.9.0; test:package fails, naming it.
5. **charter-pin.** CHARTER_REV is ef2b92e, the job with its placeholder restored still hashes to f4cb1ef9…, and `<ef2b92e binary> check --strict` passes.
   - Reopen: the hash recipe from charter-pin-cf05eb5.
   - Fail-without mutant: a one-byte job change; the hash differs.
6. **no-pii-identity.** The branch's revisions show only no-reply author and committer addresses (`git log --format='%ae %ce' origin/main..HEAD`), and CONTRIBUTING.md states the local-merge rule.
   - Reopen: the log command; read the CONTRIBUTING lines.
   - Fail-without mutant: n/a (identity read).
7. **no-regression.** `pnpm run validate` passes. The known load-only teardown flake in sync-installations is handled as already ruled: re-run that file alone and rely on hosted CI. PR CI passes on every job except the charter job, which is red only as "charter NOT CHECKED".
   - Reopen: the same commands, each run bare.
   - Fail-without mutant: n/a (aggregate).

## Gates (exact commands)
- pnpm run validate
- cargo test --all-targets --locked (crates/odin-say)
- node $MISTER_CLEAN_ROOT/bin/mister-clean.js audit public-safety <fresh clone> --tracked --json
- node $MISTER_CLEAN_ROOT/bin/mister-clean.js audit semantic <fresh clone> --json
- charter check --strict (charter ef2b92e, $HOME/.local/share/charter/bin/ef2b92e911540155af27759ffadb2d9d3a04fd2a/bin/charter)

## Out of scope
- B2, the signed semantic attestation for SEM-EXECUTABLE (after the merge, on the candidate revision).
- The 0.9.0 / 0.9.1 npm publish (one owner OTP, after CLEAN).
- Any rewrite of history.

## Owner decision points
- none (owner directive 2026-11-05; the publish OTP comes after CLEAN).
