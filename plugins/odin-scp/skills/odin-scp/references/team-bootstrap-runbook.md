# SCP Team Bootstrap Runbook

Use this when a single `EXEC PM` pane must create, operate, and tear down SCP teams in CMUX or another terminal surface manager.

## Required Inputs

- Objective and phase boundary.
- Target repo/worktree/branch/SHA.
- Pod count, default 3 federated pods unless human operator specifies otherwise.
- Team exceptions, especially UX/design teams.
- Allowed harness/model pool and any budget/cost priority.

If any input is missing, choose the conservative default and record it in `SCP-TEAM-MANIFEST`. Ask human operator only when missing information changes authority, scope, destructive cleanup, or cost materially.

## Skill Composition

- Use `team-composition-patterns` to choose minimum viable pod shape.
- Use `dispatching-parallel-agents` only after workstreams are independent and write scopes do not conflict.
- Use `delegate` for harness/model selection, preflight probes, fallback ladder, and instruction bundles.
- Use `handoff` for parked retained panes.
- Use `qa-swarm-review` for cleanup or closure review.
- Use `atlas-synthesis` for post-run SCP improvement packets.

## Default Three-Pod Layout

```yaml
executive_office:
  - pane: A/EXEC-PM
    role: EXEC PM
  - pane: A/EXEC-ASST
    role: EXEC ASST
  - pane: A/EXEC-RSCH
    role: EXEC RSCH
  - pane: A/EXEC-QA
    role: EXEC QA
pods:
  - team: B
    panes: [B/TEAM-PM, B/TEAM-SENTINEL, B/DEV-1, B/QA-1, B/SHADOW-1]
  - team: C
    panes: [C/TEAM-PM, C/TEAM-SENTINEL, C/DEV-1, C/QA-1, C/SHADOW-1]
  - team: D
    panes: [D/TEAM-PM, D/TEAM-SENTINEL, D/DEV-1, D/QA-1, D/SHADOW-1]
floaters:
  - A/INTEGRATION-STEWARD
  - A/QUEUE-TRIAGE
```

Start smaller when the objective is narrow. Add pods horizontally only when the queue has independent work, non-overlapping write scopes, and enough QA capacity.

`TEAM PM` and `TEAM SENTINEL` are separate control roles. `TEAM PM` routes pod assignments and activates workers. `TEAM SENTINEL` watches delivery, scope, role discipline, branch proof, and intervention health. Neither implements or QA-closes by default.

## Terminal Setup Pattern

Use live CMUX commands only after identifying the current workspace. If operating in tmux, WezTerm, iTerm2, Ghostty, Warp, Cursor, Zed, VS Code, libghostyy, or another surface manager, capture the equivalent `terminal_locator` fields and mark unsupported fields `unavailable`.

If the surface manager exposes libghostty-vt or a congruent terminal-state API, also capture `vt_state_snapshot`. Keep this separate from `terminal_locator`: libghostty-vt models terminal emulator state such as terminal instances, rows/cols, active screen, cursor, scrollback, render dirty state, formatter output, semantic prompt state, and input encoding; it does not by itself define SCP team identity or CMUX-style workspace routing.

```bash
/Applications/cmux.app/Contents/Resources/bin/cmux --json --id-format both current-workspace
/Applications/cmux.app/Contents/Resources/bin/cmux --json --id-format both identify --workspace <workspace> --surface <surface>
/Applications/cmux.app/Contents/Resources/bin/cmux --json --id-format both list-pane-surfaces --workspace <workspace>
/Applications/cmux.app/Contents/Resources/bin/cmux new-surface --type terminal --workspace <workspace>
/Applications/cmux.app/Contents/Resources/bin/cmux rename-tab --workspace <workspace> --surface <surface> 'C/TEAM-SENTINEL'
/Applications/cmux.app/Contents/Resources/bin/cmux send --workspace <workspace> --surface <surface> '<launch command or boot prompt>'
/Applications/cmux.app/Contents/Resources/bin/cmux send-key --workspace <workspace> --surface <surface> Enter
/Applications/cmux.app/Contents/Resources/bin/cmux read-screen --workspace <workspace> --surface <surface> --lines 80 --scrollback
```

Do not claim delivery until send, enter, read-screen, and ack state are recorded in `[SCP-CMUX-DELIVERY]` or `[SCP-TERMINAL-DELIVERY]`.

Use these delivery verdicts:

- `DELIVERED_ACKED`: send/enter/read-screen completed and ack observed.
- `DELIVERED_NO_ACK`: message landed but no ack yet; poll again.
- `INPUT_BAR_ONLY`: text was not submitted; not delivered.
- `PANE_BLOCKED_ON_PERMISSION`: plan mode, auth, quota, modal, or permission blocker.
- `PANE_STILL_THINKING`: instruction landed and pane is still processing.

## Fast Bootstrap Mode

For initial team creation, do not require every idle pane to emit the full `SCP_BOOT_RECEIPT`. Use `SCP_MIN_BOOT_RECEIPT` to park panes quickly, then require full `SCP_BOOT_RECEIPT` only before activation, dispatch, mutation, QA, commit, push, or closure language.

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
  permission_mode: DEGRADED_READ_ONLY | READ_ONLY | WRITE_WHEN_ACTIVATED
  current_state: BOOTSTRAPPED_IDLE
```

Minimal boot receipt states:

- `BOOTSTRAPPED_IDLE`: pane launched, role acknowledged, no work active.
- `BOOT_RECEIPT_PARTIAL`: minimal receipt present, full receipt deferred until activation.
- `BOOT_RECEIPT_BLOCKED`: pane paused on permission, auth, quota, context, or plan-mode issue.

When EXEC PM has exact CMUX/tmux/terminal refs, provide them in the boot prompt. Pane self-report is secondary and should not override adapter-captured locator ids.

## Plan-Mode Bootstrap

Claude Code and similar harnesses may pause for approval on reads or shell proof. During bootstrap-only runs:

- Safe to approve or pre-supply: SCP/AGENTS/handoff reads, `pwd`, `git status --short --branch --untracked-files=all`, `git rev-parse HEAD @{u}`, `cmux identify`, `cmux read-screen`, and receipt acknowledgment.
- Keep blocked: writes, lifecycle moves, evidence/verdict creation, implementation, QA acceptance, commits, pushes, destructive cleanup, and secret output.
- If the pane is stuck in plan mode, EXEC PM may supply cwd/branch/SHA/locator proof and request `SCP_MIN_BOOT_RECEIPT` only.
- Do not dispatch real work to a plan-mode pane until full receipt and activation proof are present.

## SCP-TEAM-MANIFEST

Record the manifest before dispatching work.

During no-product-work bootstrap, the manifest may remain runtime-only in the EXEC PM transcript, screen report, or status ledger. Before dispatch, mutation, QA activation, commit, push, finish, or clean/ready claims, promote the manifest to a durable handoff, ledger, or branch-visible artifact appropriate to the run.

```yaml
SCP-TEAM-MANIFEST:
  created_by: A/EXEC-PM
  workspace: <semantic workspace label>
  workspace_ref: <workspace:1 | session name | unavailable>
  workspace_id: <uuid-or-stable-id | unavailable>
  objective: <bounded objective>
  branch_authority: <branch and sha>
  executive_office:
    - pane: A/EXEC-PM
      agent_id: a-exec-pm
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
      role: EXEC PM
      harness_model: <model/harness>
      disposition: retain
  pods:
    - team: C
      purpose: <workstream>
      surfaces:
        - pane: C/TEAM-PM
          terminal_locator: <same schema>
          role: TEAM PM
          harness_model: <model/harness>
          disposition: retain_or_close_on_finish
        - pane: C/TEAM-SENTINEL
          terminal_locator:
            terminal_app: <cmux|tmux|wezterm|iterm2|ghostty|warp|cursor|zed|vscode|unknown>
            terminal_adapter: <cmux|tmux|libghostyy|apple_script|cli|ide_terminal|unavailable>
            workspace_ref: <workspace/session/ref-or-unavailable>
            workspace_id: <uuid-or-stable-id-or-unavailable>
            window_ref: <window-ref-or-unavailable>
            window_id: <uuid-or-stable-id-or-unavailable>
            pane_ref: <pane-ref-or-unavailable>
            pane_id: <uuid-or-stable-id-or-unavailable>
            surface_ref: <surface-ref-or-unavailable>
            surface_id: <uuid-or-stable-id-or-unavailable>
            tab_ref: <tab-ref-or-unavailable>
            tab_id: <uuid-or-stable-id-or-unavailable>
            surface_type: terminal
            title: C/TEAM-SENTINEL
            route_command: <non-secret route command or unavailable>
            locator_source: <command/tool/observation used>
            locator_captured_at: <ISO-8601 timestamp or unavailable>
          vt_state_snapshot:
            vt_provider: <libghostty-vt|terminal-capture|unavailable>
            vt_api_stability: <work_in_progress_unstable|stable|unknown>
            terminal_instance_ref: <GhosttyTerminal handle/ref or unavailable>
            terminal_instance_id: <product-generated id or unavailable>
            pty_ref: <pty/process route or unavailable>
            capture_source: <formatter|render_state|grid_ref|read_screen|unavailable>
            formatter_format: <plain|vt|html|unavailable>
            rows: <rows or unavailable>
            cols: <cols or unavailable>
            total_rows: <total_rows or unavailable>
            scrollback_rows: <scrollback_rows or unavailable>
            width_px: <width_px or unavailable>
            height_px: <height_px or unavailable>
            active_screen: <primary|alternate|unavailable>
            cursor_x: <cursor_x or unavailable>
            cursor_y: <cursor_y or unavailable>
            cursor_visible: <true|false|unavailable>
            cursor_pending_wrap: <true|false|unavailable>
            title: C/TEAM-SENTINEL
            pwd: <pwd or unavailable>
            render_dirty: <false|partial|full|unavailable>
            semantic_prompt_observed: <true|false|unavailable>
            semantic_input_observed: <true|false|unavailable>
            semantic_output_observed: <true|false|unavailable>
            paste_safety_checked: <true|false|unavailable>
            paste_safe: <true|false|unavailable>
            key_encoding_provider: <libghostty-vt|terminal|unavailable>
            mouse_encoding_provider: <libghostty-vt|terminal|unavailable>
            focus_encoding_provider: <libghostty-vt|terminal|unavailable>
            snapshot_captured_at: <ISO-8601 timestamp or unavailable>
          role: TEAM SENTINEL
          harness_model: <model/harness>
          disposition: retain_or_close_on_finish
        - pane: C/DEV-1
          terminal_locator: <same schema>
          role: DEV WORKER
          harness_model: <model/harness>
          disposition: close_on_finish
  exclusions:
    - UX/design teams unless separately profiled
  teardown_policy:
    close_temp_panes_after_finish: true
    retain_dirty_or_blocked_panes: true
    require_approval_for_worktree_delete: true
```

## Harness Launch Rules

Before launching a harness:

1. Run the `delegate` preflight for that harness/model.
2. Prefer cached successful model/harness choices for the same task class.
3. Use high-reasoning/costly models for executive, sentinel, architecture, integration, and high-risk QA.
4. Use cheaper/bounded models for DEV, routine QA, scans, and shadow review.
5. If a harness fails, substitute by role contract, not by pane identity.

Each launched pane must receive:

- role-specific boot prompt,
- `SCP_MIN_BOOT_RECEIPT` requirements for initial parking,
- full `SCP_BOOT_RECEIPT` requirements for activation or mutation,
- write/read/prohibited scopes,
- reports-to chain,
- `may_implement` and `may_qa_accept`,
- exact current objective,
- first expected receipt.

## Dispatch Rules

`EXEC PM` dispatches to `TEAM PM`; `TEAM PM` activates and routes pod workers; `TEAM SENTINEL` monitors, polls, intervenes, and may relay corrective prompts. Workers do not self-select work.

Every downstream assignment requires `[SCP-DELEGATE]` and `[SCP-CMUX-DELIVERY]` or `[SCP-TERMINAL-DELIVERY]` with a delivery verdict. During active work, each sentinel emits `[SCP-POLL]` on the assigned cadence.

## Teardown Rules

On `$odin-scp --finish`:

1. `EXEC PM` broadcasts finish to all manifest panes.
2. Every pane emits `[SCP-FINISH]` or is recorded as non-responsive.
3. `EXEC ASST` captures final read-screen snapshots and pane list.
4. `EXEC QA` or a QA swarm reviews cleanup evidence.
5. Close only panes marked `close_on_finish` and only after their state is captured.
6. Retain UX/design, dirty, blocked, or explicitly parked panes.
7. Record a final manifest with closed/retained/deferred disposition.

Never delete worktrees or local files during automated teardown unless exact entries were approved and proof was captured.
