# Done list — charter-pin-7b12eea (written BEFORE dispatch; does not grow during it)
Base bytes: 5441b57 (main)

## Problem
PM-CHARTER announced fleet pin 7b12eeaf8c4d734386a863dc01c06da6c7ac4cb8 on 2026-11-02. It carries hooks-chain-1: `charter hooks install --force` keeps a repository's own hook as `<hook>.charter-backup` and runs it first. That makes charter's git hooks safe to install here.

The pattern-C CI template v2 (file sha256 86c7a3b196f5811579610a69786da6a51d5244a7afb8a3d2d5fc4a180940439d) is to be adopted at the next real CI change, never pushed on its own. v2 differs from v1 in three ways:
- generic comments;
- the typed line becomes `charter not run: charter source unreachable from this runner`;
- actions/checkout v6, at the SHA odin already pins.

That lets odin's pin guard test restore its one-sha-per-action rule, which ci-charter-job relaxed only because v1 pinned checkout v4.

Done before dispatch by PM-ODIN (machine-local, not repository bytes), with the evidence recorded here:
- `charter hooks install --force` was run with the 7b12eeaf binary.
- The repository's own pre-commit hook is now `.git/hooks/pre-commit.charter-backup`, sha256 b4569210cb6b95160a8fa12cb37566fc844f3d00468f8b9ea567051a74ad0a9c, unchanged from before.
- pre-commit runs `charter check`; pre-push runs `check --strict` plus `gate --accept` for receipt-bearing slices.
- core.hooksPath is unset.
- `charter check --strict` with 7b12eeaf passes on main.

## Design (fixed for this slice)
- `charter init --refresh-spec` with the 7b12eeaf binary. It writes charter/SPEC.md only.
- .github/workflows/ci.yml: replace the charter job with template v2, byte for byte. The only edit is `CHARTER_REV: 7b12eeaf8c4d734386a863dc01c06da6c7ac4cb8`. Other jobs are byte-unchanged.
- tests/audit/actions-pinned.test.ts:
  - restore the rule that one action is pinned to the same sha in every workflow;
  - fix the stale header comment (ci-charter-job QA F1);
  - every `uses:` must still be a 40-hex sha.
- CONTRIBUTING.md: the lines saying charter's hooks are not installed now say:
  - they are installed, with the repository's own pre-commit hook chained first;
  - pre-push runs the strict check;
  - a contributor installs them with the pinned binary (`charter hooks install --force`).

## Write scope
- charter/SPEC.md (generator only)
- .github/workflows/ci.yml (the charter job only)
- tests/audit/actions-pinned.test.ts
- CONTRIBUTING.md (the hooks lines only)

PM-ODIN writes STATE at acceptance.

## Proofs
Each proof gives its name, what it guarantees, how to reopen it, and its fail-without mutant.

1. **spec-and-pin.** The 7b12eeaf binary prints its full sha. `init --refresh-spec` in a clean clone leaves `git status` empty at the tip. `check --strict` passes.
   - Reopen: those commands in a clean clone of the frozen tip.
   - Fail-without mutant: a one-byte SPEC.md edit is refused or shows a diff.
2. **ci-v2-exact.** The charter job, with CHARTER_REV restored to the template placeholder, hashes to 86c7a3b1…. ci.yml has no other changed lines outside the job. PR CI is green, and the charter job prints `charter not run: charter source unreachable from this runner`.
   - Reopen: extract and hash the job; `gh pr checks` and the job log.
   - Fail-without mutant: change one byte of the job; the hash must differ.
3. **one-sha-rule-restored.** The guard test passes on the tip. It fails when one action is pinned to two different shas across workflows, and when a `uses:` is a tag, short sha or branch.
   - Reopen: `pnpm vitest run tests/audit/actions-pinned.test.ts`; plant each mutant in a scratch copy.
   - Fail-without mutant: pin the charter job's checkout to a different 40-hex sha than the other jobs; the test must go red.
4. **hooks-chained.** The repository's own pre-commit hook still runs, first:
   - a commit in a scratch clone of this repository, with the hooks copied in, prints the hook's own output before charter's;
   - a failing own-hook stops the commit;
   - the backup's sha256 equals b4569210…;
   - CONTRIBUTING.md describes this correctly.
   - Reopen: the scratch-clone commit, plus the sha comparison.
   - Fail-without mutant: make the backup hook exit 1; the commit must be refused.
5. **no-regression.** These pass on the tip, and PR CI is green before acceptance:
   - `pnpm run typecheck`
   - `pnpm vitest run tests/audit --testTimeout=30000`
   - `pnpm run audit:public`
   - `pnpm run build && pnpm run test:package`
   - `charter check --strict` (7b12eeaf)
   - Reopen: the same commands; `gh pr checks`.
   - Fail-without mutant: n/a (aggregate).

## Gates (exact commands)
- pnpm run typecheck
- pnpm vitest run tests/audit --testTimeout=30000
- pnpm run audit:public
- pnpm run build && pnpm run test:package
- charter check --strict   (charter 7b12eeaf, $HOME/.local/share/charter/bin/7b12eeaf8c4d734386a863dc01c06da6c7ac4cb8/bin/charter)

## Out of scope (recorded obligations, not fixed here)
- Making the charter repository public, so that the CI job enforces the check (owner decision CS-7).
- Historical DONE lists, freeze and dispatch records that cite earlier pins. They are accepted history and stay as they are.

## Owner decision points
- none.
