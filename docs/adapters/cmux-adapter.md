# cmux Adapter Specification

## Overview

cmux is the **primary tier-3 substrate** for the Supervised Completion Protocol
(SCP). It is a macOS GUI application with a rich CLI that exposes send, screen
read, wait-for, event hooks, sidebar status, and notification APIs.

Unlike tmux, cmux supports a native event hook system (`set-hook`, `notify`,
`wait-for`) that enables event-driven supervision without continuous polling.
This makes cmux the canonical governed-team substrate on macOS.

**SCP Capability Tier: 3**

---

## Capability Matrix

| Capability   | Supported | Notes                                                  |
|:-------------|:----------|:-------------------------------------------------------|
| SEND         | Yes       | `cmux send-text` / `cmux send-keys`                    |
| ENTER_PROOF  | Yes       | `cmux send-keys Enter` + `cmux wait-for {event}`       |
| READ_SCREEN  | Yes       | `cmux read-screen --surface {locator}`                 |
| WAIT_IDLE    | Yes       | `cmux wait-for {event}` (blocking wait on named event) |
| EVENTS       | Yes       | `cmux set-hook` + `cmux notify` — event-driven today   |
| PERSISTENCE  | No        | Sessions persist across restarts; no agent journal     |
| RECORDING    | No        | No structured evidence recording primitive             |

---

## Command Reference

### SEND

Send text to a named surface. Two forms:

```
# Send a string of text (appends to the pane input)
cmux send-text --surface {locator} "{text}"

# Send individual key sequences (special keys, modifiers)
cmux send-keys --surface {locator} {key} [{key} ...]
```

Surface locators follow the cmux vocabulary:
`workspace:{name} pane:{name} surface:{name}`.

### ENTER_PROOF

Submit a command and confirm delivery by combining `send-keys Enter` with
a subsequent `wait-for` on an application-level event:

```
cmux send-keys --surface {locator} Enter
cmux wait-for {confirmation_event}
```

Where `{confirmation_event}` is a hook registered before delivery (see EVENTS).
This provides a verifiable proof of entry: the wait-for gate does not pass until
the hook fires.

### READ_SCREEN

Read the visible text content of a surface:

```
cmux read-screen --surface {locator}
```

Returns UTF-8 text of the current visible viewport. Used by `CmuxBackend` to
populate `screen_hash` and detect `screen_changed`.

### WAIT_IDLE

Block the calling process until a named event fires:

```
cmux wait-for {event_name}
```

Events are signalled via `cmux notify {event_name}` or automatically via
registered hooks. Use this to synchronize the supervisor with agent activity
without polling.

### EVENTS

cmux provides a native hook system. Register a hook to fire on a surface
condition, then signal or wait:

```
# Register a hook to call notify when the surface emits a sentinel line
cmux set-hook --surface {locator} --pattern "{sentinel}" --action "notify {event_name}"

# Fire an event manually
cmux notify {event_name}

# Block until the event fires
cmux wait-for {event_name}
```

This enables **event-driven supervision**: the supervisor does not poll; it
registers hooks and sleeps until signalled.

### SIDEBAR STATUS

cmux exposes a sidebar status API that allows the supervisor to display
structured state in the operator-visible chrome:

```
cmux sidebar-status --set "{status_text}"
```

This is a cmux-specific capability with no tmux equivalent. Use it to surface
`WakeState` verdicts to the operator without interrupting the agent pane.

### PERSISTENCE

**Not supported at the SCP adapter level.** cmux sessions survive application
restarts, but there is no append-only journal or atomic snapshot primitive
accessible to the SCP adapter.

### RECORDING

**Not supported.** cmux has no structured evidence recording primitive at the
SCP adapter level.

---

## Event-Driven Supervision Pattern

cmux's event system enables zero-poll supervision. The recommended pattern:

1. Register a hook before launching the agent: `cmux set-hook --surface {locator} --pattern "{idle_sentinel}" --action "notify odin-idle"`.
2. Launch the agent and send the initial prompt.
3. Call `cmux wait-for odin-idle` — the supervisor blocks.
4. When the agent emits the idle sentinel, the hook fires automatically and
   `wait-for` unblocks.
5. Read the surface: `cmux read-screen --surface {locator}`.
6. Evaluate the `WakeState` and respond.

This approach has no polling overhead and reacts to agent output within the
hook-check latency of cmux (typically sub-second).

---

## odin-watch Integration Pattern

The `CmuxBackend` supports both polling and event-driven modes:

- **Polling mode (current):** Reads `cmux read-screen` on a configurable
  interval. Computes `screen_hash` to detect changes. Emits `WakeState`.
- **Event-driven mode (future v1.5):** Registers `set-hook` on governed
  surface sentinels. Blocks on `cmux wait-for`. Eliminates the polling loop.

The CmuxBackend may be upgraded to event-driven mode in a later iteration
without changing the `WakeState` output contract.

---

## Topology Notes

cmux is a macOS-native application. It is not available on Linux or Windows.
For SSH hosts, Linux agents, or non-Mac environments, see the herdr adapter
specification as an alternative tier-3+ substrate.

The governing workspace and all panes must be visible in cmux before occupant
launch. The `human_cmux_quad` layout profile is the canonical governed-team
configuration for cmux.
