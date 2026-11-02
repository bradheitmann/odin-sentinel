# Contributing

How a change gets into this repository: write the done list first, land through an independent
verification, and keep the public surface clean. This file is written for a contributor who has
never seen the repository; follow it in order.

## Landing a slice

1. **Write the done list and pin it.** A slice starts with a done list under `charter/DONE/`
   that names the problem, the fixed design, the write scope, the proofs (each with a reopen
   step and a fail-without mutant) and the gates. Pin it before any work starts:

   ```
   charter gate <slice> --dispatch
   ```

   The pinned lists do not grow during dispatch. A finding outside the list goes in the final
   report as an obligation, not into the code.

2. **Implement in its own worktree and branch.** One slice, one branch, one worktree:
   `git worktree add <path> -b <branch> <base>`. Do not work in the primary checkout, and do
   not share a worktree between slices.

3. **Get an independent QA review.** A verifier from a different model family than the author
   reproduces the proofs from a clean clone, runs its own mutants, and writes a JSON receipt
   plus a verdict. The author never accepts their own work.

4. **Open the PR and wait for CI on the exact commit.** Push the branch, open the PR (a draft
   is fine), and wait until every check is green on the head commit that will be landed. An
   acceptance recorded before CI ran on that commit has to be voided.

5. **Freeze and accept the slice.** With CI green:

   ```
   charter gate <slice> --freeze
   charter gate <slice> --reopen
   charter gate <slice> --accept --receipt <receipt.json>
   ```

   Validate the receipt first; the accept step checks it. Add the measured cost rows and the
   `charter/STATE.md` rewrite in that same commit. Ledger files (`charter/STATE.md`,
   `charter/OBLIGATIONS.yaml`, cost rows) are written once per landing by whoever lands, not by
   every lane: that single writer removes the four-way ledger conflict that otherwise appears
   in every parallel slice.

6. **Merge pinned to the verified head.** Merge the commit that CI verified, not a later tip.

7. **Tag and clean up.** Push an archive tag for the landed slice, and remove the worktree
   without force:

   ```
   git worktree remove <path>
   ```

   Preserve anything unmerged before removing; never `rm -rf` a worktree.

## Test hygiene

- A test never runs `pnpm run build` and never touches `dist/`. The build starts with a clean
  step that deletes `dist/`, so a test that builds in parallel with another test that spawns a
  binary from `dist/` breaks that other test.
- When a test needs a child process, run the TypeScript source directly with
  `node --import tsx <file.ts>` (or a command the test's own spawn uses). Keep test data in
  per-test temporary directories, and clean up with the test framework's own teardown.
- When a test needs build output, give it its own output directory via `CARGO_TARGET_DIR` (Rust)
  or a per-run directory, so parallel runs cannot delete each other's artifacts.
- Prefer deterministic seams: inject a clock, a pane stub or a filesystem root rather than
  sleeping or depending on wall-clock time.

## Public surface

Everything tracked under the audited roots is public surface: the root documents, `docs/`,
`protocol/`, `templates/`, `plugins/`, `charter/`, `crates/` and the audit scripts. Run the
audit before every commit:

```
pnpm run audit:public
```

Never write a home path, a private project or account name, a private host name, an internal
handoff path, or a secret-looking literal (`key = value` shapes included) anywhere in those
files — including done lists, state files and commit messages. `tests/` is excluded from the
audit on purpose, because fixtures plant forbidden strings to prove the rules work; do not rely
on that exclusion for real documentation.

## Packaged docs

`docs/` ships in the npm package. A new documentation file needs one line in
`requiredPackageFiles` in `scripts/audit/verify-pack.mjs`, and the same line in the independent
mirror in `tests/protocol/release-sync.test.ts`. Without both, the package check fails with
"Package includes unexpected files". Root files such as this one are not packaged, so they need
no allow-list entry.

## Charter checks

Charter's git hooks are not installed in this repository, so run the checks by hand before every
commit and before every merge:

```
charter check --strict
```

`charter/slice-zero.sh` is the smallest live end-to-end check; run it when a change touches the
protocol server or its tools.

## Reporting

A handoff or PR description names the role and scope, the files changed, each command run with
its result, any blocked or waived check, and the remaining risks. A report that claims a gate
without its command output is not a report.
