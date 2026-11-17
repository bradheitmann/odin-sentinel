# Done list — charter-pin-c6c9843 (written BEFORE dispatch; does not grow during it)
Base bytes: 633aef4 (main)

## Problem
odin runs Charter v0.1.0 (ef2b92e). The fleet pin is now c6c9843bfc837e611a1d275a69d7b682f80bbd9c (PM-CHARTER, 2026-11-17; it supersedes 98055d7). v0.1.0 refuses every `charter check` once charter/STATE.md is older than 7 days. odin's STATE.md has no `- HEAD: … recorded <UTC>` line, so its age is the file's modification time, 2026-11-10T16:21:39Z, and the primary checkout refuses every commit from 2026-11-17T16:21:39Z. A fresh clone resets that time, so CI does not show it.

The repository stays PARKED (owner directive 2026-11-06). Lead A ruled this one slice on 2026-11-17T01:24:14Z: no code, no release, no PARKED line.

## Done by PM-ODIN before dispatch (machine-local, evidence recorded here)
- `charter hooks install` was run with c6c9843 (binary sha256 545b1c1996639b0444b6e12ad62fa8f56ad442716fbf5c1c8e23ebe967ce2fde). It reports pre-commit `check` and pre-push `check --strict` with the pushed refs plus `gate --verify` for every dispatched slice, and the config-defined gate lang-guard on pre-commit. `hooks status` reads drift on both hooks only because charter/PIN.toml is absent.
- With c6c9843 on main 633aef4: `check --strict` exits 0 (warnings: the old SPEC text, the hooks before re-install); `gate <slice> --verify` exits 0 for all 35 dispatched slices.

## Design (fixed for this slice)
Following PM-CHARTER's ordered list (~/.local/share/charter/PIN-NOTES-2026-11-17.md), as one commit:
- .github/workflows/ci.yml: `CHARTER_REV: c6c9843bfc837e611a1d275a69d7b682f80bbd9c`. Nothing else in the file changes. Template v3 is unchanged at this pin.
- `charter init --refresh-spec` with c6c9843. It replaces charter/SPEC.md, and also any unedited older charter/GOVERNANCE.md or charter/schemas/charter-toml.schema.json if odin has them. Whatever it rewrites is committed as written, and the DEV report lists every such path.
- charter/PIN.toml, new, exactly one line: `commit = "c6c9843bfc837e611a1d275a69d7b682f80bbd9c"`.
- charter/STATE.md, hand-edited (NOT `charter state --write`, which drops the hand-written header):
  - line 1 becomes `# State — odin-sentinel — <UTC>, written by OD/DEV (deepseek/deepseek-flash) for slice charter-pin-c6c9843`;
  - line 2 is new: `- HEAD: <full sha of the commit the edit is made on> on branch chore/charter-pin-c6c9843, recorded <UTC>`. <UTC> is the same value as on line 1, read from `date -u +%Y-%m-%dT%H:%M:%SZ` when the line is written, never typed by hand;
  - the existing `HEAD: main a835956 …` line (line 3 today) is removed, because the marker replaces it;
  - the "Charter tool pin" line names c6c9843 (charter fleet pin 2026-11-17), its binary path, and the matching CI CHARTER_REV;
  - the "Charter git hooks" paragraph adds: re-installed at c6c9843 on 2026-11-17 with `charter hooks install`; pre-push now runs `check --strict` with the pushed refs and `gate --verify` for every dispatched slice (no `gate --accept`); both hooks hold the binary to charter/PIN.toml;
  - every other line stays byte-identical, including the PARKED paragraph and the historical entries that cite older pins.

## Write scope
.github/workflows/ci.yml (the CHARTER_REV line); charter/PIN.toml (new); charter/STATE.md (the lines named above); the files `charter init --refresh-spec` rewrites (charter/SPEC.md, and only if present and rewritten by the tool, charter/GOVERNANCE.md and charter/schemas/charter-toml.schema.json).

## Proofs
Each proof gives what it guarantees, how to reopen it, and its fail-without mutant.

1. **pin-everywhere.** The c6c9843 binary prints its full sha. charter/PIN.toml is exactly the one line above. ci.yml's CHARTER_REV equals the pin. `git grep -n ef2b92e -- .github charter/PIN.toml` finds nothing, and in charter/STATE.md ef2b92e appears only in historical entries, not on the pin line or the hooks paragraph's current sentence.
   - Reopen: `"$B" --version`; `cat charter/PIN.toml`; `git grep -n ef2b92e -- .github charter/PIN.toml charter/STATE.md`.
   - Fail-without mutant: leave CHARTER_REV at ef2b92e; the grep shows a live match in ci.yml.
2. **hooks-match.** `"$B" hooks status` reads match for pre-commit and pre-push, with no drift line.
   - Reopen: `"$B" hooks status` in the worktree.
   - Fail-without mutant: in a scratch copy, set PIN.toml to the 98055d7 commit; `hooks status` reports drift and `check --strict` refuses.
3. **spec-refreshed.** charter/SPEC.md is byte-identical to the text c6c9843 embeds, and `"$B" check --strict` prints no "earlier published spec" warning. Every other path `init --refresh-spec` rewrote is listed in the DEV report with its sha256.
   - Reopen: `shasum -a 256 charter/SPEC.md` against the embedded sha the binary names (3ecb03ec…); `"$B" check --strict 2>&1 | grep -c 'earlier published spec'` = 0.
   - Fail-without mutant: restore the base SPEC.md; the warning returns.
4. **state-marker.** charter/STATE.md has exactly one `- HEAD: ` line. Its sha is a commit on the branch; its recorded UTC equals line 1's UTC; that UTC is not later than the committer time of the commit that writes it; and `"$B" check --strict` reports no STATE freshness or cadence refusal. The diff of STATE.md against the base touches only the lines the Design names.
   - Reopen: `grep -n '^- HEAD: ' charter/STATE.md`; `git cat-file -t <sha>`; `git log -1 --format=%cI -- charter/STATE.md`; `git diff 633aef4 -- charter/STATE.md`.
   - Fail-without mutant: in a scratch copy, set the recorded UTC to 8 days before now; `check --strict` refuses "charter/STATE.md is older than 7 days".
5. **ci-rev-only.** The ci.yml diff against the base is exactly the one CHARTER_REV line.
   - Reopen: `git diff 633aef4 -- .github/workflows/ci.yml`.
   - Fail-without mutant: change any other byte in the charter job; the diff shows a second line.
6. **no-regression.** With c6c9843: `check --strict` exits 0, and `gate <slice> --verify` exits 0 for every slice in charter/.dispatch/. `pnpm run audit:public` and `pnpm vitest run tests/audit --testTimeout=30000` are green. The commit and the push went through the installed hooks (no bypass). PR CI is green on the head apart from the charter job, which may be red only as "charter NOT CHECKED".
   - Reopen: the same commands; `gh pr checks <pr>` per-job lines.
   - Fail-without mutant: n/a (aggregate).

## Gates (exact commands)
- `B=$HOME/.local/share/charter/bin/c6c9843bfc837e611a1d275a69d7b682f80bbd9c/bin/charter`
- "$B" check --strict
- "$B" hooks status
- for each charter/.dispatch/<slice>.json: "$B" gate <slice> --verify
- pnpm run audit:public
- pnpm vitest run tests/audit --testTimeout=30000

## Out of scope
- A `- PARKED:` line: it needs an owner-decisions file, which odin does not have for the 2026-11-06 park.
- `[state]` in charter.toml, `models.authors`/`models.verifiers` lists, maker fields.
- Historical pin mentions; any code, package or release change.

## Owner decision points
- none.
