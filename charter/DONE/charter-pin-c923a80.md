# Done list — charter-pin-c923a80 (written BEFORE dispatch; does not grow during it)
Base bytes: f79288c (main)
Problem: PM-CHARTER announced fleet pin c923a80cca2f74dba701ee073e631cc692b978e7 on 2026-11-01. It adds the cadence change (the STATE commit after an acceptance is no longer refused), a public-readiness scan, unmeasured cost rows, and a SPEC.md refresh. odin is on e27e00a, both locally and in its CI charter job (CHARTER_REV).
Design (fixed for this slice):
- Use the per-repository binary installed at `$HOME/.local/share/charter/bin/c923a80cca2f74dba701ee073e631cc692b978e7/bin/charter`; its `--version` must print the full pin.
- Run `charter init --refresh-spec`, which changes charter/SPEC.md only.
- Set CHARTER_REV in .github/workflows/ci.yml to the new pin; nothing else in that file changes.
- Rewrite charter/STATE.md: the tool pin, the last-green commands, and the open follow-ups.
- Do NOT run `hooks install --force` (step 4 of the announcement). The repository has its own pre-commit hook (the edge-agentic shim), and PM-CHARTER's correction (Charter TODO 71) says `--force` would silently disable it. Charter checks stay manual before every commit and merge, as the EXEC-PM rule in STATE already requires.
Write scope: charter/SPEC.md (generator only), .github/workflows/ci.yml (the CHARTER_REV line only), charter/STATE.md.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. pinned-binary: the binary prints `charter 0.1.0 (c923a80cca2f74dba701ee073e631cc692b978e7)`, and `charter check --strict` with it passes on the frozen tip.
   - Reopen: run both commands with that binary in a clean clone of the frozen tip.
   - Fail-without mutant: run the strict check against an edited charter/SPEC.md; refresh-spec must refuse, or the check must report it.
2. spec-generated: charter/SPEC.md equals what `init --refresh-spec` writes at the pin.
   - Reopen: in a clean clone, re-run `init --refresh-spec`; `git status` stays empty.
   - Fail-without mutant: append one byte to SPEC.md; the re-run must refuse or produce a diff.
3. ci-rev-only: the ci.yml diff against the base is exactly the one CHARTER_REV line. The job, with its placeholder restored, still hashes to a09faba3… (the template is unchanged). PR CI is green, and the charter job prints its "not run" line.
   - Reopen: `git diff f79288c -- .github/workflows/ci.yml`; the extract-and-hash step from ci-charter-job; `gh pr checks`.
   - Fail-without mutant: change any other byte in the job; the hash must differ.
4. hooks-preserved: the repository's existing pre-commit hook is byte-unchanged; no `*.charter-backup` exists in the hooks directory; core.hooksPath stays unset.
   - Reopen: sha256 of the hook before and after; list the hooks directory.
   - Fail-without mutant: n/a (state read; the recorded sha256 is the comparator).
5. no-regression: `pnpm run typecheck`, `pnpm vitest run tests/audit --testTimeout=30000`, and `pnpm run audit:public` are green; PR CI is green.
   - Reopen: the same commands; `gh pr checks`.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands):
- $HOME/.local/share/charter/bin/c923a80cca2f74dba701ee073e631cc692b978e7/bin/charter check --strict
- pnpm run typecheck
- pnpm vitest run tests/audit --testTimeout=30000
- pnpm run audit:public
Out of scope (recorded obligations, not fixed here):
- Installing charter's git hooks: wait for the pin that carries Charter TODO 71, where the charter hook runs an existing hook first.
- Template v2 (checkout v6, Charter TODO 70), and then restoring the one-sha-per-action rule in the pin guard test.
Owner decision points:
- none.
