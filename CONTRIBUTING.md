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

   ```
   git worktree add <path> -b <branch> <base>
   ```

   Do not work in the primary checkout, and do not share a worktree between slices.

3. **Get an independent QA review.** A verifier from a different model family than the author
   reproduces the proofs from a clean clone, runs its own mutants, and writes a JSON receipt
   (schema `charter.receipt/1`) plus a verdict. The author never accepts their own work.

4. **Open the PR and wait for CI on the exact commit.** Push the branch and open the PR — a
   draft is fine, and opening it early is the practical order, so CI runs on the same tip QA is
   verifying. Both must be green on the head commit that will be landed: an acceptance recorded
   before CI ran on that commit has to be voided.

5. **Freeze, validate the receipt, accept, record cost, and check.** With independent QA passed
   and CI green on the tip:

   "CI green" in this file means every job except the charter job passes. The charter job is
   not required. While the charter source is unreachable from hosted runners, it fails as
   "charter NOT CHECKED": that red says no charter check ran there, and it does not block. The
   local `charter check --strict` run by the pre-push hook is the enforcing check. A charter
   job that fails for any other reason is a real red.

   ```
   charter freeze <slice>
   charter reopen <slice> --proof all --run-id <qa-run-id> --evidence <QA report file>
   charter receipt <receipt.json> --root .
   charter gate <slice> --accept --receipt <receipt.json>
   charter cost add --slice <slice> --seat <seat> --model <model> --in <n> --out <n>
   charter check --strict
   ```

   `freeze` refuses a dirty tracked tree, so commit first. `reopen` records evidence for a proof
   number (or `all`) with the run id and the QA report file whose bytes it hashes. `receipt`
   validates the schema, the frozen head and the verifier family; add `--verify-tree <dir>` to
   recompute the frozen manifest against a checkout. `cost add` takes the measured input and
   output counts; when usage cannot be measured, record `--unmeasured --reason <text>` instead.
   Then rewrite `charter/STATE.md` and commit it together with these records, in the same
   commit.

6. **Merge locally, pinned to the verified head.** Merge the commit CI verified, not a later tip, and merge it
   on your own machine. Never use `gh pr merge`, the web merge button or the GitHub REST merge API: those
   paths stamp the merge revision with the account's personal email, and the published history must carry
   only no-reply identities. On a clean `main`:

   ```
   git switch main
   git pull --ff-only origin main
   git merge --no-ff <branch>
   ```

   Before you push, check the identity of every revision you are about to publish:

   ```
   git log --format='%ae %ce' origin/main..HEAD
   ```

   That output must show only no-reply addresses. If it does not, fix the identity on the commits you own
   (never rewrite published history) before pushing through the gate. Use the full commit sha when you
   confirm what CI verified, not a short one and not the branch name.

7. **Tag and clean up.** Push an archive tag for the landed branch, and verify it points at the
   merged commit:

   ```
   git tag archive/<branch> <full sha>
   git push origin archive/<branch>
   git worktree remove <path>
   ```

   Preserve anything unmerged before removing a worktree; never remove one with force and never
   delete a worktree directory directly.

## When QA fails or CI goes red

- **One repair cycle per slice.** The author fixes on top of the same branch; the repair is a
  bounded pass over the named findings, not a re-scope.
- **QA re-verifies the new tip and writes a NEW receipt file**, keeping the old one as evidence.
  The new receipt names the new head.
- **Accept only on the final head, with CI green on it.** A receipt for an earlier tip does not
  carry over.
- **A red CI after an acceptance commit voids that acceptance.** Record the acceptance as void
  in `charter/STATE.md` (never rewrite history), then repair and re-accept at the new head.

## Test hygiene

- A test never runs `pnpm run build` and never touches `dist/`. The build starts with a clean
  step that deletes `dist/`, so a test that builds in parallel with another test that spawns a
  binary from `dist/` breaks that other test.
- When a test needs a child process, run the TypeScript source directly, for example:

  ```
  node --import tsx <file.ts>
  ```

  Keep test data in per-test temporary directories and clean up with the test framework's own
  teardown.
- When a test needs build output, give it its own output directory (`CARGO_TARGET_DIR` for
  Rust), so parallel runs cannot delete each other's artifacts.
- Prefer deterministic seams — an injected clock, a pane stub, a temporary filesystem root —
  over sleeping or depending on wall-clock time.

## Public surface

The audited roots are the `PUBLIC_ROOTS` list in `scripts/audit/public-surface.mjs`; every
tracked file under them is checked, and the list is the authority rather than a copy in prose.
Run the audit before every commit:

```
pnpm run audit:public
```

Never write a home path, a private project or account name, a private host name, an internal
handoff path, or a secret-looking literal anywhere in those files — including done lists, state
files and examples. `tests/` is excluded from the audit on purpose, because fixtures plant
forbidden strings to prove the rules work; do not rely on that exclusion for real documentation.

## Packaged docs

`docs/` ships in the npm package. A new documentation file needs one line in
`requiredPackageFiles` in `scripts/audit/verify-pack.mjs`, and the same line in the independent
mirror in `tests/protocol/release-sync.test.ts`. Without both, the package check fails with
"Package includes unexpected files". Root files such as this one are not packaged, so they need
no allow-list entry.

## What the tooling enforces, and what it does not

**Enforced by tooling:**

- the done-list hash, at dispatch and at accept (`charter gate --dispatch` / `--accept`);
- the receipt schema, the frozen head and a verifier family different from the author
  (`charter receipt`);
- the public-surface audit and the package check, both in the CI `validate` job;
- the charter contract, through the installed git hooks: **pre-commit** runs the
  repository's own pre-commit hook first and then `charter check`, and **pre-push** runs
  `charter check --strict` (plus `gate --accept` for slices that carry a receipt).

**Discipline, not enforced:**

- PR CI green on the exact head before `--accept` (the accept step does not read CI state);
- the author never accepts their own work (no tool records who ran accept);
- no private names in commit messages (no hook scans them);
- installing the hooks in a fresh clone, because a clone starts without them: use the pinned
  charter binary, `charter hooks install --force`, which keeps the repository's own hook as
  `<hook>.charter-backup` and runs it first, so the repository's checks are chained ahead of
  charter's rather than replaced;
- running `charter check --strict` by hand before you merge, so a problem is found before the
  hook (or CI) refuses it;
- `main` has no required status checks and no branch protection, so nothing blocks a merge with
  red CI — the merge rule above is a promise, not a gate.

Run the checks you own:

```
charter check --strict
charter hooks install --force
charter/slice-zero.sh
```

The hooks run `charter check` on commit and `charter check --strict` on push; `slice-zero.sh` is
the smallest live end-to-end check, for changes that touch the protocol server or its tools.

## Reporting

A handoff or PR description names the role and scope, the files changed, each command run with
its result, any blocked or waived check, and the remaining risks. A report that claims a gate
without its command output is not a report.
