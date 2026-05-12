# ODIN Sentinel Coordination Protocol

Version: 0.4.5

SCP_PUBLIC_VERSION: 0.4.5
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
