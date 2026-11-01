# Done list — sync-mcp-pins (written before QA dispatch; does not grow during it)
Base bytes: 3b7e3ef (fix/sync-mcp-pins 5bee5a0, authored 2026-09-26 before this repository adopted its charter, merged with main e00e425)
Problem: the skill sync script refreshed installed skill text and adapters but never touched each harness's MCP server registration, which stays pinned to whatever release was current when it was written; after 0.7.2 thirteen configs on one machine still pinned 0.6.0 or 0.4.13. The fix (one commit, never QA'd) teaches plugins/odin-scp/skills/odin-scp/scripts/sync-installations.sh to re-pin those registrations to the master's release.
Design (as authored; this list records it for verification, it does not change it): acceptance criteria AC1–AC7 of the story below are the contract.
Write scope (of the authored change): plugins/odin-scp/skills/odin-scp/scripts/sync-installations.sh, tests/scripts/sync-installations.test.ts. This list adds no code.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. version-source (AC1): the expected version is read only from the master SKILL.md `SCP_PUBLIC_VERSION: x.y.z` line.
   - Reopen: `pnpm vitest run tests/scripts/sync-installations.test.ts --testTimeout=30000` from a clean clone of the frozen tip.
   - Fail-without mutant: read the version from another source (for example package.json directly); the version-source test must go red.
2. targets-and-rewrite (AC2, AC3): the default harness MCP config list (overridable with SCP_MCP_CONFIG_TARGETS_FILE) is scanned; write mode rewrites only the version text of an x.y.z pin strictly older than master, through the existing file (inode, mode, symlinks kept); every other byte is kept; newer, prerelease and non-release pins are untouched.
   - Reopen: same vitest command.
   - Fail-without mutant: rewrite a newer pin too (drop the strictly-older check); the test must go red.
3. dry-run-and-verify (AC4): --dry-run and --verify-only write nothing, report stale pins and exit non-zero; write mode verifies after writing and exits 0 when every pin is current.
   - Reopen: same vitest command.
   - Fail-without mutant: make --dry-run write; the test must go red.
4. refusals (AC5): a config path that exists and is not a regular file is refused and never read; a config that resolves into the master is never written.
   - Reopen: same vitest command.
   - Fail-without mutant: follow a non-regular file; the test must go red.
5. quiet-when-absent (AC6): pin summary lines print only when at least one pinned config exists; every pre-existing test case's output is byte-unchanged.
   - Reopen: same vitest command.
   - Fail-without mutant: always print the summary; a pre-existing case must go red.
6. portability-and-gates (AC7): shellcheck clean; bash 5 and /bin/bash 3.2 behave the same on the test suite; `pnpm run typecheck`, `pnpm run audit:public`, `pnpm run audit:doctrine`, `charter/slice-zero.sh`, `charter check` green; CI green on PR #2.
   - Reopen: `shellcheck plugins/odin-scp/skills/odin-scp/scripts/sync-installations.sh`; the gates; `gh pr checks 2`.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands):
- shellcheck plugins/odin-scp/skills/odin-scp/scripts/sync-installations.sh
- pnpm vitest run tests/scripts/sync-installations.test.ts --testTimeout=30000
- pnpm run typecheck
- pnpm run audit:public
- pnpm run audit:doctrine
- charter/slice-zero.sh
- charter check
Out of scope (recorded obligations, not fixed here):
- The script is bash (existing); porting it is part of standard gap CS-3.
Owner decision points:
- none.
