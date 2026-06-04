# SCP Boot Receipt Examples

Use these as patterns. Replace placeholder values with live command output.

## Minimal Bootstrap Receipt

Use this only for initial pane readiness and parking. It is not enough to activate work, mutate files, perform QA, commit, push, or claim closure.

```yaml
SCP_MIN_BOOT_RECEIPT:
  agent_id: c-dev-1
  team: C
  role: DEV WORKER
  reports_to: C/TEAM-PM
  cwd: <pwd or EXEC PM supplied>
  branch: <branch or EXEC PM supplied>
  head_sha: <sha or EXEC PM supplied>
  may_implement: false
  may_qa_accept: false
  permission_mode: READ_ONLY
  current_state: BOOTSTRAPPED_IDLE
  terminal_locator:
    terminal_app: cmux
    terminal_adapter: cmux
    workspace_ref: <workspace:1>
    workspace_id: <uuid-or-unavailable>
    window_ref: <window-or-unavailable>
    window_id: <uuid-or-unavailable>
    pane_ref: <pane>
    pane_id: <uuid-or-unavailable>
    surface_ref: <surface>
    surface_id: <uuid-or-unavailable>
    tab_ref: <tab-or-unavailable>
    tab_id: <uuid-or-unavailable>
    surface_type: terminal
    title: C/DEV-1
    route_command: cmux send --workspace <workspace> --surface <surface>
    locator_source: EXEC PM supplied from cmux --json --id-format both
    locator_captured_at: <ISO-8601 timestamp>
  target_sha_or_base: <declared base>
  proof_source: EXEC PM supplied branch/SHA/cwd/locator plus pane role acknowledgment
  next_expected_receipt: SCP_BOOT_RECEIPT before activation
```

## EXEC PM

```yaml
SCP_BOOT_RECEIPT:
  agent_id: a-exec-pm
  terminal_locator:
    terminal_app: cmux
    terminal_adapter: cmux
    workspace_ref: <workspace:1>
    workspace_id: <uuid>
    window_ref: <window:1>
    window_id: <uuid>
    pane_ref: <pane:47>
    pane_id: <uuid>
    surface_ref: <surface:40>
    surface_id: <uuid>
    tab_ref: <tab:40>
    tab_id: <uuid>
    surface_type: terminal
    title: A/EXEC-PM
    route_command: cmux send --workspace <workspace> --surface <surface>
    locator_source: cmux --json --id-format both identify
    locator_captured_at: <ISO-8601 timestamp>
  vt_state_snapshot:
    vt_provider: unavailable
    vt_api_stability: unknown
    terminal_instance_ref: unavailable
    terminal_instance_id: unavailable
    pty_ref: unavailable
    capture_source: cmux read-screen
    formatter_format: plain
    rows: unavailable
    cols: unavailable
    total_rows: unavailable
    scrollback_rows: unavailable
    width_px: unavailable
    height_px: unavailable
    active_screen: unavailable
    cursor_x: unavailable
    cursor_y: unavailable
    cursor_visible: unavailable
    cursor_pending_wrap: unavailable
    title: A/EXEC-PM
    pwd: unavailable
    render_dirty: unavailable
    semantic_prompt_observed: unavailable
    semantic_input_observed: unavailable
    semantic_output_observed: unavailable
    paste_safety_checked: unavailable
    paste_safe: unavailable
    key_encoding_provider: unavailable
    mouse_encoding_provider: unavailable
    focus_encoding_provider: unavailable
    snapshot_captured_at: <ISO-8601 timestamp>
  team: A
  role: EXEC PM
  authority_layer: executive
  model_harness: <model>/<harness>
  cost_tier: high_reasoning
  capability_profile: orchestration, authorization, branch-visible claim framing
  cwd: <pwd>
  branch: <git branch --show-current>
  upstream: <git rev-parse --abbrev-ref --symbolic-full-name @{u}>
  head_sha: <git rev-parse HEAD>
  target_sha_or_base: <declared base>
  may_implement: false
  may_qa_accept: false
  delegates_to: [EXEC ASST, EXEC RSCH, EXEC QA, TEAM PM, TEAM SENTINEL]
  reports_to: human operator
  worker_exception_authority: human operator only
  write_scope: governance/control artifacts explicitly assigned
  read_scope: active repo, evidence, panes, handoffs
  prohibited_paths: product source, runtime mutation, holdout, secrets, design unless authorized
  evidence_path: <control evidence or handoff path>
  terminal_state_vocabulary: READINESS_ONLY, FROZEN, QUARANTINED, DEV_COMPLETE_QA_PENDING
  proof_source: pwd; git status; git rev-parse HEAD @{u}
  permission_mode: <declared mode>
```

## TEAM PM

```yaml
SCP_BOOT_RECEIPT:
  agent_id: c-team-pm
  terminal_locator:
    terminal_app: cmux
    terminal_adapter: cmux
    workspace_ref: <workspace:1>
    workspace_id: <uuid>
    window_ref: <window:1>
    window_id: <uuid>
    pane_ref: <pane>
    pane_id: <uuid>
    surface_ref: <surface>
    surface_id: <uuid>
    tab_ref: <tab>
    tab_id: <uuid>
    surface_type: terminal
    title: C/TEAM-PM
    route_command: cmux send --workspace <workspace> --surface <surface>
    locator_source: EXEC PM supplied from cmux --json --id-format both
    locator_captured_at: <ISO-8601 timestamp>
  vt_state_snapshot:
    vt_provider: unavailable
    vt_api_stability: unknown
    terminal_instance_ref: unavailable
    terminal_instance_id: unavailable
    pty_ref: unavailable
    capture_source: cmux read-screen
    formatter_format: plain
    rows: unavailable
    cols: unavailable
    total_rows: unavailable
    scrollback_rows: unavailable
    width_px: unavailable
    height_px: unavailable
    active_screen: unavailable
    cursor_x: unavailable
    cursor_y: unavailable
    cursor_visible: unavailable
    cursor_pending_wrap: unavailable
    title: C/TEAM-PM
    pwd: unavailable
    render_dirty: unavailable
    semantic_prompt_observed: unavailable
    semantic_input_observed: unavailable
    semantic_output_observed: unavailable
    paste_safety_checked: unavailable
    paste_safe: unavailable
    key_encoding_provider: unavailable
    mouse_encoding_provider: unavailable
    focus_encoding_provider: unavailable
    snapshot_captured_at: <ISO-8601 timestamp>
  team: C
  role: TEAM PM
  authority_layer: pod_assignment_owner
  model_harness: <model>/<harness>
  cost_tier: high_reasoning_or_mid_reasoning
  capability_profile: pod routing, worker activation, pod status, escalation
  cwd: <pwd>
  branch: <branch>
  upstream: <upstream>
  head_sha: <sha>
  target_sha_or_base: <declared base>
  may_implement: false
  may_qa_accept: false
  delegates_to: [C/DEV-1, C/QA-1, C/SHADOW-1]
  reports_to: EXEC PM
  worker_exception_authority: human operator or EXEC PM with branch-visible exception record
  write_scope: pod ledger, prompts, pod handoff only
  read_scope: assigned pod panes, assigned artifacts, validators
  prohibited_paths: worker deliverables, product source, QA acceptance artifacts unless assigned
  evidence_path: <pod ledger or handoff>
  terminal_state_vocabulary: BOOTSTRAPPED_IDLE, READINESS_ONLY, FROZEN, QUARANTINED
  proof_source: pwd; git status; git rev-parse HEAD @{u}; cmux read-screen
  permission_mode: <declared mode>
```

## TEAM SENTINEL

```yaml
SCP_BOOT_RECEIPT:
  agent_id: c-team-sentinel
  terminal_locator:
    terminal_app: cmux
    terminal_adapter: cmux
    workspace_ref: <workspace:1>
    workspace_id: <uuid>
    window_ref: <window:1>
    window_id: <uuid>
    pane_ref: <pane>
    pane_id: <uuid>
    surface_ref: <surface>
    surface_id: <uuid>
    tab_ref: <tab>
    tab_id: <uuid>
    surface_type: terminal
    title: C/TEAM-SENTINEL
    route_command: cmux send --workspace <workspace> --surface <surface>
    locator_source: cmux --json --id-format both identify
    locator_captured_at: <ISO-8601 timestamp>
  vt_state_snapshot:
    vt_provider: unavailable
    vt_api_stability: unknown
    terminal_instance_ref: unavailable
    terminal_instance_id: unavailable
    pty_ref: unavailable
    capture_source: cmux read-screen
    formatter_format: plain
    rows: unavailable
    cols: unavailable
    total_rows: unavailable
    scrollback_rows: unavailable
    width_px: unavailable
    height_px: unavailable
    active_screen: unavailable
    cursor_x: unavailable
    cursor_y: unavailable
    cursor_visible: unavailable
    cursor_pending_wrap: unavailable
    title: C/TEAM-SENTINEL
    pwd: unavailable
    render_dirty: unavailable
    semantic_prompt_observed: unavailable
    semantic_input_observed: unavailable
    semantic_output_observed: unavailable
    paste_safety_checked: unavailable
    paste_safe: unavailable
    key_encoding_provider: unavailable
    mouse_encoding_provider: unavailable
    focus_encoding_provider: unavailable
    snapshot_captured_at: <ISO-8601 timestamp>
  team: C
  role: TEAM SENTINEL
  authority_layer: team_control_lead
  model_harness: <model>/<harness>
  cost_tier: high_reasoning
  capability_profile: watchdog control, polling, intervention, scope control
  cwd: <pwd>
  branch: <branch>
  upstream: <upstream>
  head_sha: <sha>
  target_sha_or_base: <declared base>
  may_implement: false
  may_qa_accept: false
  delegates_to: [C/TEAM-PM, C/DEV-1, C/QA-1, C/SHADOW-1]
  reports_to: EXEC PM
  coordination_note: C/TEAM-PM owns normal worker activation; TEAM SENTINEL may relay corrective prompts and freeze unsafe lanes.
  worker_exception_authority: human operator or EXEC PM with branch-visible exception record
  write_scope: control ledger, prompts, lane handoff only
  read_scope: assigned pod panes, assigned artifacts, validators
  prohibited_paths: worker deliverables, product source, QA acceptance artifacts unless assigned
  evidence_path: <lane ledger or handoff>
  terminal_state_vocabulary: READINESS_ONLY, FROZEN, QUARANTINED
  proof_source: pwd; git status; git rev-parse HEAD @{u}; cmux read-screen
  permission_mode: <declared mode>
```

## DEV WORKER

```yaml
SCP_BOOT_RECEIPT:
  agent_id: c-dev-1
  terminal_locator:
    terminal_app: tmux
    terminal_adapter: tmux
    workspace_ref: <session-name>
    workspace_id: unavailable
    window_ref: <window-index-or-name>
    window_id: <window-id-or-unavailable>
    pane_ref: <%pane-id>
    pane_id: <%pane-id>
    surface_ref: <%pane-id>
    surface_id: unavailable
    tab_ref: unavailable
    tab_id: unavailable
    surface_type: terminal
    title: C/DEV-1
    route_command: tmux send-keys -t <session:window.%pane> '<message>' Enter
    locator_source: tmux display-message -p
    locator_captured_at: <ISO-8601 timestamp>
  vt_state_snapshot:
    vt_provider: terminal-capture
    vt_api_stability: unknown
    terminal_instance_ref: unavailable
    terminal_instance_id: unavailable
    pty_ref: <tty or unavailable>
    capture_source: tmux capture-pane
    formatter_format: plain
    rows: <tmux pane_height or unavailable>
    cols: <tmux pane_width or unavailable>
    total_rows: unavailable
    scrollback_rows: unavailable
    width_px: unavailable
    height_px: unavailable
    active_screen: unavailable
    cursor_x: unavailable
    cursor_y: unavailable
    cursor_visible: unavailable
    cursor_pending_wrap: unavailable
    title: C/DEV-1
    pwd: <pane_current_path or unavailable>
    render_dirty: unavailable
    semantic_prompt_observed: unavailable
    semantic_input_observed: unavailable
    semantic_output_observed: unavailable
    paste_safety_checked: false
    paste_safe: unavailable
    key_encoding_provider: terminal
    mouse_encoding_provider: terminal
    focus_encoding_provider: terminal
    snapshot_captured_at: <ISO-8601 timestamp>
  team: C
  role: DEV WORKER
  authority_layer: worker
  model_harness: <model>/<harness>
  cost_tier: bounded_execution
  capability_profile: implementation inside exact write scope, evidence capture
  cwd: <pwd>
  branch: <branch>
  upstream: <upstream>
  head_sha: <sha>
  target_sha_or_base: <declared base>
  may_implement: true
  may_qa_accept: false
  delegates_to: []
  reports_to: C/TEAM-SENTINEL
  worker_exception_authority: not_applicable
  write_scope: <exact files or directories from slice>
  read_scope: <required reading list>
  prohibited_paths: outside write scope, holdout, secrets, unrelated design/runtime
  evidence_path: <dev evidence path declared by dispatch>
  terminal_state_vocabulary: DEV_COMPLETE_QA_PENDING, BLOCKED_BY_LIMIT, FROZEN
  proof_source: assigned slice; pwd; git status; validators
  permission_mode: <declared mode>
```

## QA WORKER

```yaml
SCP_BOOT_RECEIPT:
  agent_id: c-qa-1
  terminal_locator:
    terminal_app: unknown
    terminal_adapter: unavailable
    workspace_ref: unavailable
    workspace_id: unavailable
    window_ref: unavailable
    window_id: unavailable
    pane_ref: unavailable
    pane_id: unavailable
    surface_ref: unavailable
    surface_id: unavailable
    tab_ref: unavailable
    tab_id: unavailable
    surface_type: unknown
    title: C/QA-1
    route_command: unavailable
    locator_source: self-reported; not independently verified
    locator_captured_at: unavailable
  vt_state_snapshot:
    vt_provider: unavailable
    vt_api_stability: unknown
    terminal_instance_ref: unavailable
    terminal_instance_id: unavailable
    pty_ref: unavailable
    capture_source: unavailable
    formatter_format: unavailable
    rows: unavailable
    cols: unavailable
    total_rows: unavailable
    scrollback_rows: unavailable
    width_px: unavailable
    height_px: unavailable
    active_screen: unavailable
    cursor_x: unavailable
    cursor_y: unavailable
    cursor_visible: unavailable
    cursor_pending_wrap: unavailable
    title: C/QA-1
    pwd: unavailable
    render_dirty: unavailable
    semantic_prompt_observed: unavailable
    semantic_input_observed: unavailable
    semantic_output_observed: unavailable
    paste_safety_checked: unavailable
    paste_safe: unavailable
    key_encoding_provider: unavailable
    mouse_encoding_provider: unavailable
    focus_encoding_provider: unavailable
    snapshot_captured_at: unavailable
  team: C
  role: QA WORKER
  authority_layer: worker
  model_harness: <model>/<harness>
  cost_tier: bounded_review
  capability_profile: adversarial qa-review, evidence authenticity, independent gates
  cwd: <pwd>
  branch: <branch>
  upstream: <upstream>
  head_sha: <sha>
  target_sha_or_base: <dev commit or evidence base>
  may_implement: false
  may_qa_accept: true
  delegates_to: []
  reports_to: C/TEAM-SENTINEL or EXEC QA
  worker_exception_authority: not_applicable
  write_scope: QA report/evidence paths only
  read_scope: DEV evidence, changed files, validators, slice contract
  prohibited_paths: product implementation, own lifecycle closure, hidden holdout, secrets
  evidence_path: <qa evidence path declared by dispatch>
  terminal_state_vocabulary: QA_INCOMPLETE, FROZEN, ACCEPT, REJECT
  proof_source: qa-review; independent validator commands; git status
  permission_mode: <declared mode>
```
