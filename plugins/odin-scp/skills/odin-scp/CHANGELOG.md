# Changelog

## 0.9.1 - 2026-11-05

Remediation release from the closeout field run. No protocol, tool or resource contract changes, and no behaviour change on the paths a normal install uses; MIN_COMPATIBLE_CHILD_MCP stays 0.4.5.

- **The `odin-say` crate's tests no longer depend on the cargo target selection.** The fake pane double used to be an example, so `cargo test --all-targets` could not find it and only a plain `cargo test` passed. It is now built from `tests/support` at test runtime, so both selections resolve it from a fresh clone, and it can never be packaged or installed: `cargo package` carries the test source only, and `cargo install` installs exactly one executable.
- **The install sync declares its pathname-expansion semantics.** The script sets `nullglob`, so an unmatched pattern can no longer stay as its literal text and be read as a path, and an empty target list is now named and refused instead of reporting zero installations as a silent success. Nothing changes when files match.
- **The tests carry no detector-shaped literals.** Fixtures use plain values, and the two detector suites build their synthetic samples at runtime, so the same assertions still prove the detectors fire while tracked bytes hold no credential-, email- or path-shaped literal. Every assertion is kept; no exemption was added.
- **The charter fleet pin moves to v0.1.0** (revision `ef2b92e`) in CI, and `CONTRIBUTING.md` now lands merges locally, `git merge --no-ff` on main under a no-reply identity, instead of through the GitHub merge path.

## 0.9.0 - 2026-11-05

First release since 0.8.0 (2026-10-20). No protocol, tool or resource contract breaks: the tool and resource counts, the registry opt-out and MIN_COMPATIBLE_CHILD_MCP (0.4.5) are unchanged.

- **Security: the two high advisories that failed the release check on every branch are cleared.** `zod` moves to 4.6.7 and `body-parser` is overridden to `^2.4.0` with a dated exception record, so `audit:deps` reports nothing unaccepted at high or above (#6).
- **Typed delivery verdicts.** `odin.validate_cmux_delivery_proof` accepts an optional `record_kind`: absent or `delivery` keeps every existing verdict byte for byte, and `send_refusal` is a typed non-delivery record, so a pre-send refusal (a busy pane) validates as `not_delivered` instead of `invalid`. Every result carries an additive `delivery` field derived from its final verdict (`delivered`, `delivered_no_ack`, `not_delivered`, `not_proven`); an invalid result is always `not_proven` (#9).
- **The event registry tools work on the default server.** The CLI binds the shipped filesystem store at startup, so `odin_append_event` and `odin_query_events` no longer fail closed on an unconfigured server; a zero-argument `createServer()` still fails closed, and the append tool names where it writes and how to override it (#21).
- **Registry lock: a budget with backoff, then asynchronous.** A contending writer gets capped exponential backoff with jitter under a 10 s budget instead of roughly 0.5 s, with fail-closed behaviour, the `lock_unavailable` code and the `events.lock` field unchanged (#10); the wait then moves to async timers, so a contended lock can no longer block the MCP server's event loop (#20).
- **The lease CLI, for recurring jobs run by more than one runner.** `odin-sentinel lease <acquire|renew|release|check|status>` prints one JSON object per call: each slot has one holder, an expiry with a skew allowance, and a fencing token that only increases, and every read-modify-write goes through the existing registry lock (#24). Slots can be restricted to an allow-list, `acquire --slots a,b` grants the first free slot (or the one this holder already holds) and is refused with `all_slots_held` listing each holder and expiry, and `docs/reference/lease.md` documents the field case (#28).
- **The install sync re-pins harness MCP registrations.** The sync script reads the master's release and rewrites only the version text of an older `x.y.z` pin in the harness config files it knows, leaving inode, mode, symlinks and every other byte intact. A pin that is newer, a prerelease or not a release number is reported as `UNMANAGED` and never rewritten; `--dry-run` and `--verify-only` write nothing; stale, unmanaged or refused pins make the run exit non-zero in every mode (#2).
- **The narrowed secret scan.** The "secret-looking unquoted assignment" rule exempts a value only when the whole value is a dotted identifier path with no digit (property-access code). Everything that matched before still matches, and both copies of the rule stay byte-identical (#27).
- **`CONTRIBUTING.md`** documents the landing procedure, so the commit, gate and CI expectations are written down for contributors (#29).
- **The public audit covers more of the public surface.** `charter/` (#12) and `crates/` (#16) are audited like `docs/` and `protocol/`, every GitHub Action is pinned to a full commit sha (#13), and the private-path rule gains one JSON-aware allowance, limited to the top-level `roots` of a retirement record, so a retirement record can name the directory it retires while every other file, field and rule still fails (#33).
- **The common engineering standard v0.2** is adopted and its gaps recorded (#8), and the standard is re-pinned to its owner-ratified revision (#35).
- **Repository tooling.** The Rust sender sidecar, its typed proof records, mid-turn delivery policy, proof integrity and the provider-capped seat state ship in the repository for team delivery proof (#7, #14, #15, #17, #31). It is not part of the npm package and changes no MCP surface.
- **Project governance and records.** Charter pins, measured cost rows, STATE refreshes, close rulings and the fleet charter CI job (#11, #18, #19, #22, #23, #25, #26, #30, #32, #34, #36, #37).

## 0.8.0 - 2026-10-19

- Full MCP deployment remains the default, with strict optional protocol, governance and telemetry capability selection. Disabled groups have no registered handlers; existing registry authority flags and telemetry consent/authentication remain intact.
- Governance registry authority, attempt/depth/overhead accounting and finding lifecycle now live in a transport-independent deep module, available through `./governance`. Existing service imports remain compatible.
- Direct `./surface-layout` and `./role-identity` exports support focused library adoption. Minimum compatible child MCP stays 0.4.5.

## 0.7.2 - 2026-09-23

Fleet sync script (`scripts/sync-installations.sh` in the skill directory) fixes landed after 0.7.1. No protocol, tool, resource, or MCP behaviour changes; MIN_COMPATIBLE_CHILD_MCP stays 0.4.5.

- Nothing writes back into master. A native target whose physical write location is master, lies inside master, or is an existing ancestor of master is skipped, and so is an adapter whose physical write location is master or lies inside master, or that shares an inode with a master file. Locations are resolved by the kernel (`cd -P`) and compared by filesystem identity (`-ef`), so symlinks, `link/..` spellings, case-variant spellings on case-insensitive volumes, and hard links are all caught. A location that cannot be attributed (a symlink loop, a newline in a path or in link text) is skipped too.
- A native install is verified as a whole-tree snapshot of master: a matching `SKILL.md` with a changed, extra, or missing file anywhere else in the tree is reported DRIFTED. Any `diff -rq` output counts as drift, because Apple's diff exits 0 on a file/directory type swap, a dangling link, or an unreadable path.
- In `SCP_SKILL_TARGETS_FILE` and `SCP_ADAPTER_TARGETS_FILE`, a line that starts with a tilde followed by a slash now expands to `$HOME/`. Before this fix it was used as a path relative to the working directory.
- Write mode and `--dry-run` refuse, and leave untouched, a native target that holds a FIFO, socket, or device (openrsync blocked forever opening a FIFO as its basis file) or whose own path exists and is not a directory, and an adapter path that exists and is not a regular file. The other installations are still synced, and the run exits non-zero. New summary lines `native_refused` and `adapter_refused` are printed only when non-zero, so a healthy run's output is unchanged.
- Digests are taken from file contents on stdin. Previously `shasum` escaped a backslash in the file name and prefixed the digest with a backslash, so a correct copy at such a path was reported DRIFTED.
- A native target that is `$HOME` or `/` (a line holding only a tilde and a slash, the absolute home path, or any spelling that resolves to either) stops the run in every mode before anything is written, whether or not master is inside `$HOME`. A proper ancestor of `$HOME` is refused per target in every mode and never written (one that also contains master is skipped by the master-overlap guard first); ancestors of the physical location are included, so a `$HOME` that is a symlink still protects the directories that really contain it.
- Only a leading tilde-slash is expanded in the targets files. A line that is exactly a tilde, `$HOME` or `${HOME}`, or that starts with `$HOME/` or `${HOME}/`, stops the run in every mode before anything is written. Before this fix it was used as a path relative to the working directory.
- Two load-sensitive tests declare a 30 s per-test timeout.
- Release check: in `scripts/audit/verify-pack.mjs`, a changelog line in an earlier release's section that pins the package only to that section's own version (such as a publication note) no longer fails a later release's install-pin check. Every other line is still checked, including unpinned or differently pinned references in earlier sections, the current and later-version sections, and text under non-release headings.

## 0.7.1 - 2026-09-22

- Patch re-cut of 0.7.0. The `v0.7.0` tag (1f7d132) was cut before GHSA-rgj7-g3m4-5g8c (sharp, bundled libheif) was published, and its Release-validation run failed in `telemetry-validate` once the advisory landed. Tags never move, so this release is cut from `main` after 1fb15c0, which pins `sharp` to `^0.35.4` in the telemetry worker workspace (dev-only tooling through wrangler -> miniflare; the worker never invokes sharp) and records the advisory in `scripts/audit/audit-exceptions.json` with owner, expiry 2026-11-20, rationale, and pin linkage.
- No protocol, tool, resource, or behaviour changes relative to 0.7.0. Every version-authority surface moves 0.7.0 -> 0.7.1 in one change; the govdisp baseline fixture is regenerated; MIN_COMPATIBLE_CHILD_MCP stays 0.4.5.
- The six `refs/sprint-rescue/lane-*` safety pins recorded in the 0.7.0 release lineage were deleted after re-proving each original patch byte-identical to its landed cherry-pick; the two `rescue/*` draft tags were deleted because their sole content (the GOVEDGE-HARNESS-IDENTITY-UNIQUENESS amendment and its implementation) landed as `3226d32` under STORY-GOVEDGE-S3, which is COMPLETE with a PASS holdout.
- Published: `@bradheitmann/odin-sentinel@0.7.1` is on the npm registry under dist-tag `latest` (registry time 2026-09-22T22:31:48Z, `dist.shasum` `82dc93af41d513111c4430ed3f023c98c64fb7bf`). Every file in the registry tarball is byte-identical to a `pnpm pack` of tag `v0.7.1` (`230ffc6`) except `package.json`, whose key order and retained lifecycle scripts depend on the packing pnpm version; its parsed content is identical to `v0.7.1:package.json`.

## 0.7.0 - 2026-09-08

- Dependency audit now runs on the publish path: `scripts/audit/dependency-audit.mjs` joins the `validate` chain as `audit:deps`, so `prepublishOnly` fails closed and a tree carrying an unaccepted high-severity advisory cannot be published. Accepted advisories are recorded in `scripts/audit/audit-exceptions.json` with an owner, an expiry, and a rationale per entry; the manifest is validated before the audit runs and a malformed or expired entry fails the gate on its own.
- CI's audit floor moves from `pnpm audit`'s default (`low`) to `high`. This is a deliberate loosening of CI strictness, paired with the new fail-closed publish-path gate and its exception manifest: CI no longer breaks on low-severity advisory churn, while the release path gains a check it previously had none of. Both workflows now call the single gate script instead of duplicating a bare `pnpm audit` step.
- BREAKING: harness names are exact-match fail-closed. A harness list entry that previously produced a best-effort or degraded row now THROWS a named refusal: a spelling that is not exact canonical snake_case where a canonical id is required is refused as `non_canonical_harness_id`, and a name matching no entry's exact canonical id or exact declared `display_name` is refused as `unknown_or_non_canonical_harness`. An input that worked by loose matching — `DROID`, a trailing-space `Droid`, a typo in a harness list — now stops the call instead of returning a row. Compose harness lists from the declared ids and display names verbatim (`droid` or `Droid`, nothing else).
- BREAKING: closure requires two canonically distinct emitters. A closure claim whose `SLICE_QA_PASS` and `HOLDOUT_ACCEPTED` verdicts come from one emitting seat — under ANY respelling of that seat — is refused as `CLOSURE_LANE_COLLAPSE`; implementer-emitted and closer-emitted verdicts are refused as `CLOSURE_SELF_REVIEW` and `CLOSURE_SELF_ASSERTION`; an unreadable emitter or party identity is refused as `EMITTER_IDENTITY_INVALID` or `CLOSURE_PARTY_IDENTITY_INVALID` rather than passing as "different strings". Closure inputs that previously passed because the same seat signed both lanes under two spellings now fail by name.
- BREAKING: role-identity comparison is strict and fail-closed. Authority decisions compare canonical role-slot identity (NFKC, zero-width/format strip, Unicode-whitespace fold, and a hyphen-class fold of exactly U+2010 and U+2011); every other dash-punctuation spelling (U+2012, U+2013, U+2014, U+2015, U+2212) now REFUSES as unparseable instead of being folded or compared raw. Identities that previously matched via loose comparison, or slipped through as "distinct" via a respelling, are now refusals; a refused form also fails self-issue equality in both directions.
- BREAKING: sentinel inputs are strictly validated and insufficient input yields no finding. `base_seconds`, `per_file_seconds`, and `max_seconds` must all be present, finite, and strictly positive, with `max_seconds >= base_seconds` (`max_seconds_gte_base_seconds`; the equal boundary is valid); identifiers must be non-empty after trimming (`non_empty_after_trim`). A legacy flat or zero-padded timeout policy, or a missing identifier, that previously produced a defaulted finding now yields NO finding on a direct library call and a named rejection at the MCP boundary.
- The skill frontmatter version now tracks the package version. `SKILL.md` and its byte mirror `protocol/bootstrap-skill.md` carried `version: 3.6.1` and a description naming a private protocol number while the package they ship inside was 0.6.0; both frontmatters now carry the package version, the description wording is version-neutral, and the retired private 3.x numbering line is gone from the skill surface. `scripts/audit/verify-pack.mjs` parses both frontmatters and refuses, by file name and with a non-zero exit, a version that differs from `package.json`, two frontmatter versions that differ from each other, an absent frontmatter block, an absent or unparseable `version` key, surviving legacy `SCP v3.x` wording in either skill mirror or either `canonical-introduction-prompt.md` copy, and whole-file divergence in either mirror pair. An absent input is a named refusal, never a skipped check.
- BREAKING (doctrine): installed runtime skill copies are synchronized snapshots of the canonical skill; a differing copy is stale and must be re-synced. All three doctrine copies (`SKILL.md`, `protocol/bootstrap-skill.md`, and `protocol/SCP.md`) previously granted local copies permission to diverge; they now state the snapshot rule while keeping their existing release-check claims. `verify-pack.mjs` refuses any doctrine or reference copy that still grants that permission, by name and with a non-zero exit.
- BREAKING (fleet script): `scripts/sync-installations.sh` generates the three harness adapters deterministically from the canonical `SKILL.md` instead of aborting with `missing adapter`, verifies every native target and adapter by exact content rather than by marker presence, reports every ABSENT installation by name and never counts it as verified, and exits non-zero on absence or drift in every mode. `--dry-run` now writes nothing at all: it no longer creates target directories, and a dry run that finds drift or absence exits non-zero instead of exiting 0 while printing a failure line. The 13 native targets and 3 adapters, the targets-file overrides, `--emit-report`, and the never-write-back-into-master rule are unchanged.

### Release lineage (lane disposition, 2026-09-21)

0.7.0 was assembled on the integration branch from eight story lanes. Each
lane was retired only after a recorded proof that the integration branch
already carries its content; nothing was discarded.

| Lane branch | Lane tip | Landed as | Proof |
| --- | --- | --- | --- |
| `lane/govedge-s1` | `3694c6f` | `790a110` (STORY-GOVEDGE-S1) | `git cherry` patch-equivalent; `git diff 3694c6f 790a110` empty |
| `lane/govedge-s2` | `eef801c` | `e95fef1` (STORY-GOVEDGE-S2) | `git cherry` patch-equivalent; interdiff of the two commit patches empty (lane was based before S1) |
| `lane/govedge-s3-t2` | `7eac03d` | `3226d32` (STORY-GOVEDGE-S3) | `git cherry` patch-equivalent; `git diff 7eac03d 3226d32` empty |
| `lane/govedge-s3-t3` | `e95fef1` + staged draft | `3226d32` supersedes | branch tip is an ancestor; the uncommitted 8-file staged draft differed from `3226d32` and was preserved as tag `rescue/govedge-s3-t3-staged-20260921` (`9b5aa07`) until 0.7.1, when the tag was deleted as superseded (see the 0.7.1 entry) |
| `lane/w2-f41c8` | `e95fef1` + staged draft | `3226d32` supersedes | branch tip is an ancestor; staged draft was preserved as tag `rescue/w2-f41c8-staged-20260921` (`bfe29ab`) until 0.7.1, when the tag was deleted as superseded (see the 0.7.1 entry) |
| `lane/rel070-001` | `89d3c85` | `a003ac2` (STORY-REL070-001) | `git cherry` patch-equivalent; `git diff 89d3c85 a003ac2` empty |
| `lane/rel070-002` | `7d92957` | `ab946da` (STORY-REL070-002) | `git cherry` patch-equivalent; `git diff 7d92957 ab946da` empty |
| `lane/rel070-003` | `ffde2ba` | `cfcac76` (STORY-REL070-003) | `git cherry` patch-equivalent; `git diff ffde2ba cfcac76` empty |

The eight lane worktrees (`odin-wt-s1`, `odin-wt-s2`, `odin-wt-s3-t2`,
`odin-wt-s3-t3`, `odin-wt-f41c8`, `odin-wt-rel070-001/002/003`) and the
eight `lane/*` branches were removed after these proofs. The two rescue tags
are local maintainer refs and are not part of the release.

## 0.6.0 - 2026-08-23

- Registry compatibility mode is ACTIVE BY DEFAULT (Amendment 46, operator order): an unset ODIN_GOVDISP_REGISTRY_MCP enables the registry MCP surface (48 tools plus the odin://registry/{scope}/events resource template), the registry-mode validator branches, and the odin-watch FINDING_OPENED emission; ODIN_GOVDISP_REGISTRY_MCP=0 (or any non-truthy value) is the explicit opt-out returning byte-baseline behavior. The WAVE-4 deferral now applies to prose retirement only, not to registry activation.
- Fold session jurisprudence JUR-015..020 and the GOVDISP-REGISTRY-AUTHORITY re-scoping region into the three doctrine copies (additive, byte-identical mirrored regions).
- Bump SCP public version to 0.6.0 across doctrine headers, package metadata, plugin manifests, and docs; MIN_COMPATIBLE_CHILD_MCP unchanged at 0.4.5.
- Minimal registry-mode annotations on receipt schemas and role cards ("typed events are authority; this document is transport").

## 0.5.0 - 2026-06-12

- Added role cards for all five roles (exec-pm, team-pm, dev-worker, qa-worker, exec-asst) with tiered uptake support and `odin.get_role_card` MCP tool.
- Cache-aligned packet ordering with hash-pinned re-arm: startup packets now include a content hash; re-arm requests are rejected unless the hash matches the cached packet.
- Enforced no-bare-header rule: protocol resources must include a top-level header before any content block.
- Added Crush pacing guidance: recommended token budget, pacing cadence, and harness-specific polling recommendations for Crush harness operators.
- Hybrid Mission/surfaces topology with substrate capability tiers: surface layout now distinguishes human-CMUX, tab-only, and headless substrate types with per-tier capability declarations.
- ODIN-watch wake analyzer for cmux and tmux: deterministic wake analysis to identify stalled surfaces, missed heartbeats, and polling overruns.
- Harness pacing telemetry: optional session-report fields for pacing cadence, token consumption rate, and harness-level timing data.
- Lattice design doc: canonical reference for the knowledge-lattice substrate used by ODIN Sentinel protocol resources.
- Server now exposes 28 MCP tools and 18 MCP resources.

## 3.6.0 - 2026-05-11

- Added `EXEC PM is the sole staffing authority` and `EXEC PM is the sole CMUX surface custodian` to Non-Negotiables. TEAM PMs and workers cannot staff, split, move, or close surfaces.
- Added Surface Layout Custodianship section with the canonical packing rule (max 2 surfaces per column, equal column widths, Team A in column 0, A alone in the tall column when team count is odd >= 3) and reference layouts N=1..8.
- Added Pre-Staffing Gate referencing `odin.compute_surface_layout` and `odin.compute_surface_layout_gate` MCP tools.
- Added ODIN Intervention Authority section: binding HALT directives, halt triggers, receiving-role obligations, 1/2/3-missed-heartbeat escalation ladder, 70%/90% context window budgeting.
- Added staffing audit fields to `SCP_BOOT_RECEIPT` for non-exec roles: `staffed_by`, `parent_surface_ref`, `column_index`, `team_letter`. `staffed_by != A/EXEC-PM` is halt-eligible.
- Added Meta-Governance Recursion section explaining the Dev/QA recursion: TEAM PM = Dev of org strategy, A/EXEC-PM = dispatcher, ODIN = QA of org strategy with binding intervention authority.

## 3.5.1 - 2026-04-30

- Made `scripts/sync-installations.sh` portable by replacing user-specific absolute install paths with `$HOME`-derived defaults.
- Kept `SCP_SKILL_MASTER` and added optional `SCP_SKILL_TARGETS_FILE` / `SCP_ADAPTER_TARGETS_FILE` overrides for nonstandard installations.
- Preserved native target and adapter marker verification behavior.

## 3.5.0 - 2026-04-30

- Added SemVer frontmatter (`version: 3.5.0`) and `updated` metadata to the SCP skill.
- Made the SCP skill, adapters, and canonical introduction prompt generic for any repository.
- Standardized default startup as executive office plus one development pod unless the user or handoff overrides it.
- Standardized ODIN role naming, ODIN mesh startup, and 10-minute round-robin health/status cadence.
- Added explicit closeout modes for continuity parking versus full session shutdown.
- Recorded default model/harness profile and fallback ladder for executive and development pod roles.
