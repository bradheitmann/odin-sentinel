# Done list — standard-repin (written BEFORE dispatch; does not grow during it)
Base bytes: ce4b044 (main)

## Problem
The owner ratified the common engineering standard on 2026-11-04 (mister-clean PR #70, decision record charter/owner-decisions/2026-11-04-ratify-intent-and-standard.md in that repository). PM-MISTER-CLEAN asked adopters to re-pin from the draft at 5d99196 to mister-clean main b87c397d5e178d7f6850908f1b01d27f347a2223.

odin cites the standard in exactly one place, AGENTS.md:63, pinned to 5d99196. Between the two commits, COMMON-STANDARD.md changes only two frontmatter lines (`version` and `ratification`); no rule text changes.

## Design (fixed for this slice)
- AGENTS.md: the link moves from blob/5d99196 to blob/b87c397, and the sentence says the standard is owner-ratified (2026-11-04). Nothing else in AGENTS.md changes.
- PM-ODIN writes STATE at acceptance: a note that the standard is ratified at b87c397.
- No other file changes. The standard's obligations already recorded in STATE (CS-1 to CS-9) are unchanged, because no rule text changed.

## Write scope
- AGENTS.md (the one Engineering Standard paragraph)

PM-ODIN writes STATE at acceptance.

## Proofs
For each proof: what it guarantees, how to reopen it, and its fail-without mutant.

1. **pin-moved.** `git grep -n 5d99196` finds no live reference outside charter history (DONE lists, freezes and STATE's historical lines). AGENTS.md links blob/b87c397/COMMON-STANDARD.md.
   - Reopen: `git grep -n 5d99196 -- . ':!charter'` (expect no match) and `git grep -n b87c397 -- AGENTS.md` (expect one match).
   - Fail-without mutant: restore the 5d99196 link; the first grep matches.
2. **same-rules.** Between 5d99196 and b87c397, COMMON-STANDARD.md differs only in the frontmatter `version` and `ratification` lines, so odin's recorded obligations still hold. The pinned file resolves on GitHub with blob sha d4c1287aadce1039d3512b964c3f2ed8bbcfd5ad.
   - Reopen: `git -C <mister-clean clone> diff 5d99196 b87c397d -- COMMON-STANDARD.md` (exactly 2 changed lines, both frontmatter); `gh api "repos/bradheitmann/mister-clean/contents/COMMON-STANDARD.md?ref=b87c397d5e178d7f6850908f1b01d27f347a2223" -q .sha`.
   - Fail-without mutant: diff against a commit that changes rule text (any mister-clean commit that edits a numbered section); the diff shows more than frontmatter.
3. **ratified.** The cited commit's file says `ratification: owner-ratified 2026-11-04`, and the decision record it names exists at that commit.
   - Reopen: `git -C <mister-clean clone> show b87c397d:COMMON-STANDARD.md | sed -n 1,8p`; `git -C <mister-clean clone> ls-tree --name-only b87c397d charter/owner-decisions/`.
   - Fail-without mutant: show the same lines at 5d99196; they read `pending-owner`.
4. **public-safe.** `pnpm run audit:public` passes, and AGENTS.md carries no home path, private marker or secret-looking string.
   - Reopen: the audit command, run bare so its own exit status is read.
   - Fail-without mutant: plant a home path in AGENTS.md in a scratch copy; the audit fails.
5. **no-regression.** `charter check --strict` (b9323cd1) passes, and PR CI is green before acceptance.
   - Reopen: the same commands.
   - Fail-without mutant: n/a (aggregate).

## Gates (exact commands)
- pnpm run audit:public
- charter check --strict (charter b9323cd1, $HOME/.local/share/charter/bin/b9323cd119f2ef2fe83db21b8ed8f844215e8852/bin/charter)

## Out of scope
- Any change to the standard's obligations in STATE (no rule text changed).
- odin's own INTENT.md ratification (a separate owner decision).

## Owner decision points
- none (the owner ratified the standard; this is the adopter's re-pin).
