# Done list — registry-store-default (written BEFORE dispatch; does not grow during it)
Base bytes: 3cce100 (main, after registry-lock-async landed)
Problem: the governance-registry MCP tools (odin_append_event, odin_query_events) are registered by default (since 0.6.0) but the default CLI server injects no registry store, so they always fail closed with store_unavailable. An archived, never-reviewed branch (fix/registry-cli-store-20261020, tag archive/fix/registry-cli-store-20261020 at 2997fc9; commits 4da6a6e and 2997fc9, authored 2026-10-20) binds the shipped filesystem store at CLI startup and publishes object schemas for the registry tool arguments. Its prerequisite, a lock wait that does not block the MCP event loop, landed as registry-lock-async.
Design (fixed for this slice):
- Carry over from the archived commits ONLY: (a) binding the shipped filesystem registry store at CLI startup through a lazy dynamic import, preserving the runtime-isolation invariant and the fail-closed zero-argument createServer behaviour; (b) publishing object schemas for the registry tool arguments; (c) their tests. Use `git cherry-pick` of 4da6a6e and 2997fc9 onto this branch and resolve conflicts against current main, or reapply by hand; either way the originals stay preserved by their archive tag.
- Do NOT carry over the dependency bumps in 4da6a6e: main already has newer versions (MCP SDK 1.32.1) and the 2026-10-31 advisory fix. package.json and pnpm-lock.yaml must end identical to main unless a test proves a change is required.
- The default server's store must provide the async append from registry-lock-async, so odin_append_event never blocks the event loop.
- Document where the default store writes and how to override it (existing env or option names) in the MCP tool descriptions or the registry docs, without private paths.
Write scope: src/bin/index.ts, src/mcp/server.ts (registry tool schemas and default-store wiring only), src/protocol/event-registry/storage.ts only if the store adapter needs the async append exposed, tests/registry-cli-store.test.ts, tests/registry-tool-schema.test.ts, tests/mcp/event-registry-tools.test.ts, tests/fixtures/govdisp/baseline-manifest.json (generator only, standing ruling), the registry section of docs or protocol text if a doctrine audit requires it. Nothing else; package.json and pnpm-lock.yaml unchanged.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. works-by-default: the real `odin-sentinel` stdio server, started with no special configuration in a temp working directory, accepts an odin_append_event call and returns the appended event through odin_query_events (append then query round trip over stdio).
   - Reopen: the end-to-end test named in the DEV report, from a clean clone of the frozen tip.
   - Fail-without mutant: remove the startup store binding; the round trip must fail with store_unavailable and the test must go red.
2. non-blocking-by-default: on the default server, while another process holds the registry lock for about 2 s, a second tool call answers in under 300 ms (the registry-lock-async property, now on the real default wiring).
   - Reopen: the corresponding test.
   - Fail-without mutant: bind a store without the async append; the test must go red.
3. schemas-published: the registry tools' input schemas are JSON objects with the documented properties (the archived tests, adapted).
   - Reopen: `pnpm vitest run tests/registry-tool-schema.test.ts`.
   - Fail-without mutant: revert to the previous schema shape; the test must go red.
4. isolation-and-fail-closed: the runtime-isolation invariant test (no static import of the event-registry module from runtime hosts) still passes, and createServer() with zero arguments still fails closed with store_unavailable.
   - Reopen: `pnpm vitest run tests/protocol tests/mcp --testTimeout=30000`.
   - Fail-without mutant: import the registry module statically in src/bin/index.ts; the isolation test must go red.
5. deps-unchanged-and-clean: `git diff <base> -- package.json pnpm-lock.yaml` is empty; `pnpm run audit:deps` reports 0 unaccepted advisories.
   - Reopen: those two commands.
   - Fail-without mutant: n/a (a diff check).
6. no-regression: `pnpm run typecheck`, `pnpm vitest run tests --testTimeout=30000` (full suite), `pnpm run audit:public`, `pnpm run audit:doctrine`, `charter/slice-zero.sh`, `charter check --strict` green; CI green on the PR.
   - Reopen: the same commands; `gh pr checks`.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands):
- pnpm run typecheck
- pnpm vitest run tests --testTimeout=30000
- pnpm run audit:deps
- pnpm run audit:public
- pnpm run audit:doctrine
- charter/slice-zero.sh
- charter check --strict   (charter e27e00a)
Out of scope (recorded obligations, not fixed here):
- Retention or rotation of the default registry store.
Owner decision points:
- none (the registry tools have been default-on since 0.6.0; this slice makes them work rather than fail closed).
