# ODIN Sentinel Coordination Protocol

Version: 0.4.9

SCP_PUBLIC_VERSION: 0.4.9
MIN_COMPATIBLE_CHILD_MCP: 0.4.5

ODIN Sentinel is a portable coordination layer for visible multi-agent teams.
SCP means Sentinel Coordination Protocol in this repository. It is not Secure
Copy.
It provides generic role contracts, startup packets, receipt validation, team
manifest validation, native visible-role delegation packets, closeout
checklists, surface layout rules, and fallback protocol snapshots through an
MCP server.

## Public Release And Readiness

Public repo, npm package, plugin, bootstrap skill, templates, and docs must be updated together when public protocol semantics change. Private local skill copies may differ intentionally, but release checks must not depend on private local paths. Governed team mode requires CMUX; without CMUX, ODIN may still expose MCP resources and validation tools, but the visible team-management experience is not active governed mode. MCP supplies tools/resources; native skills improve automatic invocation; plugin install paths may package both; full prompt injection is fallback only.

## Principles

- Visible role slots are the audit surface.
- ODIN roles are meta-control roles accountable to user authority.
- PM roles coordinate delivery but do not own ODIN oversight.
- Worker roles implement bounded scope and produce evidence.
- QA roles verify independently and do not accept their own work.
- Handoffs, closeout, and restart packets must be explicit.
- Secrets are never printed or embedded in receipts.
- Delegation is native to the server and must not require an external extension.
- Staffing and surface custodianship are the sole authority of A/EXEC-PM.

## Startup Defaults

Fresh startup creates an executive office and one development pod unless the
user or a handoff requests another topology.

## Surface Layout

CMUX surface organization is contractually fixed by `surface_layout` in
`topology.yaml` and the `odin.compute_surface_layout` tool. All columns are
equal width. At most two surfaces stack inside any column. Team A always
occupies column 0; when the team count is odd and at least 3, column 0 holds
only Team A (the tall column). EXEC PM must call
`odin.compute_surface_layout` (and its gate variant) before any spawn beyond
A/EXEC and must reach the target layout via CMUX splits before dispatching.

## Activation Gates

Two activation gates must be satisfied before an activated role acts under SCP. They
address two repeatable failure modes: CMUX text that was typed but never submitted, and
agents that read only the beginning of their instructions.

CMUX delivery proof. A CMUX dispatch is not delivered until the sender submits the text
with Enter and verifies processing on the target surface. Text sitting in an input bar is
`INPUT_BAR_ONLY`, not delivery. A delivery proof records `target_surface_locator`,
`submitted`, `verification_method`, `observed_processing_state`, `timestamp`, and
`sender_role`. Validate it with `odin.validate_cmux_delivery_proof`.

Full-instruction-read proof. Before implementation, QA acceptance, or ACTIVE_WATCH work, an
activated role must produce a full-instruction-read proof listing each required instruction
file with its byte or line count and a SHA-256 digest. First-screen, head, or partial reads
are insufficient. Verify a proof against local files with
`scripts/protocol/verify-instruction-read.mjs`, install the precheck hook with
`scripts/protocol/install-activation-hooks.mjs`, and read the consolidated requirements from
`odin.get_activation_gates`. Validate proof shape with `odin.validate_instruction_read_proof`.

## Harness Readiness Probes

Installed is not provisioned. Before assigning a governed role, probe each harness and record
multi-dimensional readiness — `installed_binary`, `authenticated`, `mcp_configured`,
`mcp_tool_hydration`, and `governed_role_ready` — never a single boolean. Classify first-run
permission prompts (`BLOCKED_BY_PERMISSION`), login/account prompts (`BLOCKED_BY_LOGIN`), missing
inference credentials (`BLOCKED_BY_API_KEY` / `AUTH_PROVIDER_BLOCKED` / `BLOCKED_BY_AUTH`), and local
inference stalls (`MODEL_STALLED` / `MODEL_REASONING_ONLY` / `STREAMING_PROTOCOL_MISMATCH`) before
launch. A harness without MCP, native SCP skill, or full injected protocol text is
`NON_GOVERNED_ONE_SHOT_ONLY` and must not hold a persistent governed role. Skill-capable harnesses
should install the sentinel-coordination-protocol skill before governed launch. Probe via
`odin.get_harness_probe_matrix` with zero-secret output. Droid exposes `droid mcp` and
`--auto <low|medium|high>`: read-only `droid exec` is allowed without write authority, but mission
or high-autonomy work requires `--auto high`. Crush has no MCP management command and its auth-header
failures are auth blockers, not readiness.

## Closeout Defaults

Closeout supports two modes:

- `PARK_FOR_CONTINUITY`: keep role slots open and park occupants.
- `FULL_SESSION_SHUTDOWN`: quit occupants, verify exit, and close panes except
  the final user-designated surface.

## Meta-Governance

ODIN Sentinel applies the same Dev/QA contract that governs code execution to
the execution of organizational strategy itself.

In code work:

- DEV implements bounded scope and produces evidence.
- QA verifies independently and does not accept their own work.
- TEAM PM routes tasks to workers; A/EXEC-PM authorizes and frames claims.

In organizational work:

- TEAM PM is the Dev of org strategy. It implements the staffing, surfaces,
  and delegations issued by A/EXEC-PM (subject to the constraint that TEAM PM
  cannot self-staff).
- A/EXEC-PM is the dispatcher of org strategy. It issues the org orders and
  owns staffing and surface custodianship exclusively.
- ODIN agents are the QA of org strategy. They audit whether A/EXEC-PM's org
  orders are executed correctly, whether surface custodianship is honored,
  whether protocol adherence holds, whether context windows are healthy, and
  whether contracts remain accountable.

ODIN agents hold intervention authority. When A/EXEC-PM, any TEAM PM, or any
worker violates the contract (staffing without the surface gate, hidden agent
creation, same-role QA acceptance, context window over hard threshold without
compaction), the supervising ODIN role MAY issue a HALT directive. The
receiving role is contractually obligated to honor the HALT and reply with a
remediation plan before resuming. Continuing past a HALT without remediation
is itself a protocol breach.

This recursion is why the same protocol governs both code work and
organizational work without growing new vocabulary.
