---
name: sentinel-coordination-protocol
description: "Operate and improve SCP governance for multi-agent teams: self-bootstrap and teardown of federated pods, generic role topology, TEAM PM / TEAM ODIN separation, minimal bootstrap receipts, terminal locator identity, control-plane non-implementation, delegation receipts, terminal/CMUX delivery proof and verdicts, heartbeat cadence, branch-visible claims, adversarial QA, finish audit, and safe skill dissemination. Use when introducing SCP v3.5; installing SCP skills/adapters for Codex, Claude Code, OpenCode, Droid, Crush, OpenHands, Goose, KiloCode, Cursor, Zed, Pi, or other local coding agents; assigning EXEC/TEAM/WORKER roles; or preventing premature activation from an uncommitted draft artifact."
version: 3.6.1
updated: 2026-05-11
---

# Sentinel Coordination Protocol

Use this skill for SCP policy introduction, repo landing, adoption-gate proof, controlled dissemination, active multi-agent control loops, and automated team lifecycle management. SCP is a governance layer for multi-team agent operation; it complements other coordination layers and `AGENTS.md` files where present. It sits above them after activation.

SCP_PUBLIC_VERSION: 0.4.9
MIN_COMPATIBLE_CHILD_MCP: 0.4.5

## Source Of Truth

Master editable source:

- the repository-distributed SCP protocol bundle, or an operator-declared canonical SCP skill source outside this public package.

All other installed copies are synchronized runtime snapshots, not independent policy forks. Any agent modifying SCP policy must edit the declared source first, then propagate the full skill/protocol bundle to the installed harness targets and verify matching hashes.

Use the operator-declared sync procedure after edits. Do not hand-edit generated runtime copies except as a temporary emergency patch that is immediately backported to the declared source and resynced.

Portable curated skill/session records may live under the declared source, for example `decisions/YYYY-MM-DD-<slug>.md` and optionally `CHANGELOG.md`. Raw audit evidence belongs under `.odin/audit/<session-id>/` or the declared `evidence_path`. Do not create empty folders just to satisfy policy; create `decisions/` only when writing the first curated decision record.

## Non-Negotiables

- Treat SCP packages or protocol bundles imported from Downloads, temp directories, external artifacts, narrative reports, or uncommitted checkouts as drafts until a repo-capable agent lands them under the canonical repo path and records proof.
- Do not activate SCP from Downloads, a temp directory, an uncommitted checkout, or a narrative report.
- Keep the pre-activation exception intact: the current `EXEC PM` may continue hands-on hygiene, planning, governance-artifact, and ledger-bootstrap work until the user or designated authority explicitly declares transition after the adoption gate clears. `codex-pm` is a legacy/session alias for a pane currently acting as `EXEC PM`; it is not a role name.
- Make every closure claim claim-bound. Lifecycle closure requires both branch-visible persistence and QA-accepted correctness.
- Require adversarial QA. A summary, spot-check, liveness check, or "looks good" is not QA acceptance.
- Keep agents interchangeable by role, not by blurred authority. Any supported harness may serve any role only after it has a clean boot block declaring the current role, write scope, branch, cwd, model/harness, and proof source. The same assignment must not QA and close its own work.
- Preserve strict scope. Governance/package work cannot mutate product code, Loop runtime, design prototypes, operational-team work product, or lifecycle state unless explicitly authorized.
- Use zero-secret-output behavior. Never print tokens, API keys, OAuth material, or config values. Report secret presence by name/count/status only.
- Under SCP, team topology is the audit surface. If work is not visible in CMUX, it is not governed work.
- Preserve official SCP team topology. Once `EXEC PM` has bootstrapped the executive office and pods, role-named CMUX panes/surfaces are immutable operating slots. Do not close, delete, rename, repurpose, or replace the slot itself unless the user explicitly authorizes that exact slot mutation.
- Treat agents as occupants of durable role slots. If a model/harness is blocked, stale, over budget, in plan mode, context-exhausted, or wrong for the task, clear, restart, exit, or substitute the agent occupant inside the existing role slot. Do not remove the CMUX pane/surface.
- Do not create extra panes, extra workers, hidden assistants, invisible subagents, or ad hoc capacity during an active SCP run unless the user explicitly authorizes topology expansion. `EXEC PM` must route work to official roles already present in CMUX.
- Do not use invisible internal subagents, hidden background forks, non-terminal model assistants, or `spawn_agent` while SCP is active. Delegation must be visible through CMUX/terminal surfaces, boot receipts, terminal locators, delivery proof, and ODIN polling.
- `$delegate` under SCP means governed visible delegation to an existing CMUX role slot. It does not authorize hidden model fan-out, off-ledger research, or new worker invention.
- Enforce model/harness diversity and cost discipline. SCP must distribute work across available inference sources and avoid concentrating routine work in ChatGPT/Codex, Claude Code, or any single scarce quota pool.
- Current local policy: Gemini models are not assigned during SCP runs unless the user explicitly reauthorizes Gemini for a named task. If this is later relaxed, record it as a model-mix policy update.
- Claude Code is limited to one active instance per pod by default unless the user explicitly authorizes an exception.
- If `EXEC PM` believes a specialized model/harness outside the current team topology is required, it must stop and ping the user with: exact need, why existing visible roles cannot do it, proposed model/harness, cost tier, scope, expiry condition, and risk if not added.
- `A/EXEC-PM` is the sole staffing authority. No TEAM PM staffs its own pod or any other pod. No worker spawns capacity. Any staffing action originating outside `A/EXEC-PM` is a protocol breach. TEAM PMs needing more staff must escalate to `A/EXEC-PM` and not act.
- `A/EXEC-PM` is the sole CMUX surface custodian. `cmux new-split`, `cmux new-surface`, `cmux move-surface`, `cmux close-surface`, and `cmux drag-surface-to-split` are EXEC-PM-only operations. TEAM PMs and workers do not split, move, or close panes.
- Surface layout follows the canonical packing rule: max two surfaces per column, equal column widths, Team A in column 0, Team A alone in the tall column when team count is odd and at least 3. See the Surface Layout Custodianship section for the full algorithm and pre-staffing gate.
- ODIN agents (`A/EXEC-ODIN` and each `<TEAM>/ODIN`) hold binding HALT authority over staffing, surface custodianship, hidden agent creation, same-role QA acceptance, and context-budget violations. A role receiving a HALT must stop, reply with a remediation plan, and resume only after ODIN acknowledges. Continuing past a HALT without remediation is itself a protocol breach.
- Per-agent context window budgeting is contractually enforced: soft threshold 70% triggers an ODIN compaction request; hard threshold 90% forces a handoff or lockdown. Context-budget violations are halt-eligible.

## Invocation Cadence

SCP is a standing control loop, not a one-time boot banner. Read or re-invoke the skill:

- at session boot and after context reset/resume,
- before role assignment or role transition,
- before dispatching work or opening a new pod,
- before CMUX delegation or lateral coordination,
- at each required heartbeat/poll interval,
- before QA activation or QA verdict language,
- before any claim, lifecycle mutation, commit, push, or finish report,
- when a hook, validator, permission mode, quota limit, dirty state, or branch mismatch appears,
- when `$sentinel-coordination-protocol --finish` or `$sentinel-coordination-protocol --session-closeout` is invoked.

If an agent cannot state its current SCP role, authority layer, `may_implement`, `may_qa_accept`, reports-to chain, and next receipt type, it must stop and re-emit `SCP_BOOT_RECEIPT`.

## Generic Role Model And Control Topology

SCP role names are generic. Do not bind authority to model names, harness names, pane names, or vendor brands. Every assignment must separate:

- role,
- authority layer,
- model/harness,
- cost tier,
- capability profile,
- team/pod membership.

Preferred role taxonomy:

- `EXEC PM`: owns intent, priority, authorization, escalation, and final branch-visible claim framing.
- `EXEC ODIN`: executive-office meta-control role. Reports to user authority, not to `EXEC PM`; watches governance health, polling, delivery, permission waits, role boundaries, cross-team ODIN mesh state, and closeout hygiene. Coordinates with `EXEC PM` as a coequal control-plane partner and may advise, prod, freeze, or escalate, but does not implement, QA-accept, expand scope, or act as another assistant by default.
- `EXEC ASST`: owns CMUX delivery proof, heartbeat ledger, pane inventory, artifact index, reminders, and "did the command land?" checks.
- `EXEC DISPATCH` / `SWITCHBOARD`: optional executive-office attention router. Owns CMUX notification watching, waiting-agent detection, short relay pings to responsible PM/ODIN roles, and provider/harness routing recommendations according to declared policy and health. Does not approve permissions, expand scope, implement, QA-accept, or synthesize beyond routing summaries unless separately authorized.
- `EXEC RSCH`: read-only strategy, research, alternatives, context recovery, and architectural risk analysis.
- `EXEC QA`: independent adversarial audit of process, evidence, closure language, branch proof, and drift.
- `TEAM PM`: pod-level task router and assignment owner. Receives assignments from `EXEC PM`, activates pod workers, coordinates with `TEAM ODIN`, and reports pod state. Does not implement or QA-close by default.
- `TEAM ODIN`: pod-level meta-control role. Reports to user authority through the ODIN layer while coordinating with, not subordinating to, `TEAM PM`. Monitors panes, polls lane health, intervenes on blockers, freezes unsafe work, reports health, and maintains lateral ODIN mesh awareness. Does not implement.
- `DEV WORKER`: bounded implementation inside exact write scope with evidence.
- `QA WORKER`: independent adversarial QA inside exact review scope. Cannot QA own work or self-close.
- `SHADOW REVIEWER`: read-only drift, stale-proof, scope, validator, and evidence watcher.
- `INTEGRATION STEWARD`: merge/cherry-pick/integration proof and branch hygiene. Does not implement product features unless separately authorized.
- `QUEUE TRIAGE`: dependency, readiness, and dispatch-order analysis.

Use role-named terminal tabs/panes/surfaces when possible. Model and harness are capabilities, not identity. If a harness fails, substitute another harness by reissuing the same role contract; do not change scope or authority just because the runtime changed.

Pane naming convention:

- Executive office: `A/EXEC-PM`, `A/EXEC-ODIN`, `A/EXEC-ASST`, `A/EXEC-RSCH`, `A/EXEC-QA`.
- Optional executive-office dispatch/switchboard: `A/EXEC-DISPATCH` or `A/SWITCHBOARD`.
- Pod control: `<TEAM>/TEAM-PM` and `<TEAM>/ODIN`, for example `C/TEAM-PM` and `C/ODIN`.
- Workers: `<TEAM>/DEV-1`, `<TEAM>/QA-1`, `<TEAM>/SHADOW-1`.
- Floaters: `A/INTEGRATION-STEWARD`, `A/QUEUE-TRIAGE`, or the team prefix if attached to one pod.

Put model, harness, cost tier, and capability profile in `SCP_BOOT_RECEIPT`, not the pane name.

Identifier convention:

- `role`: uppercase role with spaces, for example `EXEC PM`.
- Terminal pane/tab/surface title: uppercase role with team prefix and hyphens, for example `A/EXEC-PM`.
- `agent_id`: lowercase machine-safe id with team prefix, for example `a-exec-pm`.
- File/directory slug: lowercase role slug without team prefix unless disambiguation is needed, for example `exec-pm`.
- Human prose and authority references: use the canonical role, for example `EXEC PM`.

The team prefix (`A`, `B`, `C`, etc.) is an SCP semantic team label, not a terminal-generated workspace, pane, tab, or surface id. Runtime object refs such as CMUX `workspace:1`, `pane:3`, and `surface:40`, tmux `%3`, or WezTerm pane ids remain separate routing handles.

## Terminal Locator Schema

SCP must work for agents that know CMUX and agents that only know a generic terminal, tmux-like pane, IDE terminal, or future libghostyy-backed surface. Keep semantic identity, terminal routing identity, and virtual-terminal state identity separate:

- Semantic identity answers "who is this agent in the organization": `agent_id`, `team`, `role`, `authority_layer`, `reports_to`.
- Terminal locator identity answers "where can an operator or orchestrator reach this agent": terminal app, workspace/window/pane/surface refs, stable UUIDs when available, title, route command, and capture source.
- VT state identity answers "what terminal emulator state was observed": terminal instance, screen, cursor, rows/columns, scrollback, render dirty state, formatted screen output, semantic prompt state, and input/paste safety.

Every boot receipt and team manifest should include a `terminal_locator` block. Unknown fields are allowed, but they must be explicitly `unknown` or `unavailable`; do not invent ids. The schema is intentionally adapter-neutral:

```yaml
terminal_locator:
 terminal_app: cmux | tmux | wezterm | iterm2 | ghostty | warp | cursor | zed | vscode | unknown
 terminal_adapter: cmux | tmux | libghostyy | apple_script | cli | ide_terminal | unavailable
 workspace_ref: <workspace:1 | tmux-session | unavailable>
 workspace_id: <uuid-or-stable-id | unavailable>
 window_ref: <window:1 | tmux-window | unavailable>
 window_id: <uuid-or-stable-id | unavailable>
 pane_ref: <pane:47 | %3 | unavailable>
 pane_id: <uuid-or-stable-id | unavailable>
 surface_ref: <surface:40 | tab/pane route | unavailable>
 surface_id: <uuid-or-stable-id | unavailable>
 tab_ref: <tab:40 | unavailable>
 tab_id: <uuid-or-stable-id | unavailable>
 surface_type: terminal | browser | editor | unknown
 title: <visible pane/tab title>
 route_command: <non-secret command or unavailable>
 locator_source: <command/tool/observation used>
 locator_captured_at: <ISO-8601 timestamp or unavailable>
```

For CMUX, prefer `cmux --json --id-format both identify` or equivalent because it exposes both human-short refs and UUIDs. For tmux, capture session/window/pane using `tmux display-message -p`; tmux pane ids like `%3` are the native stable handle inside a server, not UUIDs. For WezTerm, use its CLI/json pane/window/tab ids where available. For iTerm2/Ghostty/Warp/IDE terminals, record the strongest scriptable locator available and mark the rest `unavailable`.

Do not treat pane title as a stable id. Titles are useful labels but can collide, drift, or be manually edited. Stable routing uses refs/ids from the terminal adapter when the adapter provides them.

If a terminal adapter exposes libghostty-vt or a congruent virtual-terminal API, add an optional `vt_state_snapshot` block. This block must not replace `terminal_locator`; libghostty-vt models the terminal emulator state, not the outer workspace/pane manager. SCP uses libghostty-vt-compatible names so future products can ingest the same data without translation:

```yaml
vt_state_snapshot:
 vt_provider: libghostty-vt | terminal-capture | unavailable
 vt_api_stability: work_in_progress_unstable | stable | unknown
 terminal_instance_ref: <GhosttyTerminal handle/ref or unavailable>
 terminal_instance_id: <product-generated id or unavailable>
 pty_ref: <pty/process route or unavailable>
 capture_source: <formatter | render_state | grid_ref | read_screen | unavailable>
 formatter_format: plain | vt | html | unavailable
 rows: <GHOSTTY_TERMINAL_DATA_ROWS or unavailable>
 cols: <GHOSTTY_TERMINAL_DATA_COLS or unavailable>
 total_rows: <GHOSTTY_TERMINAL_DATA_TOTAL_ROWS or unavailable>
 scrollback_rows: <GHOSTTY_TERMINAL_DATA_SCROLLBACK_ROWS or unavailable>
 width_px: <GHOSTTY_TERMINAL_DATA_WIDTH_PX or unavailable>
 height_px: <GHOSTTY_TERMINAL_DATA_HEIGHT_PX or unavailable>
 active_screen: primary | alternate | unavailable
 cursor_x: <GHOSTTY_TERMINAL_DATA_CURSOR_X or unavailable>
 cursor_y: <GHOSTTY_TERMINAL_DATA_CURSOR_Y or unavailable>
 cursor_visible: true | false | unavailable
 cursor_pending_wrap: true | false | unavailable
 title: <GHOSTTY_TERMINAL_DATA_TITLE or unavailable>
 pwd: <GHOSTTY_TERMINAL_DATA_PWD or unavailable>
 render_dirty: false | partial | full | unavailable
 semantic_prompt_observed: true | false | unavailable
 semantic_input_observed: true | false | unavailable
 semantic_output_observed: true | false | unavailable
 paste_safety_checked: true | false | unavailable
 paste_safe: true | false | unavailable
 key_encoding_provider: libghostty-vt | terminal | unavailable
 mouse_encoding_provider: libghostty-vt | terminal | unavailable
 focus_encoding_provider: libghostty-vt | terminal | unavailable
 snapshot_captured_at: <ISO-8601 timestamp or unavailable>
```

When using libghostty-vt, prefer formatter or render-state snapshots for repeated observation. `grid_ref` data is ephemeral and must be copied immediately because refs are invalidated by later terminal updates. Treat libghostty-vt's current public API as unstable unless the upstream project declares stability.

Cost-tier operating rule:

- Each role must declare model, harness, cost tier, and current cost-policy basis in `SCP_BOOT_RECEIPT`.
- Model/cost policy is local operating policy, not universal model truth. Refresh it when model availability, pricing, quota, or quality changes.
- Drift from the declared cost/model policy requires a checkpoint or freeze as applicable; do not hard-code stale pricing as governance truth.
- Bootstrap/session manifests should include non-secret `inference_provider_inventory`: provider, account tier, non-secret quota/balance class when the user supplied it, token pool, supported harnesses, marginal cost class, throughput risk, default use policy, and `last_verified_source` with date/source URL when the policy depends on external documentation.
- Provider inventory is non-secret. Never record API keys, secret config values, OAuth material, or hidden account details. Record account/tier/token pool/balance class only when the user explicitly supplied non-secret information.
- Current local provider policy: prefer Z.ai/GLM Coding Plan for routine supported coding tasks when operationally healthy because the user identified it as the lowest marginal-cost paid plan. This is a preference, not an unconditional mandate.
- Z.ai/GLM Coding Plan must use the documented Coding API base URL `https://api.z.ai/api/coding/paas/v4`, not the general API URL. Use subscription benefits only within documented supported tool/product scope. Treat supported tool lists as source-attributed and time-sensitive, not universal truth; record `last_verified_source` and verification date.
- If Z.ai/GLM has throughput, rate-limit, quality, auth, or tooling blockers, classify `PROVIDER_BLOCKER` or `COST_ROUTING_BLOCKED`, route through the visible fallback ladder, and record provider, token pool, reason, wait time if known, fallback selected, and result.
- Local server and local LLM lanes are normal visible role occupants and token pools, never hidden capacity. They require boot receipts, visible role slots, token-pool declaration, and at least one smoke/test or real assignment when activated and not explicitly standby.
- Expensive or high-reasoning agents default to `EXEC PM`, `EXEC ODIN`, `EXEC ASST`, `EXEC RSCH`, `EXEC QA`, `TEAM ODIN`, `INTEGRATION STEWARD`, or high-risk `SHADOW REVIEWER`.
- Bounded, cheaper, faster, or more replaceable agents default to `DEV WORKER`, `QA WORKER`, routine `SHADOW REVIEWER`, or queue/scan tasks.
- A high-cost control agent may execute worker work only through the worker-exception record. A lower-cost worker may perform strategy/control work only after a fresh boot receipt grants that role and removes worker write authority.

Default model/harness profile is local operating policy, not universal model truth. Use exact model names when available; when a named Claude family version is unavailable, use the latest available same-family model with the same harness and record the substitution in `SCP_BOOT_RECEIPT`.

```yaml
default_role_model_harness_profile:
 EXEC_PM:
  model: GPT-5.5
  harness: Codex CLI
  reasoning: high
 EXEC_ODIN:
  model: GPT-5.5
  harness: Codex CLI
  reasoning: xhigh
  note: xhigh is the Codex max-reasoning equivalent when available.
 EXEC_ASST:
  model: Claude Haiku latest available
  harness: Claude Code
  reasoning: default_or_high_if_supported
 EXEC_RSCH:
  model: Kimi K2.6
  harness: Droid
  reasoning: high
 EXEC_QA:
  model: Kimi K2.6
  harness: Droid
  reasoning: high
 TEAM_PM:
  model: Claude Opus 4.7 or latest available Opus
  harness: Claude Code
  reasoning: high_if_supported
 TEAM_ODIN:
  model: GPT-5.5
  harness: Codex CLI
  reasoning: low
 DEV_WORKER:
  model: Kimi K2.6
  harness: Droid
  reasoning: high
 QA_WORKER:
  model: GLM-5.1
  harness: Crush
  reasoning: high
 SHADOW_REVIEWER:
  model: Kimi K2.6
  harness: Droid
  reasoning: high
```

Default worker fallback policy: if `Crush` fails for a worker-style role, try `Droid`; if both `Crush` and `Droid` fail, use `Claude Code` with Claude Sonnet 4.6 or the latest available Sonnet. For worker backup generally, prefer Kimi K2.6 on Droid or Claude Sonnet 4.6/latest Sonnet on Claude Code with high reasoning when supported.

Default operating architecture is a small executive office plus horizontally scalable pods:

- Executive office: `EXEC PM`, `EXEC ODIN`, `EXEC ASST`, `EXEC RSCH`, and `EXEC QA`.
- Each pod: `TEAM PM`, `TEAM ODIN`, `DEV WORKER`, `QA WORKER`, and optional `SHADOW REVIEWER`.
- Floaters: `INTEGRATION STEWARD` and `QUEUE TRIAGE` when branch integration or queue pressure warrants them.

During SCP setup/bootstrap, the named `EXEC PM` must ask the user how many pods/teams he wants unless the user already specified topology. When useful, `EXEC PM` should briefly present grouping options. Default topology, when the user does not specify otherwise, is executive office plus one development pod. Default executive office: `A/EXEC-PM`, `A/EXEC-ODIN`, `A/EXEC-ASST`, `A/EXEC-RSCH`, and `A/EXEC-QA`. Default development pod: `<TEAM>/TEAM-PM`, `<TEAM>/ODIN`, `<TEAM>/DEV-1`, `<TEAM>/QA-1`, optional `<TEAM>/SHADOW-1`. Additional pods, floaters, specialized roles, or model/harness capacity outside this topology require the user authorization through `[SCP-TOPOLOGY-EXPANSION-REQUEST]`.

Specialized teams may require a team profile instead of the generic federated development pod. UX/design teams are not automatically treated as generic DEV/QA pods; preserve their prototype/design boundaries until the user or `EXEC PM` assigns a UX-specific topology.

`EXEC ODIN` is the executive ODIN primitive. Do not create separate default personal continuity, holdout, or watchdog roles unless the user explicitly authorizes them. A resumed private continuity or holdout agent may exist outside the declared team topology when the user intentionally withholds or masks that role; it must not be treated as governed team capacity unless the user brings it into the visible topology.

`TEAM PM` and `TEAM ODIN` are complementary, not aliases. `TEAM PM` owns pod assignment routing and worker activation; `TEAM ODIN` owns governance/control integrity, polling, intervention, and role/scope enforcement. `TEAM ODIN` is not subordinate to `TEAM PM` and is not superior to it; it is a coequal meta-control layer accountable to user authority and the ODIN mesh. Either may relay to workers only within the assignment contract, but neither implements or QA-closes by default.

Team PMs and team ODINs may coordinate laterally when needed, but lateral messages must be logged as coordination events. Top-down command is the default; lateral coordination is for dependency, blocker, or health propagation, not unsupervised work selection.

ODINs must establish a lateral ODIN mesh at bootstrap. `A/EXEC-ODIN` and each `TEAM ODIN` must exchange a short introduction containing role, team, reports-to/coordinates-with chain, team composition, active agent occupants, model/harness/cost tier, known blockers, and next poll time. This is a meta-communication layer, not command authority.

During active execution, `A/EXEC-ODIN` should run an ODIN round-robin health pass on a declared cadence, default 30 seconds unless the user or `EXEC PM` sets another cadence. The executive ODIN starts with its own executive-office health note, sends it to the first team ODIN, and instructs each team ODIN to append its short team composition/status/health note and forward to the next ODIN. The final team ODIN returns the appended packet to `A/EXEC-ODIN`. `A/EXEC-ODIN` compiles the packet, may ask `EXEC DISPATCH` / `SWITCHBOARD` for outstanding communication or waiting-agent notes, then sends a concise status report to `EXEC PM`.

ODIN mesh reports must stay short by default and include: team, active occupants, provider/model/harness mix, blocked agents, permission waits, plan-mode/quota/provider failures, role breaches, delivery failures, outstanding relays, and recommended intervention. ODINs may request temporary secondment of another control-plane agent through `EXEC PM` when a PM/ODIN lane fails, but they must not directly reassign agents or expand topology without authorization.

## Durable Role Slots And Agent Occupants

SCP team topology is durable infrastructure. Role slots are stable. Agent occupants are replaceable.

Definitions:

- `role_slot`: semantic team position, for example `B/DEV-1`, `C/QA-1`, `A/EXEC-RSCH`.
- `terminal_surface`: CMUX/tmux/terminal object hosting that slot.
- `agent_occupant`: current model/harness process inside that slot.

During active SCP operation, role slots must remain present in CMUX. Closing a role-named pane/surface is a topology mutation and requires explicit the user authorization.

Allowed occupant-level remediation:

- clear context inside the same pane;
- exit the current agent process while leaving the pane open;
- restart the same harness inside the same pane;
- substitute a different model/harness inside the same pane;
- park the slot with `[SCP-IDLE]`;
- mark the slot `VACANT_ROLE_SLOT`;
- mark the slot `AGENT_CONTEXT_RESET_REQUIRED`, `AGENT_RESTART_REQUIRED`, or `AGENT_SUBSTITUTION_REQUIRED`.

Forbidden without explicit the user authorization:

- closing a role-named pane/surface;
- deleting a role slot from CMUX;
- adding extra worker panes beyond official topology;
- creating ad hoc floaters beyond official grouping;
- renaming a role slot to serve a different role;
- moving work to a hidden or non-terminal agent.

If a role slot is accidentally closed, emit `[SCP-FREEZE]` or `[SCP-FEEDBACK]`, classify `ROLE_SLOT_CLOSURE_VIOLATION`, and record the restoration or next-run correction requirement. When possible, recreate or re-reserve the same role slot, mark the prior occupant `AGENT_STOOD_DOWN` or lost, and require the user or `A/EXEC-PM` reconciliation before any clean, ready, closure, or finish claim.

Plan-mode and read-only blockers are occupant state failures, not topology failures. They trigger `AGENT_SUBSTITUTION_REQUIRED`, `AGENT_CONTEXT_RESET_REQUIRED`, or operator exit from plan mode inside the same role slot. They do not justify hidden subagents, invisible delegation, or new panes.

## Official Topology Rule

After initial team bootstrap, `EXEC PM` must operate within the official CMUX topology already created.

Default official grouping:

- Executive office: `A/EXEC-PM`, `A/EXEC-ODIN`, `A/EXEC-ASST`, `A/EXEC-RSCH`, `A/EXEC-QA`.
- Each pod: `<TEAM>/TEAM-PM`, `<TEAM>/ODIN`, `<TEAM>/DEV-1`, `<TEAM>/QA-1`, optional `<TEAM>/SHADOW-1`.
- Optional official executive support roles only when intentionally bootstrapped or user-authorized: `A/EXEC-DISPATCH`, `A/SWITCHBOARD`, `A/INTEGRATION-STEWARD`, `A/QUEUE-TRIAGE`, or named specialized roles.

`EXEC PM` must route work to the appropriate existing role, not to any convenient model. The first routing question is always:

> Which existing CMUX role owns this work?

If no existing role is appropriate, `EXEC PM` must request the user authorization before creating capacity.

Active SCP visible role-slot rules override generic external subagent language while SCP is active. Generic external coordination concepts may describe Dev/QA capacity, but under SCP that capacity must be represented by visible CMUX role slots unless the user authorizes topology expansion.

## Surface Layout Custodianship

`A/EXEC-PM` is the sole CMUX surface custodian. Surface operations — `cmux new-split`, `cmux new-surface`, `cmux move-surface`, `cmux close-surface`, `cmux drag-surface-to-split` — are EXEC-PM-only. TEAM PMs and workers do not split, move, drag, or close surfaces. TEAM PMs needing more capacity escalate to `A/EXEC-PM`, never act.

Surface layout follows a deterministic packing rule:

- all columns are equal width;
- at most two surfaces stack per column;
- Team A always occupies column 0;
- when team count is odd and at least 3, column 0 holds only Team A — the "tall column."

Reference layouts (slash separates stacked surfaces in a column, single bracket = single surface):

```
N=1  [A]
N=2  [A] [B]
N=3  [A] [B/C]          ← A tall, B+C stacked
N=4  [A/D] [B/C]         ← balanced
N=5  [A] [B/C] [D/E]       ← new column, A returns to tall
N=6  [A/F] [B/C] [D/E]      ← balanced
N=7  [A] [B/C] [D/E] [F/G]
N=8  [A/H] [B/C] [D/E] [F/G]
```

### Pre-Staffing Gate

Before dispatching any agent beyond `A/EXEC`, `A/EXEC-PM` must:

1. Call `odin.compute_surface_layout` with the target team count to retrieve the canonical layout.
2. Call `odin.compute_surface_layout_gate` with `fromTeamCount` and `toTeamCount` to retrieve the transition checklist.
3. Execute the required `cmux new-split`, `cmux new-surface`, or `cmux move-surface` operations.
4. Confirm each new surface exists, is empty, and is addressable via `cmux list-pane-surfaces`.
5. Only then dispatch the spawn to the newly created surface.

Skipping any step is a protocol breach. The supervising ODIN role must HALT any staffing action that omits the gate.

When the odin-sentinel MCP server is not available (rare; the published `@bradheitmann/odin-sentinel` package should always be reachable), EXEC PM applies the reference layouts above by hand and records the deviation in the boot receipt.

## Visible Delegation Rule

Under SCP, `$delegate` is constrained by visible CMUX topology.

Delegation must target an existing role slot unless the user authorizes topology expansion. A valid delegation target must have:

- role identity;
- terminal locator;
- model/harness/cost-tier declaration;
- reports-to chain;
- authority declaration;
- boot receipt;
- CMUX or terminal delivery proof;
- ODIN poll visibility.

Prohibited by default:

- `spawn_agent`;
- hidden background subagents;
- invisible research assistants;
- non-terminal model forks;
- off-ledger advisory workers;
- new worker panes invented because `EXEC PM` wants a stronger model.

If the current occupant cannot perform the task, use the role's fallback ladder inside the same CMUX slot.

Hidden/internal subagent output produced during active SCP is non-governed and advisory only. It cannot support QA acceptance, closure, lifecycle mutation, branch-visible claims, evidence-gate satisfaction, policy synthesis, or dispatch decisions unless the user explicitly records an `[SCP-EXCEPTION]` and reconciles provenance into the visible SCP ledger.

When `delegate` is invoked during active SCP, SCP topology rules override generic delegation behavior. `delegate` may compose instruction bundles and harness commands, but launch targets must be existing visible SCP role slots unless the user authorizes topology expansion. `delegate` must not create hidden subagents, non-CMUX background workers, or off-ledger research capacity during active SCP.

## Role Occupant Fallback Ladders

Fallback applies to the agent occupant inside an existing role slot. It does not authorize adding panes, workers, or hidden agents.

When a role needs substitution:

1. Preserve the CMUX role slot.
2. Stand down, clear, or exit the current occupant.
3. Select the next acceptable model/harness from that role's fallback ladder.
4. Launch the replacement inside the same pane.
5. Emit `[SCP-AGENT-SUBSTITUTION]`.
6. Require fresh `SCP_MIN_BOOT_RECEIPT` before readiness.
7. Require full `SCP_BOOT_RECEIPT` before activation.

Fallback may be triggered by quota exhaustion, plan mode blocking required work, missing tools, auth failure, context degradation, model/harness mismatch, cost guardrail violation, repeated low-quality output, or role breach.

Default ladders are local operating policy, not universal model truth. They are overridable only by the user authorization or recorded `[SCP-EXCEPTION]`, and they must be refreshed when model availability, local harness health, pricing, quota, or quality changes.

```yaml
role_model_fallback_ladders:
 EXEC_PM:
  - model: GPT-5.5
   harnesses: [codex]
   reasoning: high
  - model: Kimi K2.6
   harnesses: [droid]
   reasoning: high
  - model: GLM-5.1
   harnesses: [crush, opencode]
   reasoning: high

 EXEC_ODIN:
  - model: GPT-5.5
   harnesses: [codex]
   reasoning: xhigh
  - model: GPT-5.5
   harnesses: [codex]
   reasoning: high
  - model: Kimi K2.6
   harnesses: [droid]
   reasoning: high

 EXEC_ASST:
  - model: Claude Haiku latest available
   harnesses: [claude]
   reasoning: default_or_high_if_supported
  - model: MiniMax
   harnesses: [droid]
   reasoning: medium
  - model: Kimi K2.6
   harnesses: [droid]
   reasoning: medium

 EXEC_RSCH:
  - model: Kimi K2.6
   harnesses: [droid]
   reasoning: high
  - model: GLM-5.1
   harnesses: [crush, opencode]
   reasoning: high
  - model: MiniMax
   harnesses: [droid]
   reasoning: medium

 EXEC_QA:
  - model: Kimi K2.6
   harnesses: [droid]
   reasoning: high
  - model: GLM-5.1
   harnesses: [crush, opencode]
   reasoning: high
  - model: Claude Sonnet latest available
   harnesses: [claude]
   reasoning: high_if_supported

 TEAM_PM:
  - model: Claude Opus 4.7 or latest available Opus
   harnesses: [claude]
   reasoning: high_if_supported
  - model: Kimi K2.6
   harnesses: [droid]
   reasoning: high
  - model: GPT-5.5
   harnesses: [codex]
   reasoning: high

 TEAM_ODIN:
  - model: GPT-5.5
   harnesses: [codex]
   reasoning: low
  - model: Kimi K2.6
   harnesses: [droid]
   reasoning: high
  - model: GLM-5.1
   harnesses: [crush, opencode]
   reasoning: medium

 DEV_WORKER:
  - model: Kimi K2.6
   harnesses: [droid]
   reasoning: high
  - model: Claude Sonnet 4.6 or latest available Sonnet
   harnesses: [claude]
   reasoning: high_if_supported
   limit: one_claude_code_per_pod
  - model: GLM-5.1
   harnesses: [crush, opencode]
   reasoning: high

 QA_WORKER:
  - model: GLM-5.1
   harnesses: [crush]
   reasoning: high
  - model: Kimi K2.6
   harnesses: [droid]
   reasoning: high
   condition: if_crush_fails
  - model: Claude Sonnet 4.6 or latest available Sonnet
   harnesses: [claude]
   reasoning: high_if_supported
   condition: if_crush_and_droid_fail

 SHADOW_REVIEWER:
  - model: Kimi K2.6
   harnesses: [droid]
   reasoning: high
  - model: Claude Sonnet 4.6 or latest available Sonnet
   harnesses: [claude]
   reasoning: high_if_supported
  - model: GLM-5.1
   harnesses: [crush, opencode]
   reasoning: medium

 INTEGRATION_STEWARD:
  - model: GLM-5.1
   harnesses: [crush, opencode]
   reasoning: high
  - model: Kimi K2.6
   harnesses: [droid]
   reasoning: high
  - model: Claude Opus
   harnesses: [claude]
   reasoning: high
   condition: Brad_authorized_high_risk_exception_only

 QUEUE_TRIAGE:
  - model: Kimi K2.6
   harnesses: [droid]
   reasoning: medium
  - model: MiniMax
   harnesses: [droid]
   reasoning: medium
  - model: GLM-5.1
   harnesses: [crush, opencode]
   reasoning: medium
```

`SCP-TEAM-MANIFEST` must include model mix policy and per-slot occupant state:

```yaml
model_mix_policy:
 scarce_quota_pools:
  - chatgpt_codex
  - claude_code
 locally_disallowed_without_brad_reauth:
  - gemini
 hidden_subagents_allowed: false
 role_slot_closure_allowed: false
 topology_expansion_allowed_without_brad: false
 max_claude_code_instances_per_pod: 1
 min_distinct_inference_sources_per_pod: 3
 dev_qa_same_provider_allowed: false
 fallback_ladder_required: true
 delegate_must_use_cmux_visible_roles: true

role_slot:
 title: B/DEV-1
 role: DEV WORKER
 surface_ref:
 current_occupant:
  model:
  harness:
  reasoning:
  cost_tier:
  status:
 fallback_ladder:
  - model:
   acceptable_harnesses:
   reasoning:
   substitution_trigger:
 topology_mutable: false
```

## Self-Bootstrap Team Lifecycle

The preferred operating mode is one human-started `EXEC PM` pane that bootstraps, operates, and tears down the rest of the organization. the user should not have to manually create panes, name agents, invoke harnesses, or clean up temporary teams during normal SCP operation.

When the user asks `EXEC PM` to spin up teams, `EXEC PM` must load `references/team-bootstrap-runbook.md` and compose these supporting skills:

- `team-composition-patterns` for pod sizing and role coverage,
- `dispatching-parallel-agents` for independent workstream decomposition,
- `delegate` for harness/model selection, preflight, fallback, and instruction bundles,
- `handoff`, `qa-swarm-review`, and `atlas-synthesis` when closeout, cleanup QA, or synthesis is required.

Bootstrap sequence:

1. Verify CMUX availability and identify the active workspace.
2. Create or update an `SCP-TEAM-MANIFEST` with executive office, pod roster, pane names, `terminal_locator` blocks, harness/model, role, reports-to chain, and teardown disposition.
3. Create role-named CMUX panes/tabs for the executive office and requested pods.
4. Preflight selected harnesses/models before launching them.
5. Send each pane a role-specific boot prompt and require `SCP_MIN_BOOT_RECEIPT` for initial readiness.
6. Confirm send/enter/screen/ack with `[SCP-CMUX-DELIVERY]`.
7. Begin `[SCP-POLL]` heartbeat before dispatching worker tasks.

Initial bootstrap may use a runtime manifest in the EXEC PM pane transcript, status ledger, or screen report when no product work is dispatched and no branch-visible claim is being made. Before dispatch, lifecycle mutation, QA activation, commit, push, or clean/ready claims, the manifest must be promoted to a durable handoff, ledger, or branch-visible artifact as appropriate to the run scope.

For fast bootstrap, the EXEC PM should supply authoritative terminal locator fields in the boot prompt from CMUX/tmux/terminal adapter output. Pane self-report is secondary and should only fill fields the EXEC PM could not capture.

### Plan-Mode Bootstrap

Some harnesses, especially Claude Code, may enter plan mode or pause for approval on harmless proof commands. During bootstrap-only runs:

- Safe to approve or pre-supply: reading SCP/AGENTS/handoff files, `pwd`, `git status --short --branch --untracked-files=all`, `git rev-parse HEAD @{u}`, `cmux identify`, `cmux read-screen`, and role/receipt acknowledgment.
- Must remain blocked: file writes, lifecycle moves, evidence/verdict creation, implementation, QA acceptance, commits, pushes, destructive cleanup, and secret printing.
- If plan mode blocks proof collection, EXEC PM may provide branch, SHA, cwd, and terminal locator proof in the boot prompt and request `SCP_MIN_BOOT_RECEIPT` only.
- A plan-mode pane with minimal receipt remains `BOOT_RECEIPT_PARTIAL` or `BOOTSTRAPPED_IDLE` and must not be activated for work until it emits full `SCP_BOOT_RECEIPT` or receives an explicit activation prompt with proof gates.

Teardown sequence:

1. Broadcast `$sentinel-coordination-protocol --finish`.
2. Collect `[SCP-FINISH]`, snapshots, handoffs, dirty state, and blocker state.
3. Snapshot official topology before cleanup, classify each surface as official role slot vs temporary/ad hoc, and list any proposed closures.
4. Run post-run hygiene and cleanup QA.
5. Choose and record teardown mode:
  - `PARK_FOR_CONTINUITY`: park official role slots as `BOOTSTRAPPED_IDLE`, `VACANT_ROLE_SLOT`, `AGENT_STOOD_DOWN`, `AGENT_CONTEXT_RESET_REQUIRED`, `AGENT_RESTART_REQUIRED`, or `AGENT_SUBSTITUTION_REQUIRED`; close only non-role temporary panes/surfaces listed as closable in `SCP-TEAM-MANIFEST`.
  - `FULL_SESSION_SHUTDOWN`: when the user explicitly wants the session closed, collect handoffs first, then quit each agent occupant using the harness-specific quit/exit action, verify it actually exited, close the CMUX surface/pane, and leave only the user-designated retained surfaces. Do not rely on agents to self-prune; older occupants may not have the current SCP skill or may stop at stand-down without quitting.
6. For either mode, close panes/surfaces only after `[SCP-FINISH]`, handoff/session report, ODIN snapshot, and the user or recorded cleanup-policy authorization.
7. Leave standing executive/UX or explicitly retained panes parked with fresh restart instructions only when teardown mode is `PARK_FOR_CONTINUITY`.

The `EXEC PM` may automate CMUX setup and teardown, but destructive cleanup of worktrees, untracked files, or branch state still requires the same branch/scope/proof gates and explicit approval rules as the rest of SCP.

CMUX topology audits must enumerate titled surfaces by listing panes and then running `list-pane-surfaces --pane` or equivalent for each pane; `surface-health` alone is insufficient when it lacks titles. Before `SCP_BOOT_RECEIPT` in CMUX, attempt `cmux identify` or equivalent locator discovery and populate locator; use terminal-unavailable only if locator discovery fails and the failure is recorded.

Each surface must be classified as `official_role_slot`, `temporary_ad_hoc`, `operator_shell`, `browser_or_non_terminal`, `invalid_or_stale_locator`, or `unknown_needs_inspection`. Operator shells and non-terminal surfaces that can influence governance must be listed in `SCP-TEAM-MANIFEST` as excluded or operator-controlled. Freeze carve-outs must name exact role slots and exact CMUX/terminal locators; team-name-only carve-outs are invalid. `SCP-TEAM-MANIFEST` must have a canonical path or declared `manifest_unavailable` state, and audit delegations must cite it or record why it was unavailable.

## Control-Plane Non-Implementation Rule

This is the control-plane non-implementation rule.

Control-plane roles do not implement worker deliverables, author slice evidence as workers, perform QA acceptance as workers, or move worker lifecycle state by default. Their deliverables are prompts, routing decisions, CMUX delivery proof, health checks, blocker reports, scope corrections, QA pressure, governance ledgers, and handoffs.

Control-plane panes may write their own receipts, feedback, audit reports, research notes, and ODIN/control-plane state only to declared governance/audit `evidence_path` and within declared `write_scope`. Worker deliverables, product/source/test changes, lifecycle mutation, branch mutation, QA acceptance, or evidence authoring for DEV work require explicit scoped authorization or `[SCP-CONTROL-PLANE-MUTATION]` as applicable.

Control-plane roles include `EXEC PM`, `EXEC ODIN`, `EXEC ASST`, `EXEC RSCH`, `EXEC QA`, `TEAM PM`, `TEAM ODIN`, `SHADOW REVIEWER`, `INTEGRATION STEWARD`, and `QUEUE TRIAGE` unless a boot receipt explicitly says otherwise.

A control-plane pane may not self-reclassify as `DEV WORKER` or `QA WORKER`. Worker exception requires all of:

- explicit the user or `EXEC PM` authorization naming the pane,
- proof downstream capacity is unavailable, blocked, or inappropriate,
- exact write/review scope and prohibited paths,
- independent QA assignment by a different pane,
- branch-visible or ledger-visible exception record,
- fresh `SCP_BOOT_RECEIPT` with `may_implement: true` or `may_qa_accept: true`.

If a control-plane pane begins product/source/test implementation, authors worker evidence, or accepts QA without the exception record, emit `[SCP-FREEZE]` and classify it as a role breach.

Editing canonical skills, adapters, runtime skill copies, sync scripts, lifecycle ledgers, branch state, or policy text is a control-plane governance mutation and requires `[SCP-CONTROL-PLANE-MUTATION]` before or with the mutation. ODIN/control-plane roles must not self-accept governance mutations they authored. Acceptance requires independent QA, user ratification, or explicitly named `EXEC PM` ratification after evidence review. An authorized control-plane mutation may be reported as implemented and validation complete, but remains pending ratification until the named ratifier accepts the evidence.

Canonical SCP audit, research, ODIN, and control-plane outputs must be written under a durable governance path such as `.odin/audit/<audit-id>/` or another declared `evidence_path`. `/tmp` may be used for intermediate captures, cache, delivery-proof repair, or mirrors only. Before `[SCP-FINISH]`, any `/tmp` artifact used for a claim must be copied, summarized, hashed, or explicitly declared non-canonical in the durable audit ledger.

`repo_clean` must not be used as shorthand for `governance_clean`. Governance-surface mutations outside the active repository require separate reporting: `external_skill_paths_touched`, `runtime_targets`, `hash_before_after_or_current_hash`, `sync_log_path`, `validation_command`, and `unsynced_or_dirty_runtime_paths`. A clean git worktree proves only the repository checkout state. It does not prove canonical skill, Codex skill, Claude skill, adapter, CMUX runtime, or `/tmp` artifact state.

Harness reminder/noise suppression is a future optimization only. SCP may prefer delta-only reminders after valid boot receipts, but no harness-specific suppression promise is enforceable unless separately implemented and validated.

## ODIN Intervention Authority

`A/EXEC-ODIN` and each `<TEAM>/ODIN` are not advisors. They hold binding **HALT authority** over the roles they supervise and are contractually empowered to stop offending behavior in real time.

### Halt Triggers

ODIN must issue a HALT directive when it observes any of:

- staffing or surface custodianship action without the pre-staffing gate completing;
- hidden agent creation (invisible subagents, off-ledger workers, model fan-out);
- QA acceptance by the same role that implemented the deliverable;
- context window exceeding the hard threshold (90%) without compaction or handoff;
- boot receipt missing required staffing audit fields on a non-exec role;
- team manifest topology drift from the canonical default topology contract;
- `[SCP-CONTROL-PLANE-MUTATION]` self-acceptance without independent ratification.

### Receiving-Role Obligation

A role receiving a HALT directive must:

1. Stop the offending action immediately.
2. Reply with a remediation plan within the next heartbeat interval.
3. Resume only after the supervising ODIN acknowledges the remediation.

Continuing past a HALT without remediation is itself a protocol breach. ODIN must escalate to `A/EXEC-ODIN`, which may escalate to the user.

### Health Escalation

The ODIN mesh runs round-robin health checks per `odin_mesh.health_round_robin_seconds` (default 30). Per-agent escalation ladder:

- **1 missed heartbeat** — warn the affected agent.
- **2 missed heartbeats** — escalate to `A/EXEC-ODIN` via the mesh aggregator.
- **3 missed heartbeats** — lockdown. The affected agent is suspended from new dispatch; `A/EXEC-PM` must restaff or close the surface.

### Context Window Budgeting

Per-agent context thresholds, enforced by the supervising ODIN:

- **70% (soft)** — ODIN warns and requests compaction or handoff preparation.
- **90% (hard)** — ODIN forces a handoff to a fresh occupant or triggers lockdown.

Context-budget violations are halt-eligible. Workers approaching the soft threshold should not silently continue.

## Runtime Receipts

Every participating pane must leave searchable, pane-native receipts. These are required even when the agent is read-only or blocked.

### `SCP_MIN_BOOT_RECEIPT`

Emit for initial pane readiness during team bootstrap. This is sufficient to park an idle pane, but not sufficient to dispatch work, mutate files, perform QA, commit, push, or claim closure.

Required fields:

- `agent_id`
- `team`
- `role`
- `reports_to`
- `cwd`
- `branch`
- `head_sha`
- `may_implement`
- `may_qa_accept`
- `permission_mode`
- `current_state: BOOTSTRAPPED_IDLE | BOOT_RECEIPT_PARTIAL | BOOT_RECEIPT_BLOCKED | READINESS_ONLY`

Recommended fields when supplied by EXEC PM:

- `terminal_locator`
- `target_sha_or_base`
- `proof_source`
- `next_expected_receipt`

Minimal receipt is a bootstrap optimization only. Full `SCP_BOOT_RECEIPT` is mandatory before activation, dispatch, mutation, QA verdict language, lifecycle changes, commit, push, or finish claims.

### `SCP_BOOT_RECEIPT`

Emit before the first file read, shell command, repo mutation, lifecycle claim, or QA verdict, and again after any context resume.

Required fields:

- `agent_id`
- `terminal_locator`
- `vt_state_snapshot`, if available
- `team`
- `role`
- `authority_layer`
- `model_harness`
- `cost_tier`
- `capability_profile`
- `cwd`
- `branch`
- `upstream`
- `head_sha`
- `target_sha_or_base`
- `may_implement`
- `may_qa_accept`
- `delegates_to`
- `reports_to`
- `worker_exception_authority`
- `write_scope`
- `read_scope`
- `prohibited_paths`
- `evidence_path`
- `terminal_state_vocabulary`
- `proof_source`
- `permission_mode`

Staffing audit fields, required for any role outside the executive office (`team != "A"`):

- `staffed_by` — must equal `A/EXEC-PM` (the sole canonical staffing authority).
- `parent_surface_ref` — CMUX surface ref where the agent runs (e.g. `surface:7`).
- `column_index` — integer >= 0, the layout column the agent occupies.
- `team_letter` — single uppercase A-Z matching the agent's team prefix.

Receipts missing these fields on non-exec roles produce ODIN warnings via `odin.validate_boot_receipt`. Receipts that declare `staffed_by` != `A/EXEC-PM` are halt-eligible: TEAM PMs and workers cannot self-staff.

If the harness is running with bypass, dangerous, or skip-permission mode, declare `permission_mode: DEGRADED_READ_ONLY` unless the user explicitly authorized write mode for that pane. A degraded pane may not write, commit, push, move lifecycle state, or claim closure.

When EXEC PM, EXEC ASST, or the terminal adapter already captured exact `terminal_locator` refs/ids, use those values as authoritative. The pane may acknowledge or add missing fields, but self-reported locator data must not override adapter-captured refs.

### `[SCP-POLL]`

Control-plane and ODIN panes must emit a heartbeat while monitoring:

- `ledger_or_status_artifact`
- `watched_agents`
- `last_surface_checked`
- `notification_state`, if CMUX or terminal adapter exposes attention/blink state
- `attention_source_surface`
- `likely_wait_reason`
- `waiting_agents`
- `permission_waits`
- `notification_events`
- `relays_sent`
- `responsible_pm`
- `unacked_relays`
- `last_downstream_push`
- `last_intervention`
- `idle_agents`
- `overstepping_agents`
- `branch_sha_snapshot`
- `dirty_or_blocked_count`
- `interventions_since_last_poll`
- `next_push`
- `next_poll_at`
- `missed_heartbeat_is_blocker`

During active dispatch, an idle `EXEC ODIN`, `TEAM ODIN`, or `EXEC ASST` without a current `next_push` or `next_poll_at` is a control-plane failure, not a harmless idle state.

`EXEC PM`, `EXEC ODIN`, `TEAM PM`, `TEAM ODIN`, and any `EXEC DISPATCH` / `SWITCHBOARD` role must poll active subordinate or watched role slots and CMUX notification state on a declared cadence while work is dispatched. If a downstream agent waits on permission beyond the session SLA or two poll intervals, classify `PERMISSION_WAIT_TIMEOUT` and escalate to the responsible PM, `EXEC ODIN`, and `EXEC PM`.

`EXEC ODIN` owns the ODIN mesh cadence. At bootstrap and then on the declared cadence, `EXEC ODIN` must coordinate ODIN-to-ODIN health reporting across all active teams and deliver the concise compiled status to `EXEC PM`.

Where CMUX exposes notification, blink, or attention state, polling agents must capture `notification_state`, `attention_source_surface`, `likely_wait_reason`, and `responsible_role`. A blink/attention signal is not a verdict, but it is a required poll input when available.

Daemon and ODIN compact status lines are heartbeats only unless they include every required `SCP_BOOT_RECEIPT` field. A compact heartbeat must not authorize action, substitute for readiness, establish write authority, or satisfy activation. If a daemon or ODIN needs authority beyond observation, it must emit full `SCP_BOOT_RECEIPT` or an explicit compact-heartbeat classification of `NON_AUTHORIZING_HEARTBEAT`.

### `[SCP-DELEGATE]`

Emit whenever a control-plane role assigns work downstream:

- `source_agent`
- `target_surface`
- `target_terminal_locator`
- `target_role`
- `task_type`
- `slice_or_artifact_id`
- `allowed_actions`
- `prohibited_actions`
- `write_scope`
- `evidence_required`
- `expected_ack`
- `deadline_or_next_poll`

Delegation is the primary progress mechanism for ODINs. A `TEAM ODIN` that directly implements while downstream workers are available is overstepping.

During active SCP, each delegation must include `target_role_slot`, terminal/surface locator, scope, read/write authority, prohibited actions, evidence/report-back format, and ODIN visibility. Delegation must route through visible CMUX/terminal role slots. It must not use hidden subagents, invisible model forks, or non-CMUX background capacity.

A pane must not receive `[SCP-DELEGATE]` activation and `[SCP-FREEZE]` targeting itself in the same coordination message. Freeze takes precedence; activation must be separately reissued after freeze lift. `[SCP-DELEGATE]` may include `pre_action_required` gates such as `SCP_BOOT_RECEIPT`, `BRANCH_PROOF`, `PERMISSION_PROOF`, or `FREEZE_LIFT_PROOF`; gates are mandatory after `FROZEN`, `FROZEN_IDLE`, `READINESS_ONLY`, or `BLOCKED_BY_LIMIT` reactivation. If `[SCP-DELEGATE]` names `skill_context`, the target must invoke/read the named skills before executing the assignment or emit `skill_context_unloaded` with blocker details. A report that used named skill context must list `skills_loaded` and any `skills_unavailable`.

### `[SCP-TERMINAL-DELIVERY]` / `[SCP-CMUX-DELIVERY]`

Emit after sending a terminal instruction. Use `[SCP-CMUX-DELIVERY]` for CMUX surfaces and `[SCP-TERMINAL-DELIVERY]` for tmux, WezTerm, iTerm2, Ghostty, Warp, Cursor, Zed, VS Code, libghostyy, or unknown terminal adapters:

- `target_terminal_locator`
- `target_surface`
- `target_pane_ref`
- `target_pane_id`
- `target_surface_ref`
- `target_surface_id`
- `message_hash_or_first_line`
- `delivery_verdict`
- `enter_sent`
- `read_screen_confirmed`
- `ack_observed`
- `next_check_at`

Text sitting in an input bar is not delivery. Delivery requires send/enter plus screen confirmation using the best available terminal adapter. If `ack_observed: false`, the next poll must revisit that pane.

For CMUX delivery, a `cmux send` or paste that leaves text in the target input bar is not enough. The sender must either include the submitting newline/enter in the command or immediately send Enter and verify screen delivery. `enter_sent: true` must be explicitly confirmed for valid delivery. If Enter was not sent or cannot be confirmed, classify `delivery_verdict: INPUT_BAR_ONLY`, follow up before counting the coordination exchange as delivered, and record a delivery failure/intervention in session metrics when this affects coordination.

Allowed `delivery_verdict` values:

- `DELIVERED_ACKED`: send/enter/screen confirmation completed and an explicit or behaviorally clear ack was observed.
- `DELIVERED_NO_ACK`: send/enter/screen confirmation completed, but no ack yet. Must revisit next poll.
- `INPUT_BAR_ONLY`: text is visible in the input bar or paste buffer but Enter was not confirmed. This is not delivery.
- `PANE_BLOCKED_ON_PERMISSION`: pane is blocked by permission, plan mode, auth, quota, or modal state before receipt/ack.
- `PANE_STILL_THINKING`: instruction landed but the pane is still processing.

### `[SCP-COORDINATION]`

Emit for lateral ODIN-to-ODIN or executive-to-ODIN coordination:

- `source_agent`
- `target_agent_or_surface`
- `reason`
- `dependency_or_blocker`
- `message_summary`
- `ledger_or_artifact_update`
- `requires_exec_attention`

Header-only `[SCP-COORDINATION]`, `[SCP-DELEGATE]`, `[SCP-FEEDBACK]`, or `[SCP-FREEZE]` messages are non-instructive and invalid. Producers must not emit them. Receivers must not infer intent from them. Repeated bare headers are a reportable protocol breach.

### `[SCP-FEEDBACK]`

Emit for protocol improvement observations during bootstrap, active monitoring, finish audit, or post-run review:

- `reviewer`
- `phase`
- `score`
- `what_works`
- `issues_found` with severity labels
- `recommended_patch_concepts`
- `operational_impression`
- `validation_scope`
- `requires_skill_update: true|false`

Use the same severity discipline as QA: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`. Preliminary feedback must say what was and was not validated. Feedback does not authorize product work; it only proposes governance improvements.

Audit and feedback reports must declare coverage. `[SCP-FEEDBACK]` for audit output must include `audit_id`, `audit_authority`, `executed_scope`, `not_executed_scope`, `data_basis`, `evidence_completeness: FULL|PARTIAL|INSUFFICIENT`, `partial_reason`, `truncation_reason`, `surfaces_with_insufficient_evidence`, `secrets_emitted`, and per-finding `evidence_basis`. `PARTIAL` output cannot be treated as complete coverage, QA acceptance, or closure support unless the synthesis explicitly downgrades scope and names missing inputs. Full synthesis is prohibited when any required report is missing, partial, unread, malformed, or noncompliant unless the scope is downgraded to `PARTIAL`.

### `[SCP-IDLE]`

Idle panes must still be auditable:

- `idle_reason`
- `current_state`
- `next_action_owner`
- `next_poll_at_or_waiting_for`
- `no_unreported_dirty_state: true|false`

If a captured pane has 3 or fewer lines and no SCP receipt, post-run audit must classify it as `INSUFFICIENT_EVIDENCE`, not clean.

### `[SCP-FREEZE]`

Emit whenever work is blocked, tainted, limited, or unsafe to continue:

- `freeze_reason`
- `dirty_state`
- `staged_state`
- `untracked_state`
- `last_safe_sha`
- `prohibited_next_actions`
- `required_reactivation_authority`
- `next_required_gates`

`BLOCKED_BY_LIMIT` is mandatory when a provider quota/context limit interrupts a pane before all gates, evidence, push, and closure proof are complete. A `BLOCKED_BY_LIMIT` pane must not self-resume; it requires a fresh `EXEC PM` or ODIN reactivation prompt with branch, HEAD/upstream, scope, prohibited paths, evidence requirements, and acceptance threshold.

Separate `harness_mode` from `governance_mode`. Harness states such as plan mode, read-only, approval-needed, or tool-limited do not by themselves prove SCP bypass. Freeze on governance bypass only when there is concrete write-class evidence, invalid activation, hidden delegation, unledgered mutation, or claim use beyond authority. Plan/read-only blockers are occupant state failures and must trigger blocker, permission assist, or substitution handling inside the same role slot.

Canonical frozen state is `FROZEN`. `FROZEN_IDLE` is a `FROZEN` substate/alias meaning the role is frozen and no active work is in progress. An ODIN may rescind its own false-positive freeze only if no mutation occurred under the freeze, the rescission is ledgered, and the target returns to parked/readiness state only. Otherwise named authority must clear the freeze.

Emit `[SCP-FREEZE]` if:

- a role-named pane/surface is closed without the user authorization;
- `EXEC PM` creates extra panes/workers beyond official topology without the user authorization;
- hidden `spawn_agent` or invisible subagent capacity is used without the user authorization;
- `$delegate` routes outside visible CMUX role slots;
- hidden output is used for QA, closure, branch-visible claims, lifecycle mutation, evidence validation, policy synthesis, or dispatch decisions;
- Gemini is assigned without the user reauthorization under the current local model policy;
- a pod exceeds one active Claude Code instance;
- DEV and QA use the same provider/model family without exception;
- ChatGPT/Codex is used for routine work while non-Codex fallback rungs are available;
- a role skips its fallback ladder without `[SCP-EXCEPTION]`;
- cleanup removes team structure instead of clearing/restarting/substituting the occupant;
- an agent claims exception status without a recorded `[SCP-EXCEPTION]` or the user authorization.

### `[SCP-PERMISSION-ASSIST]`

Emit when `EXEC PM`, the user, ODIN, or an operator approves, clicks through, or sends keys into another role's pane.

Required fields:

- `assisting_actor`
- `affected_role_slot`
- `terminal_locator`
- `exact_command_or_prompt_class`
- `reason_assist_required`
- `was_analysis_or_scope_influenced`
- `independence_impact`
- `confidence_downgrade`
- `downstream_outputs_tainted`
- `next_required_review`

The assisted role must treat the affected output as PM/operator-mediated unless the record proves approval was purely mechanical and did not alter analysis. QA/audit reports using assisted panes must state independence impact and confidence downgrade.

Permissions remain on by default for write, destructive, lifecycle, branch, scope-expanding, external-network, or governance-mutating actions. YOLO/bypass modes are exceptions, not defaults. Permission prompts are control-plane signals: they must be surfaced to the responsible PM, ODIN, or dispatch/switchboard role; classified; and either approved, denied, re-scoped, or used as substitution/freeze evidence.

### `[SCP-ROUND-ROBIN-CHECKPOINT]`

Routine bilateral coordination has `agent_exchange_budget: 3`; high-stakes synthesis or QA loops have max 5 unless the user or `EXEC PM` authorizes a higher limit with a stop condition. One exchange is an outbound message plus the response. Sequence is not authority; refinement is not corroboration. No two agents may continue bilateral debate after checkpoint without divergence reviewer, `EXEC PM` decision, or the user decision. Repeated permission prompts stop after 2 blocked approvals and emit `BLOCKED_BY_PERMISSION`.

Required fields:

- `participants`
- `exchange_count`
- `budget`
- `current_claim`
- `remaining_disagreement`
- `missing_inputs`
- `cost_spent_or_estimated`
- `decision_needed`
- `recommended_next: continue | stop | reassign | substitute | ask_brad`
- `new_budget_if_authorized`
- `stop_condition`

### `[SCP-AGENT-SUBSTITUTION]`

Emit when replacing, restarting, standing down, or clearing an occupant inside an existing role slot.

Required fields:

- `role_slot`
- `terminal_locator`
- `prior_agent`
- `prior_model_harness`
- `new_agent`
- `new_model_harness`
- `fallback_rung_selected`
- `substitution_trigger`
- `terminal_surface_preserved: true`
- `same_role_preserved: true`
- `same_reports_to_preserved: true`
- `same_scope_preserved`
- `cost_guardrail_status`
- `authorized_by`
- `next_required_receipt`

### `[SCP-TOPOLOGY-EXPANSION-REQUEST]`

Emit before adding any role slot, pane, pod, floater, or specialized model/harness outside current official topology.

Required fields:

- `requesting_agent`
- `current_topology_summary`
- `needed_capability`
- `why_existing_roles_cannot_handle_it`
- `proposed_role_slot`
- `proposed_model_harness`
- `cost_tier`
- `scope`
- `duration_or_expiry`
- `risk_if_not_added`
- `brad_authorization_required: true`

### `[SCP-EXCEPTION]`

Emit for any approved deviation from topology, visibility, model mix, fallback ladder, cost, or slot-preservation rules.

Required fields:

- `exception_type`
- `authorizing_human`
- `affected_role_slot`
- `affected_agent_or_surface`
- `reason`
- `why_normal_scp_path_cannot_be_used`
- `model_harness_cost_tier`
- `exact_scope`
- `prohibited_actions`
- `expiry_condition`
- `reconciliation_path`
- `next_required_gate`

### `[SCP-CONTROL-PLANE-MUTATION]`

Required before or with any control-plane governance mutation: canonical skill edits, adapter edits, runtime skill copy changes, sync script changes, lifecycle ledger mutation, branch state mutation, or policy text edits by a control-plane role.

Required fields:

- `mutation_owner`
- `authorizing_human_or_exec`
- `mutation_type`
- `exact_write_scope`
- `prohibited_paths`
- `reason_control_plane_is_implementing`
- `why_DEV_lane_not_used`
- `validation_gates`
- `sync_targets`
- `external_paths_touched`
- `expected_hashes_or_hash_command`
- `independent_ratification_owner`
- `self_acceptance_prohibited: true`
- `expiry_condition`
- `final_claim_blocked_until_ratified`

### `[SCP-CLOSEOUT-META-ANALYSIS]`

Required before `[SCP-FINISH]`, clean/ready claims, skill-change closure, temporary pane cleanup, teardown, or session closure.

Required fields:

- `run_id`
- `closeout_owner`
- `delegated_roles`
- `required_deliverables`
- `deliverable_status_table`
- `missing_or_partial_inputs`
- `failure_state_diagnosis`
- `orchestrator_self_review`
- `synthesis_inputs_used`
- `synthesis_inputs_excluded`
- `confidence_downgrade`
- `corrective_actions`
- `unresolved_risks`
- `brad_decisions_needed`
- `final_claim_allowed: true|false`

Exceptions do not implicitly authorize implementation, QA acceptance, evidence writing, push, merge, cleanup, lifecycle mutation, closure, or finish claims unless those actions are explicitly named.

## Session Closeout Metrics And Improvement Lifecycle

Session closeout is an explicit SCP lifecycle phase. It begins when objectives are achieved or intentionally paused, branch/repo state is clean or classified, QA/quality gates are complete or blocked with owner, next-session path is clear, and `EXEC PM` is ready to hand off. the user may also trigger closeout with `$sentinel-coordination-protocol --finish` or `$sentinel-coordination-protocol --session-closeout`.

At bootstrap, `EXEC PM` must record a `SESSION_OBJECTIVES` contract before broad dispatch:

- objectives,
- success criteria,
- expected stopping point,
- required branch-visible outcomes,
- cleanup expectations,
- handoff standard,
- expected durable evidence paths,
- whether teams are expected to park, stand down, or remain active.

If the user has not supplied these, `EXEC PM` asks concise clarifying questions before broad dispatch.

Before final park, `EXEC PM` must emit `EXEC_PM_SESSION_REPORT` covering:

- material work completed,
- teams/pods created, parked, or stood down,
- every agent, role slot, and occupant deployed,
- tasks assigned by agent,
- deliverables and verdicts,
- repo/worktree/branch state,
- governance-surface state,
- unresolved risks,
- next-session instructions.

Closeout also requires `[SCP-SESSION-METRICS]`. Capture per-agent and per-team tasks assigned, deliverables completed/accepted/rejected/partial/missing, interventions, blockers, permission assists, exchange checkpoints, delivery failures, input-bar-only delivery events, role breaches, hidden-agent violations, cleanup findings, elapsed time if available, token counts/basis, model/harness/cost tier, and token-efficiency notes.

Token accounting policy:

- Prefer harness-reported token counts.
- If unavailable, estimate from transcript/message sizes only when useful and mark `token_count_basis: exact|reported|estimated|unknown`.
- Do not invent precision.
- Track raw tokens first; dollars/cost projections are optional later fields.
- Track scarce hosted quota pools such as `chatgpt_codex` and `claude_code` separately from local/raw token pools.

Efficiency scoring v0 is provisional and comparable, not mature science. Use `metric_version: scp_efficiency_v0`, confidence, and basis fields. Score dimensions on a 0-4 scale unless unavailable: objective completion, QA/evidence quality, branch/repo hygiene, coordination compliance, token efficiency, model-mix diversity, autonomy/low-human-intervention, rework rate, cleanup completeness, and handoff quality. Missing data must be `unknown`, not zero, unless the metric truly failed.

For each delegated task, record task type, assigned role/model/harness, token count/basis, output status, review result, acceptance/verdict, rework count, and efficiency note. Every activated non-standby role occupant should receive at least one bounded smoke/test or real assignment. If omitted, record `standby_exempt` or why startup/fallback should change.

Future local-server, Qwen, DeepSeek, Gemma, Amazon-family, and other local agents are examples of normal role occupants, not hard-coded model policy truth. They require boot receipts, visible role slots, token-pool declaration, and at least one smoke/test or real assignment when activated and not explicitly standby.

Metrics collection should prefer deterministic commands and artifacts over reasoning: CMUX surface inventory/capture, `rg` over transcripts/artifacts, git status/branch checks, sync log hashes, manifest receipts, delivery receipts including `enter_sent`, and harness token reports. Reasoning synthesis happens only after metrics capture and must cite basis.

For skill/protocol changes, preserve one curated session-level decision trace per SCP session, not one per patch or back-and-forth. If multiple skill/protocol changes happen in the same session, append or summarize them together in the same session decision trace because the narrative unit is the session. Raw CMUX logs, proposal artifacts, and sync logs remain local audit evidence unless explicitly promoted.

Decision trace fields:

- `session_id`
- `date`
- `scope`
- `changes_made`
- `why_changed`
- `failure_modes_or_metrics_responded_to`
- `alternatives_rejected_or_deferred`
- `files_or_surfaces_touched`
- `validation_and_hashes`
- `ratification`
- `unresolved_questions`
- `next_session_recommendations`

After handoff, hygiene, metrics, and decision trace, `EXEC PM` asks ODINs, `EXEC QA`, and `EXEC RSCH` for protocol/skill/harness improvement hypotheses. Each hypothesis must include observation, metric signal, proposed change, expected score impact, risk, validation plan, owner, scope, and whether it is patch-now, defer, or reject.

Skill edits are the last closeout action after session data, `EXEC_PM_SESSION_REPORT`, metrics, decision trace, and improvement hypotheses are captured. Any skill patch still requires `[SCP-CONTROL-PLANE-MUTATION]`, validation, sync/hash reporting, and independent, `EXEC PM`, or user ratification.

`EXEC PM` remains parked with the session report, decision trace pointer, metrics snapshot, and next actions. Other teams park, stand down, or become `VACANT_ROLE_SLOT` by durable role-slot policy. Finished teams are parked, not destroyed.

### `[SCP-FINISH]`

Emit when `$sentinel-coordination-protocol --finish` is invoked or relayed:

- `final_state`
- `pushed_commits`
- `dirty_worktrees`
- `staged_or_untracked_files`
- `blockers`
- `evidence_paths`
- `unresolved_risks`
- `temporary_panes_or_agents`
- `terminal_locators_final`
- `handoff_path`

### `[SCP-SESSION-METRICS]`

Emit during session closeout before final park or final self-improvement skill patch.

Required fields:

- `metric_version: scp_efficiency_v0`
- `run_id`
- `session_objectives`
- `collection_basis`
- `per_agent`
- `per_team`
- `score`
- `confidence`
- `unknown_metrics`
- `token_accounting_notes`

Metrics v0 is provisional. Use `unknown` rather than zero for missing data. Require `basis` and `confidence` fields where values are estimated or partial. Do not invent precision.

Recommended schema:

```yaml
scp_session_metrics:
 metric_version: scp_efficiency_v0
 run_id:
 session_objectives:
  objectives: []
  success_criteria: []
  expected_stopping_point:
  required_branch_visible_outcomes: []
  cleanup_expectations: []
  handoff_standard:
 collection_basis:
  cmux_inventory: captured|partial|missing
  git_state: captured|partial|missing
  receipts_scan: captured|partial|missing
  harness_token_reports: exact|reported|partial|missing
  transcript_estimates: used|not_used
 per_agent:
  - role_slot:
   occupant:
   model:
   harness:
   cost_tier:
   token_pool: chatgpt_codex|claude_code|local|other|unknown
   tasks_assigned:
   deliverables_completed:
   deliverables_accepted:
   deliverables_rejected:
   deliverables_partial:
   deliverables_missing:
   interventions:
   blockers:
   permission_assists:
   exchange_checkpoints:
   delivery_failures:
   input_bar_only_events:
   provider:
   provider_token_pool:
   provider_blockers:
   throughput_wait:
   fallback_reason:
   fallback_selected:
   role_breaches:
   hidden_agent_violations:
   elapsed_time_basis: exact|estimated|unknown
   raw_tokens:
   token_count_basis: exact|reported|estimated|unknown
   token_count_confidence: high|medium|low|unknown
   efficiency_note:
   smoke_or_test_assignment: completed|failed|standby_exempt|not_done
 per_team:
  - team:
   role_slots: []
   tasks_assigned:
   accepted:
   rejected:
   partial:
   missing:
   cleanup_findings: []
 score:
  scale: 0-4
  objective_completion:
  qa_evidence_quality:
  branch_repo_hygiene:
  coordination_compliance:
  token_efficiency:
  model_mix_diversity:
  autonomy_low_human_intervention:
  rework_rate:
  cleanup_completeness:
  handoff_quality:
  confidence: high|medium|low
  basis:
  unknown_metrics: []
```

Provider/token-pool metrics must record provider, token pool, raw tokens, token count basis, task result, acceptance/rejection/partial status, rework count, blocker, throughput wait when known, fallback reason, and efficiency note. Provider routing claims must distinguish exact/reported/estimated/unknown token data and must not invent cost precision.

## Finish And Self-Improvement Loop

`$sentinel-coordination-protocol --finish` starts controlled closeout, not product work.

Close-out is not just cleanup. Close-out must prove the coordination process itself was followed, and must diagnose any agent that failed to deliver what it was told to deliver before declaring the run governed or complete.

1. If an ODIN receives the command, relay it to `EXEC PM`.
2. `EXEC PM` broadcasts finish to all active agents.
3. Agents finish only their current safe stopping point, then stop new work and emit `[SCP-FINISH]`.
4. Before synthesis, finish claims, teardown, or temporary pane cleanup, `EXEC PM` emits `[SCP-CLOSEOUT-META-ANALYSIS]`.
5. `EXEC PM` emits `EXEC_PM_SESSION_REPORT`, `[SCP-SESSION-METRICS]`, and a curated session decision trace when skill/protocol changes occurred.
6. `EXEC PM` records a `$handoff` and session report with branch, SHA, worktree, evidence, dirty state, blockers, pane disposition, metrics snapshot, decision trace pointer, and next-session instructions.
7. ODIN captures CMUX pane snapshots and runs the post-run self-audit before temporary panes are closed:
  - one pane auditor per pane,
  - boolean SCP effectiveness heuristic including role-contract compliance, control-plane non-implementation, delegation receipts, CMUX delivery confirmation, poll/action liveness, QA independence, branch proof, and hygiene reset,
  - `$atlas-synthesis` canonical packet,
  - adversarial `$qa-review` panel,
  - protocol/skill patch proposals,
  - metric deltas for the next run.
8. `EXEC PM` performs post-run hygiene reset:
  - prove every non-excluded repo/worktree has a classified branch, HEAD/upstream state, dirty state, staged state, and retained/deferred/deleted disposition,
  - record teardown mode as `PARK_FOR_CONTINUITY` or `FULL_SESSION_SHUTDOWN`,
  - for `PARK_FOR_CONTINUITY`, return standing executive-office and pod control-plane panes to their baseline roles with fresh-context restart or explicit parked handoff,
  - snapshot official topology before cleanup, classify each surface as official role slot vs temporary/ad hoc, and list any proposed closures,
  - in `PARK_FOR_CONTINUITY`, preserve official role slots; cleanup may stand down occupants, clear context, restart agents, mark slots vacant, or request substitution, but it must not close role-named CMUX panes/surfaces,
  - in `FULL_SESSION_SHUTDOWN`, after handoffs and snapshots are captured, explicitly quit each agent occupant using the correct app/harness-specific exit path, verify the occupant is no longer live, then close its CMUX surface/pane; if an occupant only stands down but remains live, classify `AGENT_STOOD_DOWN_NOT_EXITED` and close the surface directly if the user authorized full shutdown,
  - close temporary ad hoc panes only if they are listed as closable in `SCP-TEAM-MANIFEST`, have emitted `[SCP-FINISH]` or are classified stale/unresponsive, have handoff/snapshot captured, and the user or the recorded cleanup policy authorizes closure,
  - if cleanup discovers official role slots were closed during `PARK_FOR_CONTINUITY`, classify `ROLE_SLOT_CLOSURE_VIOLATION` and record restoration or next-run correction; official role-slot closure is expected only under `FULL_SESSION_SHUTDOWN`,
  - clean or archive stray worktrees only when the exact path, branch, dirty state, and approval requirement are recorded,
  - keep UX/design panes and design/prototype worktrees excluded unless the user explicitly includes them with a UX-specific team profile,
  - run `$qa-swarm-review` or equivalent adversarial review over the run's branch-visible artifacts and cleanup report before any clean/ready claim,
  - leave a final hygiene ledger listing active panes, closed panes, retained worktrees, pruned/deferred worktrees, retained local debris, branch SHAs, and unresolved risks.
9. Only after session data, `EXEC_PM_SESSION_REPORT`, metrics, decision trace, and improvement hypotheses are captured may `EXEC PM` authorize a final self-improvement skill patch through `[SCP-CONTROL-PLANE-MUTATION]`.

The close-out meta-analysis must enumerate every delegated agent/role and required deliverable; record each deliverable status as `DELIVERED_FULL`, `DELIVERED_PARTIAL`, `NO_FINDINGS_WITH_SCOPE`, `BLOCKED_PARTIAL_REPORT`, `MISSING`, `MALFORMED`, or `NONCOMPLIANT_OUTPUT`; diagnose any missing/partial/noncompliant deliverable using visible pane state and last receipts; state which findings were incorporated or excluded and why; record orchestrator self-review including premature synthesis, permission assistance, scope changes, or audit bias; apply confidence downgrade where required; and choose corrective action: continue audit, accept partial with downgrade, reassign/substitute inside role slot, ask the user, or park with owner/reason.

When an assigned agent fails, stalls, emits partial output, ignores scope, or does not deliver required findings, the orchestrator must not hand-wave, gloss over, synthesize around, or silently replace the missing deliverable. Required behavior: identify the missing required output; inspect visible pane state and last receipt; classify the failure state; issue a corrective directive or substitution inside the role slot; record whether downstream synthesis is blocked, partial, or safe to proceed; and explicitly state which required inputs were received and which were not before synthesis. Agents must either perform the delegated task exactly, emit a valid blocker/check-in, or emit a bounded partial/no-findings report when stopped. Silent parking after a force-report or required-deliverable directive is a protocol failure. This rule applies to `EXEC PM`: `EXEC PM` must not synthesize before required reports arrive unless it explicitly downgrades to `PARTIAL` and states missing inputs and reason.

Delivery failures, including `INPUT_BAR_ONLY` messages where Enter was not sent or not confirmed, must be included in closeout failure-state analysis and `[SCP-SESSION-METRICS]` as delivery failures or interventions. They are not valid coordination exchanges until followed up with confirmed delivery.

The finish loop is observational and governance-only. It must not mutate product code, runtime state, design artifacts, holdout files, agent worktrees, or lifecycle state except explicitly authorized protocol/skill artifacts and local audit outputs.

Post-run hygiene is not proof of product readiness. It is only proof that the orchestration surface has been returned to a known, auditable state.

A finished team is parked, not destroyed, unless the user has explicitly selected `FULL_SESSION_SHUTDOWN`; in that mode the goal is a verified quiet surface set, not durable visible role-slot preservation.

## Terminal State Vocabulary

Use exact bounded states. Do not use unqualified `Done`, `PASS`, `VERIFIED`, `closed`, `complete`, `fixed`, `accepted`, or `resolved` unless adversarial QA acceptance and branch-visible proof both exist.

Allowed pre-acceptance states:

- `BOOTSTRAPPED_IDLE`: pane launched, role acknowledged, no work active, no dispatch authority consumed.
- `BOOT_RECEIPT_PARTIAL`: minimal boot receipt present; full receipt deferred until activation or mutation.
- `BOOT_RECEIPT_BLOCKED`: pane paused on permission, auth, plan-mode, quota, or context issue before a valid receipt.
- `READINESS_ONLY`: checklist/preflight only; no QA executed and no verdict issued.
- `DEV_COMPLETE_QA_PENDING`: DEV implementation is ready for independent QA; QA has not accepted it.
- `QA_INCOMPLETE`: QA started but did not complete all required gates.
- `BLOCKED_BY_LIMIT`: provider/context/quota limit interrupted work.
- `BLOCKED_BY_PERMISSION`: pane is blocked on a permission, approval, auth, modal, or plan/read-only prompt and cannot proceed without recorded assistance, reissue, or substitution.
- `PLAN_MODE_EXIT_FAILURE`: agent or operator could not transition a role occupant from plan/read-only mode into the required authorized execution mode.
- `PERMISSION_WAIT_TIMEOUT`: downstream role occupant waited on permission beyond session SLA or two poll intervals without responsible PM/ODIN/dispatch response.
- `MISSED_CMUX_NOTIFICATION`: CMUX/terminal attention state was available but not observed or routed in time by the responsible polling role.
- `PM_POLLING_MISS`: `EXEC PM` or `TEAM PM` missed a required subordinate poll, permission wait, delivery failure, or notification event.
- `DISPATCH_RELAY_REQUIRED`: dispatch/switchboard relay was needed to route attention or unblock a waiting role.
- `PROVIDER_BLOCKER`: selected inference provider/token pool was blocked by throughput, rate-limit, quality, auth, tool support, or other provider-health issue.
- `MALFORMED_COORDINATION`: coordination packet is missing required fields, contains conflicting instructions, or is a bare/non-instructive header.
- `INSUFFICIENT_EVIDENCE`: available screen, artifact, or report data is too incomplete to support the requested conclusion.
- `PARTIAL_REPORT`: report covers only declared subset of requested scope and cannot support full synthesis.
- `NONCOMPLIANT_OUTPUT`: delivered output does not satisfy the requested format, scope, fields, or authority contract.
- `SILENT_HOLD`: agent remains parked or non-responsive after a force-report or required-deliverable directive without a valid blocker.
- `ROLE_BREACH`: agent exceeded or blurred role authority, including control-plane implementation or QA acceptance without exception.
- `TAINTED_CLOSURE_ATTEMPT`: a closure/lifecycle/evidence commit path failed or became contaminated.
- `FROZEN`: work stopped pending `EXEC PM` or ODIN decision.
- `FROZEN_IDLE`: `FROZEN` substate/alias; work is stopped and no active work is in progress.
- `QUARANTINED`: route must not be repaired, committed, pushed, or reused without explicit `EXEC PM` reactivation.
- `VACANT_ROLE_SLOT`: role-named pane/surface exists, but no active agent occupant is running.
- `AGENT_STOOD_DOWN`: prior occupant exited or was stopped; role slot retained.
- `AGENT_CONTEXT_RESET_REQUIRED`: same model/harness remains correct, but context must be cleared before reuse.
- `AGENT_RESTART_REQUIRED`: same model/harness remains correct, but process must be restarted.
- `AGENT_SUBSTITUTION_REQUIRED`: role slot remains, but occupant model/harness must change.
- `FALLBACK_RUNG_EXHAUSTED`: all authorized fallback occupants for the role failed or are unavailable.
- `COST_GUARDRAIL_BLOCKED`: role cannot continue on current provider/model because budget/quota pressure violates model mix policy.
- `HIDDEN_AGENT_VIOLATION`: hidden subagent or non-visible fork was used without explicit user-authorized exception.
- `ROLE_SLOT_CLOSURE_VIOLATION`: role-named pane/surface was closed or deleted without explicit the user authorization.
- `MODEL_MIX_VIOLATION`: active model/harness assignment violates the declared model mix policy.
- `TOPOLOGY_EXPANSION_REQUESTED`: new role slot, pane, pod, floater, or specialized model/harness has been requested and awaits the user decision.
- `TOPOLOGY_EXPANSION_BLOCKED_PENDING_BRAD`: topology expansion is blocked until the user explicitly authorizes it.

If repo mechanics require moving a DEV slice to `done/` before independent QA, the handoff and ledger must say `DEV_COMPLETE_QA_PENDING`; it is not lifecycle closure.

## Role And QA Hard Gates

- Control-plane panes are command, coordination, monitoring, and QA-health surfaces. They may edit only governance, ledger, status, or remediation artifacts explicitly named by the user or `EXEC PM`.
- Control-plane roles including `EXEC PM`, `EXEC ODIN`, `EXEC ASST`, `EXEC RSCH`, `EXEC QA`, `TEAM PM`, and `TEAM ODIN` may do read-only proof, audit, coordination, CMUX delivery, polling, and blocker reporting by default. Implementation, QA acceptance, branch mutation, evidence writing, lifecycle mutation, push, merge, cleanup, or closure claims require explicit scoped authorization.
- Product/source/test/evidence implementation must be delegated to `DEV WORKER` capacity. Control-plane reclassification is not self-service and requires the worker-exception record above.
- `EXEC PM` or orchestration authority does not imply product-code write authority.
- ODIN authority does not imply product implementation authority.
- `TEAM PM` authority means pod assignment routing, worker activation, pod status, and escalation. It does not mean implementation, QA acceptance, or lifecycle closure.
- `TEAM ODIN` authority means push work downstream, verify delivery, poll, intervene, freeze unsafe lanes, and report. It does not mean "do the worker's task faster."
- Worker agents never self-select work during SCP runs. They receive canonical scope from `EXEC PM`, `TEAM PM`, `TEAM ODIN`, or a recorded queue/dispatch artifact.
- If model/harness substitution is needed, preserve role, scope, evidence gates, and reporting chain. Do not let a replacement agent inherit broader authority from the replaced pane's brand or prior context.
- QA must visibly read or invoke `qa-review` before any QA verdict, QA evidence claim, QA-slice lifecycle mutation, or acceptance language.
- QA may write review artifacts within its declared evidence/verdict scope, but may not move its own QA slice to `done/`, mark it `VERIFIED`, or claim closure. External `EXEC PM` or ODIN closure gate must verify tracked evidence, cached scope, slice validator, diff check, hook health, push, and `HEAD == @{u}` first.
- Missing evidence bundle, untracked required evidence, missing `before/`, missing `after/`, missing `verify.log`, or validator exit 1 means `QA_INCOMPLETE` or `BLOCKED`; the same QA pane must not create missing evidence and continue to PASS in the same context.
- Plan-only gates, liveness checks, summaries, and "looks good" are not adversarial QA.

## Hook, Validator, And Permission Decision Table

- Any hook output containing `blocking error` requires `[SCP-FREEZE]` unless a named `HOOK-EXCEPTION` is recorded.
- `HOOK-EXCEPTION` must include: owner, hook name, exact command, exit status, why the hook is non-governing, compensating validators, scope proof, branch proof, expiration, and artifact location.
- `SKIP_*`, `NO_*`, `BYPASS_*`, `--no-verify`, dangerous permission flags, and equivalent bypasses are governance bypasses by default.
- A bypass flag is allowed only when the user or `EXEC PM` explicitly authorizes the exact flag for the exact non-governing hook and the pane records compensating validators. Hook help text is not authorization.
- Missing expected validator path means stop and ask for the canonical path. Do not substitute a narrower validator unless `EXEC PM` explicitly authorizes it with compensating validators.
- Non-blocking PreToolUse or PostToolUse hook errors in governance-sensitive writes must be recorded as `HOOK HEALTH: WATCH` or escalated before closure language.

## Branch, Scope, And Evidence Preclaim Gates

Before any claim, lifecycle mutation, evidence verdict, commit, or push, run and capture:

```bash
git status --short --branch --untracked-files=all
git rev-parse --abbrev-ref --symbolic-full-name @{u}
git rev-parse HEAD @{u}
git diff --cached --name-status
```

If upstream is not the declared branch authority, stop before mutation. If `HEAD` and `@{u}` differ for a branch-visible closure claim, stop before mutation.

If excluded or out-of-scope debris appears, especially private story-review planning paths, runtime logs, holdout paths, design artifacts, external memory paths, or non-branchable paths, stop and require `EXEC PM` classification before lifecycle mutation or evidence verdict.

Before any `status: Done`, `PHASE: VERIFIED`, `VERDICT: PASS`, active-to-done move, commit, or push, run the slice/evidence validators required by the dispatch. At minimum for slice/evidence work:

```bash
bash scripts/validate-evidence-bundle.sh --require-tracked <slice-id>
bash lib/scripts/validate-slice.sh <slice-file>
git diff --check
git diff --cached --name-status
```

If a closure/evidence hook fails after a lifecycle move or verdict attempt, mark `TAINTED_CLOSURE_ATTEMPT`. Default action is quarantine and fresh route reassignment. Do not repair evidence, commit, push, or close from that route unless `EXEC PM` explicitly reactivates it and labels reconstructed evidence as lower-trust.

## Core Workflow

1. Verify package provenance.
  - Confirm the zip exists.
  - Capture `unzip -l` and `shasum -a 256`.
  - Extract only to a temp directory.
  - Read `00-SCP-protocol.md`, especially sections 0, 6, 7, 8, 10, 18, and 20.

2. Land the package, but do not activate it.
  - Canonical package path: the operator-declared governance planning package path.
  - Package landing branch: use a deterministic ops branch unless the user supplies another branch.
  - Ledger branch: `ops/ledger` for `ledger.yaml`.
  - If branch topology is ambiguous or conflicts with current repo state, stop and ask the user.

3. Create adoption-gate scaffolding.
  - governance adoption gate artifact
  - governance ledger artifact
  - `tools/agentic-executive-mgmt/audit/banned-phrases.txt`
  - `tools/agentic-executive-mgmt/qa-review/RUBRIC.md`
  - Other artifact directories required by the SCP package.

4. Install or verify local skill/adapters.
  - Native SKILL.md surfaces get this skill directory.
  - Non-native harnesses get an adapter prompt that points them at the canonical skill and SCP repo package.
  - Do not claim a harness has native skill support unless verified from local CLI/config.

5. Validate before adoption.
  - `git diff --check`
  - `bash scripts/validate-planning-integrity.sh`
  - `bash scripts/validate-artifact-sync.sh`
  - Banned-phrases audit against the committed package.
  - Adversarial `$qa-review` or rubric-equivalent 16-point review of the SCP package itself. Minimum 14/16, no CRITICAL, no HIGH, evidence authentic.

6. Disseminate in two steps.
  - Pre-activation notice: awareness only, no behavior switch.
  - Activation announcement: only after the adoption gate is branch-visible, QA-accepted, ledger scaffolded, and the user or the CXO declares transition.

## Meta-Governance Recursion

SCP applies the same Dev/QA contract that governs code execution to the execution of organizational strategy itself.

In code work:

- DEV implements bounded scope and produces evidence.
- QA verifies independently and does not accept their own work.
- TEAM PM routes tasks to workers; `A/EXEC-PM` authorizes and frames claims.

In organizational work:

- TEAM PM is the Dev of org strategy. It implements the staffing assignments, surface placements, and delegations issued by `A/EXEC-PM` — subject to the constraint that TEAM PM cannot self-staff.
- `A/EXEC-PM` is the dispatcher of org strategy. It issues the org orders and owns staffing and surface custodianship exclusively.
- ODIN agents are the QA of org strategy. They audit whether `A/EXEC-PM`'s org orders are executed correctly, whether surface custodianship is honored, whether protocol adherence holds, whether context windows are healthy, and whether contracts remain accountable.

This recursion is why the same protocol governs both code work and organizational work without growing new vocabulary. A pod committing a DEV/QA breach and an executive office committing a staffing-gate breach are the same shape of violation, escalated through the same intervention authority.

## Reference Files

- `references/canonical-introduction-prompt.md`: official prompt to give the `EXEC PM` pane for repo landing, validation, adoption-gate proof, and dissemination. Legacy/session alias: `codex-pm`.
- `references/harness-skill-targets.md`: local harness install matrix and fallback policy.
- `references/boot-receipt-examples.md`: canonical `SCP_BOOT_RECEIPT` examples for `EXEC PM`, `TEAM ODIN`, `DEV WORKER`, and `QA WORKER`.
- `references/team-bootstrap-runbook.md`: terminal/CMUX self-bootstrap, harness launch, pod setup, teardown, and hygiene runbook for one-pane-to-many-pod operation.

Load the prompt reference when the user asks for the official SCP introduction prompt or asks the `EXEC PM` pane to implement/disseminate SCP.
