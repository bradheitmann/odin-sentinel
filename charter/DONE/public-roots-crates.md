# Done list — public-roots-crates (standard gap CS-2, part 1; written BEFORE dispatch; does not grow during it)
Base bytes: 6d35776 (main)
Problem: crates/odin-say is committed to this public repository, but scripts/audit/public-surface.mjs does not list crates/ in PUBLIC_ROOTS, so guarantee G3 (no private paths, markers or secrets on the public surface) covers the Rust crate only by a manual grep (recorded by QA on odin-say slices 1–3). A pre-scan finds tilde home-path text in crates/odin-say/README.md and in a doc comment in crates/odin-say/src/config.rs.
Design (fixed for this slice): add "crates/" to PUBLIC_ROOTS. Reword any crates/ text the audit flags to a placeholder with the same meaning (for example `$HOME/.local/state/...`), never add an exemption. Extend tests/audit/public-surface-roots.test.ts (or add a sibling test) so crates/ files are proven audited and a planted home path under crates/ is reported.
Write scope: scripts/audit/public-surface.mjs (PUBLIC_ROOTS only), tests/audit/public-surface-roots.test.ts (or a new tests/audit/public-surface-crates.test.ts), and text under crates/odin-say/ (README.md, doc comments) only where the audit flags it. No behaviour change in the crate. No other JavaScript added or grown.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. crates-audited: `pnpm run audit:public` scans crates/ files (the checked-file count rises by `git ls-files crates | wc -l`) and passes.
   - Reopen: from a clean clone of the frozen tip, `pnpm run audit:public`; compare the count with the base.
   - Fail-without mutant: append a macOS home path line to crates/odin-say/README.md; the audit must fail naming that file. Restore.
2. roots-test: the audit test proves crates/ is in the audited set and a planted home path under crates/ is reported.
   - Reopen: `pnpm vitest run tests/audit --testTimeout=30000`.
   - Fail-without mutant: remove "crates/" from PUBLIC_ROOTS; the test must go red.
3. no-behaviour-change: `cd crates/odin-say && cargo +1.88.0 test --locked` passes unchanged (own CARGO_TARGET_DIR outside the repo, under nice); the diff under crates/ touches only Markdown and comment lines.
   - Reopen: the cargo test command and `git diff <base> -- crates/` from a clean clone.
   - Fail-without mutant: n/a (comment and doc text only).
4. no-regression: `pnpm run typecheck`, `pnpm vitest run tests/audit --testTimeout=30000`, `charter/slice-zero.sh`, `charter check` green; CI green on the PR.
   - Reopen: the same commands; `gh pr checks`.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands):
- pnpm run audit:public
- pnpm run typecheck
- pnpm vitest run tests/audit --testTimeout=30000
- cd crates/odin-say && cargo +1.88.0 test --locked
- charter/slice-zero.sh
- charter check
Out of scope (recorded obligations, not fixed here):
- CS-2 part 2: a secret scan of the diff before push (tool choice and pin).
- tests/ stays excluded from the audit by design (fixtures plant forbidden strings on purpose); record the reason in the audit script comment only if that file is already being edited.
Owner decision points:
- none.
