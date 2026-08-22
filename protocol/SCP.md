# ODIN Sentinel Coordination Protocol

Version: 0.5.0

SCP_PUBLIC_VERSION: 0.5.0
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

<!-- BEGIN SCP-AMENDMENT RET-006 -->
**Doctrine amendment (RET-006): owner-queue admission criteria.** A decision enters the human owner's queue only when it crosses at least one admission threshold: architecture or public-protocol shape change; irreversible or hard-to-reverse effect (deletion, publication, force-push, schema or lifecycle migration); acceptance of a security or privacy risk; credential, secret, billing, or quota change; or a GO decision over a live corpus or production surface. Reversible, in-scope routing, sequencing, and staffing-internal coordination below those thresholds are decided by the responsible PM without queueing the owner. PMs must neither push below-threshold decisions onto the owner queue nor hold above-threshold decisions in their own lane.
<!-- END SCP-AMENDMENT RET-006 -->

<!-- BEGIN SCP-AMENDMENT RET-010-REL-005 -->
**Doctrine amendment (RET-010/REL-005): risk-tiered handoff depth.** Handoff depth scales with the unique knowledge and authority at risk, not with a uniform template. A handoff is HIGH-RISK when the sender holds unique, authoritative, or unreconstructed context (sole knowledge of a decision rationale, uncommitted state, live credential scope, or an in-flight irreversible action). HIGH-RISK handoffs must carry full decision rationale, open loops, exact resume or reproduction commands, and named blockers. Routine, reversible handoffs over recoverable context may use the standard minimal handoff format. Sending a minimal handoff for HIGH-RISK context is a handoff defect charged to the sender.
<!-- END SCP-AMENDMENT RET-010-REL-005 -->

<!-- BEGIN SCP-AMENDMENT RET-011 -->
**Doctrine amendment (RET-011): typed partial terminal record.** A failed synthesis layer must emit one typed partial terminal record, declaring executed scope, missing inputs, and partial reason, before any remediation retry is attempted.
<!-- END SCP-AMENDMENT RET-011 -->

<!-- BEGIN SCP-AMENDMENT DIS-001 -->
**Doctrine amendment (DIS-001): evidence economy.** No role may create one document or file per control-plane interaction; evidence accrues to one curated artifact per unit of work (session decision trace, slice evidence bundle, or audit ledger), appended or summarized, never fanned out per message. In-pane receipts (boot receipts, delivery proofs, dispatch acknowledgments) are control-plane signals, not documents, and remain required exactly as specified.
<!-- END SCP-AMENDMENT DIS-001 -->

## Startup Defaults

Fresh startup creates an executive office and one development pod unless the
user or a handoff requests another topology.

## ODIN Liveness Duty

ODIN roles use engine-push over agent-poll: the engine observes and pushes
liveness findings to the responsible visible role; worker agents do not run
self-poll loops. Liveness is established by artifact advancement, not animated
pixels. ODIN must inspect the current attempt directory for recent payloads
before classifying an unchanged quiet surface as idle, and must poll runner
liveness with a bounded `pgrep` probe. Spinner-active text with an unchanged
screen hash beyond the stale threshold and zero artifact advancement is a
`LIVENESS_MIMIC`, distinct from `WORKING`, and wakes ODIN for inspection.
The runner probe accepts only a complete normalized LF-separated list of
positive decimal PIDs, bounded to 4,096 UTF-8 bytes and 256 PIDs. Freshness
timestamps must be finite, non-negative, and within the JavaScript Date range;
the freshness window is bounded to 86,400,000 milliseconds. Mixed probe prose,
oversized output, invalid timestamps/windows, future payload timestamps, and
empty or non-normalized artifact revisions fail closed to a waking diagnostic
state and can never produce `WORKING` with `wake=0`.

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

Per-harness message format. Submit semantics are NOT uniform across harnesses, and Enter
alone does not make a delivery safe. Each harness declares a `submit_profile`:
`single_line_flatten` (submits on EVERY embedded newline — compose the message as ONE
line, flatten newlines/CR/tabs to single spaces, join fields with a separator such as
`" ;; "`; a multi-line message fires one prompt per line and jams the recipient),
`double_enter` (standard send plus a second Enter; a long paste during a busy transition
may need the second Enter to submit), or `single_enter_verify` (exactly one Enter followed
by a read-screen verify; a blind second Enter interrupts reply generation). The trigger
for the single-line rule is the embedded newline itself, not the number of send calls.
Senders should run a pre-dispatch dry-run (`dry_run: true` with `target_submit_profile`
and the payload) through `odin.validate_cmux_delivery_proof`; a multi-line payload aimed
at a `single_line_flatten` harness is invalid (`MULTILINE_TO_SINGLE_SUBMIT_HARNESS`) even
with `submitted: true`, unless the canonical helper flattened it first. Per-harness format
profiles ship in the harness-pacing seeds.

Roster continuity and failover. Role slots are durable; agent occupants are replaceable —
but never improvised. Each role declares a pre-staged fallback contract whose rungs pin the
substitute harness AND the required model + flags: "use harness X" inherits X's default
model, which can silently seat a non-agentic model in a control role. If no authorized
substitute exists, the action is PAUSE_ESCALATE, never invention. Failover triggers are
agent death, usage-cap exhaustion, and silent session-drop; provider billing errors are
operator-side (hold the seat, do not substitute or alarm). After any relaunch or
reconfiguration, re-verify the committed model from the status bar — model identity drifts.
The executive seat declares a successor contract (locked roster, in-flight worklist,
canonical hashes); roster mutation belongs solely to the operator or a Team-A EXEC, and
downstream ODINs report up, never negotiate roster laterally. For provider-wide mass
outages (one account exhausting takes out a cluster of seats), the dying contingent emits
an `[SCP-OUTAGE-HANDOFF]` receipt BEFORE going dark to a provider-diverse surviving
continuity seat, which opens a bounded, expiring SCP-EXCEPTION, covers critical roles from
unaffected seats, and reverts cleanly at recovery — no authority transfer by inertia.
Validate with `odin.validate_fallback_contract`, `odin.validate_successor_contract`, and
`odin.validate_outage_handoff`.

Pod bring-up ground truth. Launching a pod inside a target repo fires that repo's
SessionStart hooks, which can mutate it (archive files, regenerate status). Capture
ground truth AFTER the pod boots, not before, and frame preservation count-agnostically:
preserve ALL non-target dirty/untracked state whatever the count; the ONLY stop trigger
is a wrong TARGET artifact. Enumerated expected-state ("expect exactly 2 deletions")
turns any hook-side mutation into a false halt. Validate plans with
`odin.validate_bring_up_plan`.

Full-instruction-read proof. Before implementation, QA acceptance, or ACTIVE_WATCH work, an
activated role must produce a full-instruction-read proof listing each required instruction
file with its byte or line count and a SHA-256 digest. First-screen, head, or partial reads
are insufficient. Verify a proof against local files with
`scripts/protocol/verify-instruction-read.mjs`, install the precheck hook with
`scripts/protocol/install-activation-hooks.mjs`, and read the consolidated requirements from
`odin.get_activation_gates`. Validate proof shape with `odin.validate_instruction_read_proof`.

<!-- BEGIN SCP-AMENDMENT DIS-004 -->
**Doctrine amendment (DIS-004): digest-scope boundary.** SHA-256 digest binding applies to instruction and canonical files only (boot contracts, slice definitions, protocol texts, manifests, and declared evidence artifacts). Conversational artifacts (chat prose, transcripts, screen captures, rendered panes) must not be hashed, recounted, or treated as release binaries.
<!-- END SCP-AMENDMENT DIS-004 -->

## Harness Readiness Probes

Installed is not provisioned. Before assigning a governed role, probe each harness and record
multi-dimensional readiness — `installed_binary`, `authenticated`, `mcp_configured`,
`mcp_tool_hydration`, and `governed_role_ready` — never a single boolean. Classify first-run
permission prompts (`BLOCKED_BY_PERMISSION`), login/account prompts (`BLOCKED_BY_LOGIN`), missing
inference credentials (`BLOCKED_BY_API_KEY` / `AUTH_PROVIDER_BLOCKED` / `BLOCKED_BY_AUTH`), and local
inference stalls (`MODEL_STALLED` / `MODEL_REASONING_ONLY` / `STREAMING_PROTOCOL_MISMATCH`) before
launch. A harness without MCP, native SCP skill, or full injected protocol text is
`NON_GOVERNED_ONE_SHOT_ONLY` and must not hold a persistent governed role. Skill-capable harnesses
should install the odin-scp skill before governed launch. Probe via
`odin.get_harness_probe_matrix` with zero-secret output. Droid exposes `droid mcp` and
`--auto <low|medium|high>`: read-only `droid exec` is allowed without write authority, but mission
or high-autonomy work requires `--auto high`. Crush has no MCP management command and its auth-header
failures are auth blockers, not readiness.

## Governed Readiness Is Fail-Closed

Presence is not authority. MCP being configured, or an SCP skill existing on disk, never makes a
harness governed by itself — protocol **uptake** must be verified. Governed readiness is one of
four states, shared by `odin.get_harness_probe_matrix`, `odin.evaluate_readiness_gate`, and
`odin.get_onboarding_plan`: `GOVERNED_READY`, `FIXABLE_BLOCKED`, `NON_GOVERNED_ONE_SHOT_ONLY`,
`UNSUPPORTED`. `GOVERNED_READY` requires a verified control layer plus a proven protocol-uptake
receipt at an assurance adequate for the role, plus required hooks/validators, plus no unwaivable
auth/liveness blocker. Native-skill harnesses require verified native-skill uptake (prompt
injection is not persistent governed readiness for them); static-control-file harnesses require a
validated static source plus uptake; MCP-only harnesses require a proven-loaded bootstrap resource
plus uptake. PM and ODIN roles require the highest assurance the harness supports. A governed
occupant is hard-blocked from activation until its `governedReadiness` is `GOVERNED_READY`. Prove
uptake with `scripts/protocol/verify-governed-context.mjs` (a stable source marker, a disk checksum
when a path is present, and a matching uptake receipt); a self-reported boolean is rejected. See
`odin.get_activation_gates` for the governed-context proof contract.

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

<!-- BEGIN SCP-AMENDMENT DIS-003 -->
**Doctrine amendment (DIS-003): single audit per concern.** A settled judgment receives at most one independent audit per concern; re-auditing the same concern without a named, concrete contradiction in the prior audit is prohibited. Guard: the dual-verdict closure rule in protocol/resources/qa-independence.yaml is not a duplicate audit. SLICE_QA_PASS and HOLDOUT_ACCEPTED are audits of different concerns (slice hygiene: scope, evidence, lifecycle, branch and gate hygiene, acceptance criteria; versus sealed story behavior), they are structurally distinct, and both remain required for closure. This rule must not be read to merge, weaken, or substitute either verdict.
<!-- END SCP-AMENDMENT DIS-003 -->

<!-- BEGIN SCP-AMENDMENT DIS-008 -->
**Doctrine amendment (DIS-008): bounded meta-governance.** An audit of an audit is break-glass only: it requires ALL THREE of (1) a machine-recorded break-glass event in the durable audit ledger before the meta-audit opens, (2) explicit human authority approval, and (3) a named, concrete contradiction in the prior audit's findings or process. When any condition is absent, audit recursion terminates at the first completed audit; this is the terminating condition on the recursion described in this section.
<!-- END SCP-AMENDMENT DIS-008 -->
