# Done list — secret-scan-narrow (written BEFORE dispatch; does not grow during it)
Base bytes: 4df168f (main)
Problem: the "secret-looking unquoted assignment" rule, `/(api[_-]?key|secret|token|password)\s*[:=]\s*[A-Za-z0-9._~+/=-]{16,}/i`, appears in scripts/audit/verify-pack.mjs:145 and scripts/audit/public-surface.mjs:93. It matches ordinary code (this DONE list itself was flagged when it quoted that line verbatim). Slice slot-lease's package check failed on a built line that assigned the property path `current.record.token` to a local named `currentToken`, and the repair had to rename a variable (commit 67940a3). The lease API invites exactly that name.
Typed reason for loosening a control (EXEC-PM ruling, polyswarm R1 inspection, 2026-11-01): false positive on property-access code. The rule cannot tell a member-access expression (an identifier path such as `current.record.token`) from a literal secret, so it blocks correct code and pushes authors toward misleading names. The change exempts exactly that class and nothing else.
Design (fixed for this slice):
- Narrow both copies identically. A match is exempt only when the assigned value is a dotted identifier path: two or more segments, each a JavaScript identifier, joined by single dots, and containing no digit. Every other value that the rule matches today still matches.
- Keep one definition of the narrowed rule shared by both scripts, or keep two byte-identical copies plus a test asserting they are equal; never let them diverge.
- Key-name matching inside longer identifiers (for example `apiToken = …`) is unchanged.
Write scope: scripts/audit/verify-pack.mjs and scripts/audit/public-surface.mjs (the rule only, plus a shared module under scripts/audit/ if chosen); a new test file tests/audit/secret-rule.test.ts; tests/fixtures/govdisp/baseline-manifest.json (generator only, standing ruling). No new JavaScript beyond what the shared module needs (CS-3: do not expand); prefer keeping the rule inline.
Proofs (each: name, what it guarantees, reopen step, fail-without mutant):
1. fp-measured: the number of matches the rule makes is measured before and after, recorded in the DEV report, and reproduced by QA, over (a) the files the public-surface audit scans and (b) the built package file list that verify-pack scans, after `pnpm run build`. Every match that disappears is a dotted identifier path, listed one by one, and no other match disappears. The slot-lease line (re-planted in a scratch copy) is no longer flagged.
   - Reopen: the measuring command from the DEV report, run on base and tip.
   - Fail-without mutant: n/a (measurement); a match that disappears without being a dotted identifier path is a FAIL.
2. secrets-still-trip: tests/audit/secret-rule.test.ts plants at least 10 realistic but fake unquoted secret shapes and asserts each is flagged by BOTH scripts' rule: long alphanumeric, hex of 40 or more, base64 with `+/=`, a three-part dot-separated token with digits, a value containing `-` or `_`, `password: <value>`, `API_KEY=<value>`, `apiToken = <value>`. Fixture values must not match any real provider's token format (no real prefixes), so that no external secret scanner is tripped.
   - Reopen: `pnpm vitest run tests/audit/secret-rule.test.ts --testTimeout=30000`.
   - Fail-without mutant: remove the rule from either script, or widen the exemption to any dotted value; the test must go red.
3. exemption-exact: the same test asserts that dotted identifier paths without digits are not flagged (`current.record.token`, `this.options.apiKey`, `config.auth.secret`), and that a dotted value containing a digit (`a1b2.c3d4.e5f6g7h8i9`) still is.
   - Reopen: same command.
   - Fail-without mutant: drop the no-digit condition; the dotted-with-digit case must go red.
4. no-regression: `pnpm run validate` passes end to end (the only tolerated failure is the pre-existing sync-installations afterAll timeout), `pnpm run audit:public` passes, `charter check --strict` passes, and PR CI is green before acceptance.
   - Reopen: the same commands; `gh pr checks`.
   - Fail-without mutant: n/a (aggregate).
Gates (exact commands):
- pnpm run typecheck
- pnpm vitest run tests/audit --testTimeout=30000
- pnpm run validate
- pnpm run audit:public
- charter check --strict   (charter c923a80, $HOME/.local/share/charter/bin/c923a80cca2f74dba701ee073e631cc692b978e7/bin/charter)
Out of scope (recorded obligations, not fixed here):
- Restoring the variable name in src/protocol/lease/store.ts (`slotFence`); leave it.
- Porting these scripts to strict TypeScript (CS-3).
Owner decision points:
- none (EXEC-PM approved the loosening with these conditions).
