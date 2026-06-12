# Changelog

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
