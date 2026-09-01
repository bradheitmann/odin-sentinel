# Changelog

## Unreleased

- Dependency audit now runs on the publish path: `scripts/audit/dependency-audit.mjs` joins the `validate` chain as `audit:deps`, so `prepublishOnly` fails closed and a tree carrying an unaccepted high-severity advisory cannot be published. Accepted advisories are recorded in `scripts/audit/audit-exceptions.json` with an owner, an expiry, and a rationale per entry; the manifest is validated before the audit runs and a malformed or expired entry fails the gate on its own.
- CI's audit floor moves from `pnpm audit`'s default (`low`) to `high`. This is a deliberate loosening of CI strictness, paired with the new fail-closed publish-path gate and its exception manifest: CI no longer breaks on low-severity advisory churn, while the release path gains a check it previously had none of. Both workflows now call the single gate script instead of duplicating a bare `pnpm audit` step.
- BREAKING: harness names are exact-match fail-closed. A harness list entry that previously produced a best-effort or degraded row now THROWS a named refusal: a spelling that is not exact canonical snake_case where a canonical id is required is refused as `non_canonical_harness_id`, and a name matching no entry's exact canonical id or exact declared `display_name` is refused as `unknown_or_non_canonical_harness`. An input that worked by loose matching — `DROID`, a trailing-space `Droid`, a typo in a harness list — now stops the call instead of returning a row. Compose harness lists from the declared ids and display names verbatim (`droid` or `Droid`, nothing else).
- BREAKING: closure requires two canonically distinct emitters. A closure claim whose `SLICE_QA_PASS` and `HOLDOUT_ACCEPTED` verdicts come from one emitting seat — under ANY respelling of that seat — is refused as `CLOSURE_LANE_COLLAPSE`; implementer-emitted and closer-emitted verdicts are refused as `CLOSURE_SELF_REVIEW` and `CLOSURE_SELF_ASSERTION`; an unreadable emitter or party identity is refused as `EMITTER_IDENTITY_INVALID` or `CLOSURE_PARTY_IDENTITY_INVALID` rather than passing as "different strings". Closure inputs that previously passed because the same seat signed both lanes under two spellings now fail by name.
- BREAKING: role-identity comparison is strict and fail-closed. Authority decisions compare canonical role-slot identity (NFKC, zero-width/format strip, Unicode-whitespace fold, and a hyphen-class fold of exactly U+2010 and U+2011); every other dash-punctuation spelling (U+2012, U+2013, U+2014, U+2015, U+2212) now REFUSES as unparseable instead of being folded or compared raw. Identities that previously matched via loose comparison, or slipped through as "distinct" via a respelling, are now refusals; a refused form also fails self-issue equality in both directions.
- BREAKING: sentinel inputs are strictly validated and insufficient input yields no finding. `base_seconds`, `per_file_seconds`, and `max_seconds` must all be present, finite, and strictly positive, with `max_seconds >= base_seconds` (`max_seconds_gte_base_seconds`; the equal boundary is valid); identifiers must be non-empty after trimming (`non_empty_after_trim`). A legacy flat or zero-padded timeout policy, or a missing identifier, that previously produced a defaulted finding now yields NO finding on a direct library call and a named rejection at the MCP boundary.

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
