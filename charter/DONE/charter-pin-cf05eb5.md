# Done list — charter-pin-cf05eb5 (written BEFORE dispatch; does not grow during it)
Base bytes: 8254ff0 (main)

## Problem
PM-CHARTER announced fleet pin cf05eb5c9a1f1768d7aed8edee087e992bd9ad16 on 2026-11-04. It supersedes b9323cd1 and carries the R12 rule that a receipt naming an unknown model family is refused.

Steps asked:
1. Re-install the hooks with the new binary.
2. At the next CI change, set CHARTER_REV and the STATE pin, and adopt CI template v3.
3. Use model ids in new receipts.

Template v3 (slice ci-honest-1) makes the pattern-C charter job FAIL as "charter NOT CHECKED" while the charter source is unreachable from hosted runners. Under v2 the job printed "charter not run" and passed, so its green checked nothing (PM-CHARTER, 2026-11-04, run 41767403433).

Under `check --strict`, odin is byte-identical with the new binary (verified before dispatch).

## Design (fixed for this slice)
- **Hooks:** re-installed before dispatch with `<cf05eb5 binary> hooks install --force`. odin's own pre-commit hook stays chained first, with backup sha256 b4569210 unchanged, and core.hooksPath stays unset.
- **.github/workflows/ci.yml:** the charter job is replaced byte for byte by templates/ci/charter-job-pattern-C.yml at charter cf05eb5 (template v3, sha256 f4cb1ef9…), with only CHARTER_REV set to the full pin. No other job changes.
- **CONTRIBUTING.md:** the landing text that says "CI green" now says every job other than the charter job is green, and the charter job may be red ONLY as "charter NOT CHECKED". The job is not required, and its red marks a check that did not run; it does not block. Nothing else changes.
- **STATE (PM-ODIN at acceptance):** the pin line, the hooks note, the CS-7 note (v3 adopted, the job is red while the source is unreachable, local strict checks enforce), the last-green line, and the model-id rule for receipts.
- **Receipts from this slice on:** `models.author` and `models.verifier` carry model ids (for example `claude-opus-5-5`, `xiaomi/mimo-v2.6-flash`).

## Write scope
- .github/workflows/ci.yml (the charter job only)
- CONTRIBUTING.md (the CI-green wording only)

PM-ODIN writes STATE at acceptance.

## Proofs
For each proof: what it guarantees, how to reopen it, and its fail-without mutant.

1. **pin-everywhere.** The cf05eb5 binary prints its full sha. CHARTER_REV in ci.yml is the full pin. `git grep -n b9323cd1 -- .github CONTRIBUTING.md` finds nothing.
   - Reopen: `<binary> --version`; `git grep -n -E 'CHARTER_REV: [0-9a-f]{40}' .github/workflows/ci.yml`; the grep above (expect exit 1).
   - Fail-without mutant: leave CHARTER_REV at b9323cd1; the grep matches.
2. **job-is-v3.** Extract the charter job from ci.yml and set CHARTER_REV back to the template's placeholder line. The result is byte-identical to the template at charter cf05eb5 (sha256 f4cb1ef959b0f928124b084eaac994b5a6d938e6e78e1b23c29b45c887b31323).
   - Reopen: extract the job, substitute the placeholder, `shasum -a 256`; `git -C <charter clone> show cf05eb5:templates/ci/charter-job-pattern-C.yml | shasum -a 256`.
   - Fail-without mutant: change one byte of the job in a scratch copy; the hash differs.
3. **honest-red.** On the PR, the charter job FAILS with the "charter NOT CHECKED" annotation and step summary, and validate, odin-say and telemetry-validate pass.
   - Reopen: `gh pr checks <pr>`, plus the job log (`gh run view <run> --log`, looking for "charter NOT CHECKED").
   - Fail-without mutant: n/a (CI observation). The contrast is main's run 41767403433 under v2, which was green with "charter not run".
4. **hooks-chained.** The backup sha256 is still b4569210…, core.hooksPath is unset, and pre-commit and pre-push are cf05eb5 shims. A commit on the branch shows the own hook's output, then charter's.
   - Reopen: the sha comparison; `grep -o 'bin/[0-9a-f]{40}'` on both hooks; the commit log.
   - Fail-without mutant: n/a (state read).
5. **no-regression.** `charter check --strict` (cf05eb5), `pnpm run audit:public` and `pnpm vitest run tests/audit --testTimeout=30000` (including actions-pinned) pass. Every job except charter passes on PR CI.
   - Reopen: the same commands, each run bare so its own exit status is read.
   - Fail-without mutant: n/a (aggregate).

## Gates (exact commands)
- charter check --strict (charter cf05eb5, $HOME/.local/share/charter/bin/cf05eb5c9a1f1768d7aed8edee087e992bd9ad16/bin/charter)
- pnpm run audit:public
- pnpm vitest run tests/audit --testTimeout=30000

## Out of scope
- Charter TODO 94's later steps (verifier model recorded at dispatch, harness-log evidence, signed receipts): adopted with the pins that ship them.
- Making the charter job required, or reaching the private charter source (owner decision CS-7).

## Owner decision points
- none.
