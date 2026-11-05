# Done list — release-0.9.0 (written BEFORE dispatch; does not grow during it)
Base bytes: 8254ff0 (main)

## Problem
The last release, 0.8.0, was published on 2026-10-20 (npm and tag v0.8.0). main now carries 44 merged PRs that users do not have. The security-relevant ones are:
- the zod and body-parser advisory fixes (PR #6);
- delivery verdicts (PR #9);
- the default MCP server binding its registry store, so the event tools work (PR #21), and the non-blocking registry lock (PR #20);
- the `lease` CLI (PRs #24, #28);
- the narrowed secret scan (PR #27).

The owner asked for a 0.9.0 release done end to end by PM-ODIN (2026-11-05): version sync, changelog, tag, publish and GitHub release.

## Design (fixed for this slice)
- **Version sync 0.8.0 → 0.9.0** in every public version surface, following the 0.7.2 sync commit afe05f6:
  - package.json `version` and `publicVersion`;
  - .claude-plugin/marketplace.json; plugins/odin-scp/.claude-plugin/plugin.json; plugins/odin-scp/README.md; plugins/odin-scp/skills/odin-scp/SKILL.md;
  - README.md; docs/guides/quick-start.md; docs/guides/quickstart-prompts.md; docs/reference/distribution.md; docs/reference/public-surface-audit.md; docs/reference/capabilities.md (heading only);
  - protocol/SCP.md, bootstrap-skill.md, closeout.yaml, delegation.yaml, model-profiles.yaml, roles.yaml and topology.yaml;
  - src/protocol/version.ts and src/protocol/service.ts;
  - whatever release anchors verify-pack and tests/protocol/release-sync.test.ts pin.
  MINIMUM_COMPATIBLE_MCP_VERSION and MIN_COMPATIBLE_CHILD_MCP are unchanged.
- **Changelog:** a 0.9.0 entry in plugins/odin-scp/skills/odin-scp/CHANGELOG.md, dated 2026-11-05, summarizing the user-visible changes since 0.8.0 by PR number. It contains no private names.
- **govdisp baseline:** tests/fixtures/govdisp/baseline-manifest.json is regenerated with its generator only (PM ruling: own rows only).
- **Releasing (PM-ODIN, after merge; recorded in STATE at the next landing):**
  - tag `v0.9.0` on the merge commit, then push it;
  - the "Release validation" workflow must pass on the tag;
  - `pnpm publish` with the odin-sentinel npm token from Doppler, never written to disk or output;
  - confirm `npm view` shows 0.9.0;
  - create the GitHub release from the changelog entry.

## Write scope
The version surfaces listed above, the changelog file, verify-pack.mjs and release-sync.test.ts (release anchors only), and the govdisp baseline (generator only).

PM-ODIN writes STATE at acceptance.

## Proofs
For each proof: what it guarantees, how to reopen it, and its fail-without mutant.

1. **version-sync.** Every public version surface reads 0.9.0. `git grep -n '0\.8\.0' -- . ':!pnpm-lock.yaml' ':!charter' ':!**/CHANGELOG.md'` finds no live reference, and only historical changelog lines keep 0.8.0. The release-sync tests pass.
   - Reopen: the grep (expect no match) and `pnpm vitest run tests/protocol/release-sync.test.ts --testTimeout=30000`.
   - Fail-without mutant: leave protocol/roles.yaml at 0.8.0; `pnpm run test:package` or release-sync fails, naming that file.
2. **validate.** `pnpm run validate` passes in full: audit:public, audit:deps, audit:doctrine, typecheck, test, build and test:package. This is the same command the tag's Release validation workflow and prepublishOnly run.
   - Reopen: `pnpm run validate`, run bare so its own exit status is read.
   - Fail-without mutant: n/a (aggregate; proof 1's mutant bites through it).
3. **pack-smoke.** `pnpm pack` produces odin-sentinel-0.9.0.tgz whose file list passes verify-pack. Installed into a scratch directory, its `odin-sentinel-mcp` answers an MCP `initialize` with serverInfo.version 0.9.0.
   - Reopen: `pnpm pack --pack-destination <scratch>`; install the tgz in a scratch project; send an initialize JSON-RPC line to the binary and read serverInfo.
   - Fail-without mutant: run the same smoke against the published 0.8.0; serverInfo.version is 0.8.0.
4. **advisories-shipped.** The resolved zod and body-parser versions in pnpm-lock.yaml are at or above the fixed versions recorded for advisories-2026-10-31 (zod 4.6.7, body-parser 2.4.0), and `pnpm run audit:deps` reports nothing unaccepted at high or above.
   - Reopen: `pnpm why zod body-parser` (or a lockfile grep), and `pnpm run audit:deps`.
   - Fail-without mutant: n/a (lockfile read).
5. **changelog.** The 0.9.0 entry exists, is dated, names the user-visible changes since 0.8.0 with PR numbers, and passes the public audit.
   - Reopen: read the entry; `pnpm run audit:public`.
   - Fail-without mutant: n/a (content review).
6. **no-regression.** `charter check --strict` (pin cf05eb5 once PR #37 lands, b9323cd1 before) passes, and PR CI passes on every job except the charter job, which may be red only as "charter NOT CHECKED".
   - Reopen: the same commands.
   - Fail-without mutant: n/a (aggregate).

## Gates (exact commands)
- pnpm run validate
- charter check --strict
- pnpm vitest run tests/protocol/release-sync.test.ts --testTimeout=30000

## Out of scope
- Any behaviour change. This slice only syncs versions and writes the changelog.
- odin-say (not in the npm package).

## Owner decision points
- none. The owner asked for the release to be done end to end without them.
