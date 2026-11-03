# Done list — retire-legacy-planning (written BEFORE dispatch; does not grow during it)
Base bytes: 3a6c306 (main)

## Problem
On 2026-11-01, A/EXEC-PM ruled that odin's legacy local planning corpus is retired and superseded by charter/, with nothing deleted. That corpus is gitignored, local-only, and predates charter adoption on 2026-10-31.

Mister Clean could not record a ratified retirement until O-RET-1. Its fix (c5a85c9) shipped in v7.2.0, and v7.4.0 is installed now. The fix reads committed records under `charter/retirements/`.

The record must cite a ruling file committed in the repository, with a matching sha256. Until O-RET-2 (self-ratification) is enforced, two interim rules apply, per PM-MISTER-CLEAN:
- the ruling summary is committed BEFORE the record;
- a human or EXEC-PM reviews the record.

This closes the deferred SEAM-SYNC item mister-clean ↔ odin (b).

## Design (fixed for this slice)
- **Commit A: the ruling summary.** Add `charter/owner-decisions/2026-11-01-retire-legacy-planning.md`, a path-free public summary of EXEC-PM's ruling: who ruled, the date, the scope, the decision, and the effect (superseded by charter/, nothing deleted, nothing live carried forward). It cites the private ruling's sha256 (f298888d…) as prose only.
- **Commit B: the record.** In a LATER commit, add `charter/retirements/2026-11-01-legacy-planning.json`, with `record_type` "mister-clean.retirement" and `schema_version` "1.0":
  - `slug`: legacy-planning;
  - `roots`: `project/planning`, `.odin/dispatches`, `.odin/tmp`, `.odin/handoffs`, all repository-relative;
  - `ruling`: author A/EXEC-PM; `at` 2026-11-01 with a timezone; scope; evidence `{path: the commit-A file, sha256: its digest}`.
- **The fifth root is left out of the record.** The ruling also covers a fifth local root, under a hidden directory named for a private project. Odin's public-surface audit forbids that name in tracked files, so that root is excluded. The lane measures any debt that remains under it.
- **No other change.** The planning corpus itself is untouched.

## Write scope
- charter/owner-decisions/2026-11-01-retire-legacy-planning.md (new)
- charter/retirements/2026-11-01-legacy-planning.json (new)

PM-ODIN writes STATE at acceptance.

## Proofs
Each proof states what it guarantees, how to reopen it, and its fail-without mutant.

1. **ruling-before-record.** Commit A, adding the summary, is an ancestor of commit B, adding the record, and B adds no change to the summary.
   - Reopen: `git log --diff-filter=A --format=%h -- <summary>` and the same for `<record>`, then `git merge-base --is-ancestor A B`.
   - Fail-without mutant: n/a (history read).
2. **record-valid-at-7.4.0.** Mister Clean 7.4.0 reads the record with no refusal, and its evidence digest matches.
   - Reopen: run Mister Clean's census or prepare on a clean clone of the frozen tip, and confirm no `CensusInputRefused`.
   - Fail-without mutant: change one byte of the summary in a scratch copy. The record must be refused for a digest mismatch.
3. **census-effect.** Mister Clean prepare and bundle validation are re-run at 7.4.0 on the frozen tip. The evidence is kept outside the repository. Report:
   - the debt count under each retired root, before and after;
   - the 2026-11-01 closure bundle's 1,008 legacy findings, against what remains;
   - every remaining NOT CLEAN reason, including any debt under the excluded fifth root, each named.
   - Reopen: the same commands; the counts are recorded in the QA report.
   - Fail-without mutant: run without the record; the retired roots' debts must reappear.
4. **public-safe.** `pnpm run audit:public` passes. Neither file contains home paths, private project names, or secret-looking strings.
   - Reopen: the audit command.
   - Fail-without mutant: put a home path in the summary; the audit must fail.
5. **o-ret-2-review.** A/EXEC-PM reviews the record, as the interim O-RET-2 safeguard, before `gate --accept`. The review is recorded in STATE with its date.
   - Reopen: the WAVES line or message cited in STATE.
   - Fail-without mutant: n/a (process).
6. **no-regression.** `charter check --strict` (b9323cd1) passes, and PR CI is green before acceptance.
   - Reopen: the same commands.
   - Fail-without mutant: n/a.

## Gates (exact commands)
- pnpm run audit:public
- charter check --strict (charter b9323cd1, $HOME/.local/share/charter/bin/b9323cd119f2ef2fe83db21b8ed8f844215e8852/bin/charter)
- mister-clean 7.4.0, from the installed skill's bin/mister-clean.js: prepare, then validate bundle

## Out of scope (recorded obligations, not fixed here)
- The excluded fifth root: whether it needs an owner decision, either an audit allowance for its name or a separate retirement mechanism. Decide only if proof 3 finds debt under it.
- Any non-retirement NOT CLEAN reason that proof 3 reports.

## Owner decision points
- None in advance. If proof 3 finds debt under the excluded root, that is escalated to EXEC-PM.
