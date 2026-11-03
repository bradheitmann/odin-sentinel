# Done list — charter-pin-b9323cd (written BEFORE dispatch; does not grow during it)
Base bytes: ab16b56 (main)

## Problem
SEAM-SYNC (charter ↔ odin, 2026-11-02) recorded one mismatch that odin owes. odin runs Charter 7b12eeaf, while the fleet pin is b9323cd1. The pin lives in three places: the per-repo binary and hooks, CI's `CHARTER_REV`, and the pin line in STATE.

The owner's closeout rule makes every remediation odin owes land before closeout. The SPEC is unchanged between the two pins (56f03db2), so `init --refresh-spec` is a no-op.

b9323cd1 adds three things:
- hooks-path-1: hooks follow `git rev-parse --git-path hooks`, and config-defined gates are listed;
- true-millisecond cost rows;
- receipt-path docs.

## Done by PM-ODIN before dispatch (machine-local, evidence recorded here)
- `charter hooks install --force` was run with b9323cd1.
- The repository's own pre-commit hook is still chained first as `.git/hooks/pre-commit.charter-backup`, sha256 b4569210cb6b95160a8fa12cb37566fc844f3d00468f8b9ea567051a74ad0a9c, unchanged.
- The installer also reports a config-defined pre-commit gate (`lang-guard`) that runs beside it.
- `check --strict` with b9323cd1 passes on main.

## Design (fixed for this slice)
- .github/workflows/ci.yml: `CHARTER_REV: b9323cd119f2ef2fe83db21b8ed8f844215e8852`. Nothing else in the file changes, and the pattern-C v2 job stays byte-identical apart from that line.
- charter/STATE.md, live lines only:
  - the pin line;
  - the hooks note (pin and the install method);
  - last-green "charter check --strict (charter b9323cd1)".
  - The charter ↔ odin SEAM-SYNC mismatch is marked closed.
  - Historical entries that cite older pins stay as they are.

## Write scope
.github/workflows/ci.yml (the CHARTER_REV line) and charter/STATE.md (the live lines named above).

## Proofs
Each proof gives what it guarantees, how to reopen it, and its fail-without mutant.

1. **pin-everywhere.** The b9323cd1 binary prints its full sha. `git grep` finds no live reference to 7b12eeaf: in ci.yml, and on STATE's pin, hooks and last-green lines (historical entries are excluded). The CI job's `CHARTER_REV` equals the pin.
   - Reopen: `charter --version`, plus `git grep -n 7b12eeaf -- .github charter/STATE.md` (only historical lines may match).
   - Fail-without mutant: leave CHARTER_REV at 7b12eeaf; the grep shows a live match.
2. **ci-job-intact.** The charter job, with CHARTER_REV restored to the template placeholder, still hashes to the v2 template (86c7a3b1…). PR CI is green, and the job prints `charter not run: charter source unreachable from this runner`.
   - Reopen: extract and hash the job; `gh pr checks`.
   - Fail-without mutant: change one other byte in the job; the hash must differ.
3. **hooks-chained.**
   - The backup sha256 is still b4569210…, core.hooksPath is unset, and pre-commit and pre-push are b9323cd1 shims.
   - A commit and a push on this branch print the own hook's output, then charter's.
   - Reopen: the sha comparison, plus the commit and push logs.
   - Fail-without mutant: n/a (state read).
4. **no-regression.** `charter check --strict` (b9323cd1), `pnpm run audit:public` and `pnpm vitest run tests/audit --testTimeout=30000` are green, and PR CI is green before acceptance.
   - Reopen: the same commands.
   - Fail-without mutant: n/a (aggregate).

## Gates (exact commands)
- charter check --strict (charter b9323cd1, $HOME/.local/share/charter/bin/b9323cd119f2ef2fe83db21b8ed8f844215e8852/bin/charter)
- pnpm run audit:public
- pnpm vitest run tests/audit --testTimeout=30000

## Out of scope
- Historical pin mentions.
- The seat-capped follow-ups.

## Owner decision points
- none.
