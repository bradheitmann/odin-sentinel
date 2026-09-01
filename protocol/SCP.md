# ODIN Sentinel Coordination Protocol

Version: 0.6.0

SCP_PUBLIC_VERSION: 0.6.0
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

<!-- BEGIN SCP-AMENDMENT GOVEDGE-DEPENDENCY-AUDIT -->
**Doctrine amendment (GOVEDGE-DEPENDENCY-AUDIT): fail-closed dependency audit on the publish path (source: STORY-GOVTRUTH-R6).** The publish path carries a fail-closed dependency audit with severity floor `high`: the repository's `validate` chain runs the audit gate, and `prepublishOnly` runs `validate`, so a tree carrying an unaccepted high-severity advisory cannot be published. Every accepted advisory is recorded in a reviewed exception manifest carrying an owner, an expiry, and a rationale per entry; the manifest is validated BEFORE the audit runs, and a malformed, expired, or over-horizon entry fails the gate on its own, whether or not the advisory it names is present in the tree.
<!-- END SCP-AMENDMENT GOVEDGE-DEPENDENCY-AUDIT -->

## Principles

- Visible role slots are the audit surface.
- ODIN roles are meta-control roles accountable to user authority.
- PM roles coordinate delivery but do not own ODIN oversight.
- Worker roles implement bounded scope and produce evidence.
- QA roles verify independently and do not accept their own work.
- Closure independence and identity comparisons are machine-enforced and fail-closed, with named refusals.
- Handoffs, closeout, and restart packets must be explicit.
- Secrets are never printed or embedded in receipts.
- Delegation is native to the server and must not require an external extension.
- Staffing and surface custodianship are the sole authority of A/EXEC-PM.

<!-- BEGIN SCP-AMENDMENT GOVEDGE-CLOSURE-INDEPENDENCE -->
**Doctrine amendment (GOVEDGE-CLOSURE-INDEPENDENCE): closure independence is machine-enforced (source: STORY-GOVTRUTH-R2; qa-independence resource).** Closure independence is not an honor-system rule: `odin.validate_closure_independence` actively checks every closure claim and fails closed. The `SLICE_QA_PASS` and `HOLDOUT_ACCEPTED` verdicts must be emitted by two canonically DISTINCT seats; one seat signing both verification lanes is refused as `CLOSURE_LANE_COLLAPSE`, because the receipt would claim two independent verifications where only one party ever examined the work. A verdict emitted by the implementer's own lane is refused as `CLOSURE_SELF_REVIEW`; a verdict emitted by the closing authority's lane is refused as `CLOSURE_SELF_ASSERTION`; a verdict whose `emitted_by` is not a readable canonical slot (absent, null, empty, whitespace-only, or outside the canonical alphabet) is refused as `EMITTER_IDENTITY_INVALID`; an `implementer_lane` or `closing_authority` that is present but not a readable slot is refused as `CLOSURE_PARTY_IDENTITY_INVALID`, because the independence comparison itself cannot be trusted against an unreadable party. An unreadable emitter is never treated as "not matching, therefore independent": it is invalid input refused by name, and two unreadable emitters are never two distinct parties. Every comparison runs on canonical slot identity, so a respelled seat (case, separators, surrounding whitespace, a Unicode hyphen, or a zero-width character) is the SAME seat and cannot pose as a second party.
<!-- END SCP-AMENDMENT GOVEDGE-CLOSURE-INDEPENDENCE -->

<!-- BEGIN SCP-AMENDMENT GOVEDGE-ROLE-IDENTITY -->
**Doctrine amendment (GOVEDGE-ROLE-IDENTITY): canonical role-slot identity at every authority decision (source: STORY-GOVTRUTH-R1; rulings R1-CANON-1 and R1-CANON-2 / EXEC-Q-001).** Every authority decision — closure independence, self-issue checks, staffing and emitter comparisons — compares CANONICAL role-slot identity, never raw strings. The ruled canonicalization (R1-CANON-1) is exactly: Unicode NFKC normalization, then zero-width/format-character stripping, then Unicode-whitespace folding, then a hyphen-class fold of EXACTLY U+2010 HYPHEN and U+2011 NON-BREAKING HYPHEN to ASCII hyphen-minus. All other dash punctuation — U+2012 FIGURE DASH, U+2013 EN DASH, U+2014 EM DASH, U+2015 HORIZONTAL BAR, U+2212 MINUS SIGN — survives NFKC outside the canonical alphabet and REFUSES fail-closed; broad dash-range folding is prohibited. U+FF0D FULLWIDTH HYPHEN-MINUS and U+FE63 SMALL HYPHEN-MINUS are LEGAL (R1-CANON-2 / EXEC-Q-001): the mechanism governs, not a character enumeration — NFKC itself folds them to ASCII hyphen-minus before the alphabet check, and no pre-NFKC blocklist exists or may be added. Symmetry is required: any refused form also fails self-issue equality in both directions and reflexively, so an unparseable identity can never satisfy a comparison from either side. Team prefix and lane number remain identity: B/DEV-1 and B/DEV-2 are different seats, as are A/EXEC-PM and B/EXEC-PM.
<!-- END SCP-AMENDMENT GOVEDGE-ROLE-IDENTITY -->

<!-- BEGIN SCP-AMENDMENT GOVDISP-REGISTRY-AUTHORITY -->
**Doctrine amendment (GOVDISP-REGISTRY-AUTHORITY): registry authority under compatibility mode (source: STORY-GOVDISP-005; Amendment 46: default-ON as of 0.6.0).** Registry compatibility mode is ACTIVE BY DEFAULT as of 0.6.0 (Amendment 46, operator order): an unset ODIN_GOVDISP_REGISTRY_MCP activates the registry MCP surface, the registry-mode validator branches, and the odin-watch FINDING_OPENED emission; setting ODIN_GOVDISP_REGISTRY_MCP=0 (or any non-truthy value) is the explicit opt-out and returns byte-baseline behavior. Under registry compatibility mode, typed registry events are AUTHORITY for governance facts (blockers, attempts, verdicts, receipts); in-pane prose receipts are transport and history. A single fact is never independently editable in two authorities (GD-FP-013). Rendered registry views are PROHIBITED by default — an explicit human request binds requested_by plus the registry digest — and live CMUX surfaces remain the default human view (GD-DEC-012). The WAVE-4 deferral applies to PROSE RETIREMENT only (still deferred: prose retirement occurs only after WAVE-4 independent PASS and an owner activation event); registry ACTIVATION is not deferred — it is the default as of 0.6.0.
<!-- END SCP-AMENDMENT GOVDISP-REGISTRY-AUTHORITY -->

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

<!-- BEGIN SCP-AMENDMENT JUR-001 -->
**Doctrine amendment (JUR-001): Two-phase resequencing (source: Amendment 34).** Any resequencing of in-flight orders is two-phase: first a bare HOLD to the affected seat and an acknowledgment from its responsible PM, then the resequencing order itself. Resequencing orders that race un-acknowledged holds are void.
<!-- END SCP-AMENDMENT JUR-001 -->

<!-- BEGIN SCP-AMENDMENT JUR-002 -->
**Doctrine amendment (JUR-002): Originals, not excerpts (source: Amendment 37).** Provisioning grants verifiable ORIGINALS — byte-identical copies or explicit read-path grants — never control-plane-authored excerpts or summaries as authority. Every packet names which checkout each cited path lives in. A seat refusing unverifiable authority and offering an honest alternative is executing doctrine, not obstructing it.
<!-- END SCP-AMENDMENT JUR-002 -->

<!-- BEGIN SCP-AMENDMENT JUR-003 -->
**Doctrine amendment (JUR-003): Control-plane packet discipline (source: Amendment 38 addenda).** Before transmission, the control plane executes every mandated packet command verbatim from the packet's stated cwd, and satisfiability-reviews every fill-field and precondition. Receivers who find a requirement unsatisfiable FLAG it back; satisfying it cosmetically (stale evidence, placeholder values) is a violation.
<!-- END SCP-AMENDMENT JUR-003 -->

<!-- BEGIN SCP-AMENDMENT JUR-008 -->
**Doctrine amendment (JUR-008): Verbatim binds evidence, not choreography (source: Amendment 38 addenda).** Byte-verbatim discipline binds EVIDENCE-BEARING artifacts: receipts, summaries, gate outputs, verdicts. Choreography relay and trigger lines tolerate terminal-punctuation normalization only; any word, ordering, or content change in a preauthorized relay requires a ruling before delivery.
<!-- END SCP-AMENDMENT JUR-008 -->

<!-- BEGIN SCP-AMENDMENT JUR-009 -->
**Doctrine amendment (JUR-009): GATES_INVALIDATED_BY_EDIT (source: W0B ruling, Amendment 38).** Any edit after a gate's output invalidates that gate. The seat declares GATES_INVALIDATED_BY_EDIT and re-runs the full gate sequence bound to the new digest before any readiness claim.
<!-- END SCP-AMENDMENT JUR-009 -->

<!-- BEGIN SCP-AMENDMENT JUR-010 -->
**Doctrine amendment (JUR-010): Tolerated-deviation boundary (source: Amendment 38 addenda).** On a seat's own non-mandated exploratory commands, appended read-only diagnostic suffixes that preserve semantics are tolerated. Any deviation that alters a command's semantics is a deviation requiring a ruling.
<!-- END SCP-AMENDMENT JUR-010 -->

<!-- BEGIN SCP-AMENDMENT JUR-011 -->
**Doctrine amendment (JUR-011): Exactness includes output plumbing (source: Amendment 39 addenda).** On MANDATED commands, exact means exact: no prefix, suffix, pipe, or plumbing of any kind — including exit-echo suffixes that print the status while masking the invocation's return code. Visibility in text is not a substitute for the status channel the stop-rule rides on.
<!-- END SCP-AMENDMENT JUR-011 -->

<!-- BEGIN SCP-AMENDMENT JUR-013 -->
**Doctrine amendment (JUR-013): Relay blocks are self-contained (source: Amendment 39 addenda).** Every relayed instruction block carries its own gating and stop conditions. The control plane never relies on outer-instruction context the receiving seat cannot see.
<!-- END SCP-AMENDMENT JUR-013 -->

<!-- BEGIN SCP-AMENDMENT JUR-015 -->
**Doctrine amendment (JUR-015): Pinned-bundle immutability (source: Amendment 39 addenda).** A pinned input bundle is IMMUTABLE from the moment its activation packet issues. Any post-dispatch addition requires a correction packet carrying the new entry count and the manifest hash, delivered before the seat's next pin action. A seat whose pin check mismatches the packet's stated count stops and reports; the mismatch is a control-plane fault by default.
<!-- END SCP-AMENDMENT JUR-015 -->

<!-- BEGIN SCP-AMENDMENT JUR-016 -->
**Doctrine amendment (JUR-016): Explicit hold supersession (source: Amendment 39 addenda).** While an observer hold is active on a seat, a control-plane instruction to that seat requires either an explicit, named lift of that hold acknowledged by the observer, or a declared single-authority mode whose declaration reaches the observer before the next seat contact. Supersession is never implicit. When authority-plane packet races cause repeated freeze/lift thrash on one seat, single-authority mode is the prescribed resolution: one choreography authority until the work unit completes, observers passive except for hard-integrity events.
<!-- END SCP-AMENDMENT JUR-016 -->

<!-- BEGIN SCP-AMENDMENT JUR-017 -->
**Doctrine amendment (JUR-017): Quote-safe packets; command evidence as pinned files (source: Amendment 39-40 addenda).** Mesh packets are composed and relayed through shells: embedded backticks, dollar-paren substitution, and unescaped expansions are live injection vectors at every relay hop. Command literals in packets travel in quote-safe form only. Verbatim command evidence — anything whose exact bytes matter — travels as pinned files with hashes, never inline: transport renderings of inline literals are not authoritative and have been observed to corrupt in both directions.
<!-- END SCP-AMENDMENT JUR-017 -->

<!-- BEGIN SCP-AMENDMENT JUR-018 -->
**Doctrine amendment (JUR-018): Full-validate closure gate; allowlists travel with anchors (source: Amendments 43 addenda).** Closure merges verify with the repository's FULL validation pipeline — including packaging and release-sync checks — not a test-and-audit subset; a latent release-blocking drift survived three closure merges under the subset gate and was caught only by a sealed exam. Corollary at authoring time: enumerating artifacts (allowlists, class lists, family enumerations) travel together with their anchor fixtures and negative fixtures — any contract extending one pre-includes the others.
<!-- END SCP-AMENDMENT JUR-018 -->

<!-- BEGIN SCP-AMENDMENT JUR-019 -->
**Doctrine amendment (JUR-019): Completion pings (source: Amendment 45-era addenda).** Completion is push-based: every activation packet ends with a completion-ping step — on reaching readiness, verdict, or a stop-report, the seat itself notifies the control plane's surface directly with a one-line [DONE] message. Report-in-pane-and-wait is transport history, not notification; pull-based supervision (polls, ticks) is the backstop, never the clock.
<!-- END SCP-AMENDMENT JUR-019 -->

<!-- BEGIN SCP-AMENDMENT JUR-020 -->
**Doctrine amendment (JUR-020): Raw trace precedes exam freezes (source: Amendment 39-40 addenda).** Screen inference alone is insufficient grounds to freeze a sealed-exam seat. Raw-trace verification precedes any exam-seat freeze except an index or worktree mutation visibly in progress. Observer false alarms are corrected without fault — aggressive-but-correcting is the right failure direction — but the trace-first order makes the false positive cost a trace read instead of an interrupted exam.
<!-- END SCP-AMENDMENT JUR-020 -->

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

<!-- BEGIN SCP-AMENDMENT GOVEDGE-SENTINEL-HYGIENE -->
**Doctrine amendment (GOVEDGE-SENTINEL-HYGIENE): sentinel input hygiene is strict (source: STORY-GOVTRUTH-R5; ruling R5-TRIGGER-1).** The slice-health sentinels are ADVISORY-ONLY and remain so; their credibility is protected by fail-closed input hygiene: a sentinel that was told nothing says nothing — insufficient input yields NO finding, never a default-shaped one. The three timeout fields — `base_seconds`, `per_file_seconds`, `max_seconds` — are required together, finite, and STRICTLY positive; zero and negative values are invalid input, not measurements. The coherence rule is named `max_seconds_gte_base_seconds`: the ceiling must be at or above the floor, and `max_seconds == base_seconds` is a coherent, VALID boundary (a flat window whose ceiling equals its floor). The identifier rule is named `non_empty_after_trim`: an empty or absent identifier yields no signal, and the sentinel never invents a placeholder reference. The QA-window sentinel's firing condition is the ceiling-binds test per ruling R5-TRIGGER-1: it fires when `base_seconds + per_file_seconds * review_file_count` exceeds `max_seconds`, so the window cannot scale to the review. Invalid input yields null on a direct library call and a NAMED rejection at the MCP boundary, and no zero or negative window value is ever rendered into operator-facing text.
<!-- END SCP-AMENDMENT GOVEDGE-SENTINEL-HYGIENE -->

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

<!-- BEGIN SCP-AMENDMENT JUR-004 -->
**Doctrine amendment (JUR-004): RECEIPT_IS_A_TURN (source: Amendment 38 addenda).** The boot receipt is an entire turn: on turn-gated harnesses, a response containing the fenced receipt and nothing else — zero tool calls — followed by an explicit wait; on tool-inclusive-turn harnesses, no actions beyond the mandated pre-receipt steps, the receipt as turn-terminal output, and no work until the proceed relay. Turn-gated harnesses use the three-relay form: activation packet, receipt trigger, proceed relay — all relay texts preauthorized verbatim.
<!-- END SCP-AMENDMENT JUR-004 -->

<!-- BEGIN SCP-AMENDMENT JUR-005 -->
**Doctrine amendment (JUR-005): Same-run model verification (source: Amendment 38 addenda).** Where raw model identity is only observable after a first response, the packet carries the EXPECTED model literal and the receipt is verified against its own response's raw responseModel. Harness footers and metadata are not the truth standard; raw traces are. A mismatch is a no-fault re-emission with a corrected literal, not a seat fault.
<!-- END SCP-AMENDMENT JUR-005 -->

<!-- BEGIN SCP-AMENDMENT JUR-006 -->
**Doctrine amendment (JUR-006): Raw trace governs (source: Amendment 38 addenda).** On any conflict between an agent's self-report and the raw session trace, the trace adjudicates. Stale freezes are rescindable by timestamp order: a freeze arriving after the seat's own correction is stale-by-timestamp and carries no attempt accounting.
<!-- END SCP-AMENDMENT JUR-006 -->

<!-- BEGIN SCP-AMENDMENT JUR-012 -->
**Doctrine amendment (JUR-012): Exam-tier context isolation (source: Amendment 39 addenda).** Exam and worker-tier activation packets explicitly preempt the skill-read reflex: the provisioned contract is the seat's ENTIRE protocol context; SKILL.md, role cards, and protocol source reads are control-plane-tier only. The skill's read-at-boot cadence does not apply to sealed exam seats.
<!-- END SCP-AMENDMENT JUR-012 -->

<!-- BEGIN SCP-AMENDMENT JUR-014 -->
**Doctrine amendment (JUR-014): Launch roots and lane lifecycle (source: Amendment 39-40 addenda).** Occupant cycling never refreshes a harness's launch cwd: when a seat's lane changes or its launch root is removed, the occupant is relaunched from the lane root, not cycled in place. While any seat actively holds a lane, observers verify via passive file reads and raw-trace inspection only; git commands against that lane's index wait for seat idle.
<!-- END SCP-AMENDMENT JUR-014 -->

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

<!-- BEGIN SCP-AMENDMENT GOVEDGE-HARNESS-IDENTITY -->
**Doctrine amendment (GOVEDGE-HARNESS-IDENTITY): harness ids are exact-match fail-closed (source: STORY-GOVTRUTH-R4).** A canonical harness id is an exact snake_case machine id — `claude_code`, `droid`, `opencode` — matched EXACTLY, never case-folded, trimmed, or otherwise transformed. Human-friendly names travel only on the explicit `display_name` channel each harness entry declares; a display name is never inferred from an id. Resolution accepts exactly two spellings per harness — the exact canonical id or the exact declared display name — and refuses every other spelling rather than normalizing it: a string that is not in canonical snake_case form where a canonical id is required is refused as `non_canonical_harness_id`, and an intended harness that resolves to no entry by exact id or exact display name is refused as `unknown_or_non_canonical_harness`. Both refusals are THROWN — the call stops with a named error; there is no degraded row and no warning-only pass. Worked example: the Droid entry declares `harness_id: droid` and `display_name: "Droid"`, so writing `droid` or `Droid` in a harness list resolves, while `DROID`, a padded `Droid` with stray whitespace, or any other respelling is a thrown refusal instead of a row. Compose harness lists from the declared ids and display names verbatim.
<!-- END SCP-AMENDMENT GOVEDGE-HARNESS-IDENTITY -->

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

<!-- BEGIN SCP-AMENDMENT GOVEDGE-FAILCLOSED-TRANSITIONS -->
**Doctrine amendment (GOVEDGE-FAILCLOSED-TRANSITIONS): rollover, bring-up, and escalation are fail-closed (source: STORY-GOVTRUTH-R3; blocked-pod-rollover, pod-bringup, and step-up-ladder resources).** Blocked-pod rollover proceeds to `SPIN_NEXT_TEAM` only when the blocked pod is BOTH paused and state-preserved (worklist, receipts, and scope survive for resume); any unmet precondition returns `ESCALATE_OPERATOR`, never a proceeding decision with a note appended, and every unmet precondition is reported, not only the first. Restaff framing is never a bypass: a rollover framed as a re-staff is non-proceeding at every row of the decision table, even when both preconditions hold. Pod bring-up requires `stop_triggers` to be EXACTLY the canonical set `["TARGET_ARTIFACT_WRONG"]`, rejected against the raw input before any filtering — a malformed element (absent, null, an empty array, a bare scalar, an object, a non-string element, a duplicate, or a non-canonical member) is refused by name, never silently discarded. The step-up ladder's `REMEDIATE` verdict identifies the remediation-packet fields it governs BY FIELD NAME — `task_ref`, `tier_index`, `artifact_paths`, `failure_reason`, `failed_gate`, `acceptance_bar`, `next_tier_index`, `review_lane_tier_index` — one requirement per required field and no requirement without a field, so a seat holding only the requirement strings can build a packet the validator accepts. No sentence in this doctrine asserts a state the evaluator does not require.
<!-- END SCP-AMENDMENT GOVEDGE-FAILCLOSED-TRANSITIONS -->

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

<!-- BEGIN SCP-AMENDMENT JUR-007 -->
**Doctrine amendment (JUR-007): QA index protection (source: Amendment 38 addenda).** QA contracts carry three mandatory sections: an INDEX IS EVIDENCE preamble (the candidate already exists as the staged index; the QA seat verifies and never creates, completes, or repairs it; all index- and worktree-mutating git forms are prohibited by name; git write-tree is the sole permitted index reader), an exhaustive READ ALLOWLIST, and a scratch policy (scratch lives in the QA evidence directory or in pipes; out-of-repo scratch of lane-derived non-secret data is tolerated-with-note at most).
<!-- END SCP-AMENDMENT JUR-007 -->
