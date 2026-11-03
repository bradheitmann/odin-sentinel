# Done list — audit-retirement-roots (written BEFORE dispatch; does not grow during it)
Base bytes: 3a6c306 (main)

## Problem
Mister Clean 7.4.0 accepts a retirement record only with a `roots` list naming each retired directory. The record is `charter/retirements/<date>-<slug>.json`, and A/EXEC-PM's 2026-11-01 ruling retires the legacy local planning corpus.

The main retired directory is the legacy planning directory. odin's public-surface audit refuses its path anywhere in tracked public files: scripts/audit/public-surface.mjs:91, rule "private planning path". Two controls therefore conflict.

## Typed reason for loosening (EXEC-PM ruling, 2026-11-03, option A)
The name is already public: `.gitignore:21` lists it, and `.gitignore` is tracked and outside the audited roots. A narrow allowance therefore makes no new disclosure. The allowance only lets the one machine-read place that must name the directory, the retirement record's `roots`, say so. The control stays in force everywhere else.

## Design (fixed for this slice)
- In scripts/audit/public-surface.mjs, the "private planning path" rule gains one JSON-aware exemption.
- **What is exempt:** for a file matching `charter/retirements/*.json` that parses as a JSON object with `record_type` "mister-clean.retirement", every string in its top-level `roots` array is exempt from that rule only.
- **How the check runs:** remove those exact root strings from the text before testing the rule.
- **What still fails:**
  - the same string in any other field of that record, for example `ruling.scope`;
  - the same string in any other charter/ file;
  - the same string in a malformed or non-retirement JSON file under charter/retirements/;
  - any other rule (home paths, secrets, markers) applied to the same file.
- **No other rule or file changes.** In particular, "local evidence path" and the private-marker rule get no allowance.
- **New tests** in tests/audit/public-surface-retirement-roots.test.ts.
- **CS-3:** this edits the existing .mjs, and the new test is strict TypeScript.

## Write scope
- scripts/audit/public-surface.mjs (this rule's application only)
- tests/audit/public-surface-retirement-roots.test.ts (new)
- tests/fixtures/govdisp/baseline-manifest.json (generator only, if it rows the script)

## Proofs
For each proof: what it guarantees, how to reopen it, and the mutant that must turn it red.

1. **roots-only exemption.** A fixture retirement record whose `roots` contains the planning path passes the audit. The same record with the path also in `ruling.scope` fails, naming "private planning path".
   - Reopen: `pnpm vitest run tests/audit/public-surface-retirement-roots.test.ts --testTimeout=30000`.
   - Fail-without mutant (EXEC-PM M2): put the path in a non-roots field. The test must catch it, which it does by asserting failure.
2. **elsewhere still fails** (EXEC-PM M1). The path in any other charter/ file, for example a DONE list or an owner-decision note, fails.
   - Reopen: the same test command.
   - Fail-without mutant: remove the rule altogether; the test must go red.
3. **not widened** (EXEC-PM M3). Test that the exemption does not cover all of `charter/retirements/`. Each of these still fails:
   - a `.json` there that is not a retirement record;
   - a `.md` there;
   - a malformed JSON file there.
   - Fail-without mutant: widen the exemption to every file under charter/retirements/. This test must go red.
4. **before/after count.** Run `pnpm run audit:public` on the base and on the tip. Report the number of files checked and the findings, and show that the only difference the allowance can make is the record's roots entries. Measure with one planted fixture record in a scratch copy: refused before, passing after. Nothing else may change.
   - Reopen: the same command and scratch procedure, recorded in the DEV report.
5. **no-regression.**
   - Commands: `pnpm run typecheck`; `pnpm vitest run tests/audit --testTimeout=30000`; `pnpm run audit:public`; `charter check --strict` (b9323cd1).
   - PR CI must be green before acceptance.

## Gates
- pnpm run typecheck
- pnpm vitest run tests/audit --testTimeout=30000
- pnpm run audit:public
- charter check --strict (charter b9323cd1, $HOME/.local/share/charter/bin/b9323cd119f2ef2fe83db21b8ed8f844215e8852/bin/charter)

## Out of scope
- The retirement record itself, which is the retire-legacy-planning lane.
- Any allowance for the "local evidence path" rule or for private markers.

## Owner decision points
- none (EXEC-PM ruled option A with these conditions).
