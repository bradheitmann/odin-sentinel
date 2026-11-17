# Done list — deps-exceptions-20261117 (written BEFORE dispatch; does not grow during it)
Base bytes: 8c26fb3 (main)

## Problem
`pnpm run audit:deps` fails on main and on every branch, so CI `validate` is red. A new high advisory, GHSA-fc5q-39xc-vjpf (picomatch <=4.0.7, ReDoS through single-branch repeated extglobs; patched >=4.0.8, which npm does not publish yet), resolves in the tree with no record. All its paths are dev-only: @vitest/coverage-v8 > vitest > (vite | tinyglobby | fdir) > picomatch. Separately, the ten pin records in scripts/audit/audit-exceptions.json expire 2026-11-20; an expired record fails the gate on its own.

The ten records are PIN records: each documents a workspace override that keeps a patched version installed (root pnpm-workspace.yaml: ip-address, hono, qs, body-parser; telemetry/pnpm-workspace.yaml: ws, undici, sharp). The audit reports them "no matching advisory" or "not applicable" because the overrides work. tests/audit (AC13) requires every override to keep its record.

The repository stays PARKED (owner directive 2026-11-06). Lead A allowed this one slice on 2026-11-17T21:39:47Z and ruled its shape (ruling R) the same evening: renew all ten as pin records with their own reasons and expiry 2026-12-17, add the dev-only picomatch exception, change only expiry and rationale text. No code, no dependency change, no release, no PARKED line.

## Design (fixed for this slice)
One commit that changes scripts/audit/audit-exceptions.json only:
- Each of the ten existing records keeps `advisory`, `owner` and `pin` byte-identical. `expires` becomes `2026-12-17`. `rationale` keeps its current text and gains one sentence at the end, specific to that record, that says it was renewed on 2026-11-17 because the override is still in place and the advisory still does not resolve in the installed tree. The four root-workspace packages (ip-address, hono, qs, body-parser) also say that a workspace override does not reach someone who installs the published package, and that this is checked before the expiry.
- One new record, appended after the ten: `advisory` `GHSA-fc5q-39xc-vjpf`, `owner` `ODIN Sentinel maintainers`, `expires` `2026-12-01`, no `pin`. Its `rationale` names the dev-only path (@vitest/coverage-v8 > vitest > vite/tinyglobby/fdir > picomatch), says that nothing in the published package carries picomatch, and says that the record is removed once picomatch 4.0.8 or later is on npm and the tree resolves it, whichever comes before the expiry.
- `version` and `policy` are unchanged. The file stays two-space-indented JSON with a final newline, like the base.

## Write scope
scripts/audit/audit-exceptions.json only.

## Proofs
Each proof gives what it guarantees, how to reopen it, and its fail-without mutant. Mutants run in a scratch `git clone` (never `cp -R` of a worktree), never in the worktree.

1. **renewed-pins.** The ten base records keep `advisory`, `owner` and `pin` byte-identical; each `expires` is 2026-12-17; each `rationale` starts with its base text unchanged.
   - Reopen: `diff <(git show 8c26fb3:scripts/audit/audit-exceptions.json | jq -S '[.exceptions[] | del(.expires, .rationale)]') <(jq -S '[.exceptions[:10][] | del(.expires, .rationale)]' scripts/audit/audit-exceptions.json)` is empty; `jq -r '.exceptions[:10][].expires' scripts/audit/audit-exceptions.json | sort -u` prints only 2026-12-17.
   - Fail-without mutant: set one of the ten to `"expires": "2026-11-17"`; `pnpm run audit:deps` fails, naming that record as expired.
2. **picomatch-record.** Exactly one new record: GHSA-fc5q-39xc-vjpf, no `pin`, expiry 2026-12-01, and a rationale that names the vitest path, says nothing published carries it, and names the picomatch 4.0.8 retirement. `pnpm run audit:deps` passes and reports that advisory as accepted.
   - Reopen: `jq '.exceptions | length'` = 11; `jq '.exceptions[10]' scripts/audit/audit-exceptions.json`; `pnpm run audit:deps`.
   - Fail-without mutant: delete the new record; `pnpm run audit:deps` fails with "UNACCEPTED high GHSA-fc5q-39xc-vjpf in picomatch".
3. **dev-only.** picomatch is not in the production dependency tree.
   - Reopen: `pnpm why picomatch --prod` prints no dependency path; `pnpm why picomatch` shows only the vitest chain.
   - Fail-without mutant: n/a (an observation of the installed tree; recorded in the reports).
4. **horizon.** Every expiry is after the commit date and within the policy horizon (90 days); none is later than 2026-12-17.
   - Reopen: `jq -r '.exceptions[].expires' scripts/audit/audit-exceptions.json | sort -u`.
   - Fail-without mutant: set the picomatch record's expiry to `2027-06-01`; `pnpm run audit:deps` fails as over-horizon.
5. **scope-only.** The diff against the base touches scripts/audit/audit-exceptions.json only. pnpm-workspace.yaml, telemetry/pnpm-workspace.yaml, package.json, every lockfile and every test are byte-identical to the base.
   - Reopen: `git diff --stat 8c26fb3 -- . ':!charter/DONE/deps-exceptions-20261117.md' ':!charter/.dispatch'`.
   - Fail-without mutant: change the hono override in pnpm-workspace.yaml to `"^4.12.19"`; `pnpm run audit:deps` fails because the recorded pin has drifted from the override.
6. **no-regression.** `pnpm run audit:deps`, `pnpm run audit:public` and `pnpm vitest run tests/audit --testTimeout=30000` pass. Charter (c6c9843, main's declared pin): `check --strict` exits 0 and `gate <slice> --verify` exits 0 for every slice in charter/.dispatch/. The commit and push went through the installed hooks (no bypass). PR CI is green on the head apart from the charter job, which may be red only because the charter source is unreachable.
   - Reopen: the same commands; `gh pr checks <pr>` per-job lines.
   - Fail-without mutant: n/a (aggregate).

## Gates (exact commands)
- The shared hooks are installed at 69c421a (PR #46, which lands after this slice), while main declares c6c9843. Every commit, push and charter command in this slice therefore runs with `CHARTER_BIN=$HOME/.local/share/charter/bin/c6c9843bfc837e611a1d275a69d7b682f80bbd9c/bin/charter` exported. That is the hook's documented way to resolve the binary; the hook still runs its full check.
- `B=$CHARTER_BIN`
- "$B" check --strict
- for each charter/.dispatch/<slice>.json: "$B" gate <slice> --verify
- pnpm install --frozen-lockfile
- pnpm run audit:deps
- pnpm run audit:public
- pnpm vitest run tests/audit --testTimeout=30000

## Out of scope
- Any override, dependency, lockfile, test or code change; a newer MCP SDK.
- What someone who installs the published package resolves for ip-address, hono, qs and body-parser through the MCP SDK, and whether a newer SDK retires the four root pins. Lead A recorded that as one follow-up for odin, due before 2026-12-17, in its own slice.
- A `- PARKED:` line; any release.

## Owner decision points
- none.
