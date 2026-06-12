# tmux Adapter Specification

## Overview

tmux is a **tier-2 substrate** for the Supervised Completion Protocol (SCP).
It provides SEND, ENTER_PROOF, READ_SCREEN, and WAIT_IDLE — a solid mid-tier
capability set sufficient for governed agent supervision when screen capture and
idle-wait primitives are required.

tmux does **not** have an event hook system comparable to a native GUI
multiplexer, so all observation must be done via polling rather than
event-driven interrupts.

**SCP Capability Tier: 2**

---

## Capability Matrix

| Capability   | Supported | Notes                                           |
|:-------------|:----------|:------------------------------------------------|
| SEND         | Yes       | `tmux send-keys -t {pane} {text} Enter`         |
| ENTER_PROOF  | Partial   | Send Enter then verify via capture-pane          |
| READ_SCREEN  | Yes       | `tmux capture-pane -p -t {pane}` (text snapshot)|
| WAIT_IDLE    | Yes       | `tmux wait-for {event_name}` blocks until fired |
| EVENTS       | No        | No hook system; polling required                |
| PERSISTENCE  | No        | Sessions survive disconnect but no agent journal|
| RECORDING    | No        | No structured evidence primitive                |

---

## Command Reference

### SEND

Send text to a pane. Use `send-keys` for arbitrary text; include `Enter`
to submit the line:

```
tmux send-keys -t {session}:{window}.{pane} "{text}" Enter
```

Pane targets use tmux's `%N` numeric pane IDs or `session:window.pane` syntax.

### ENTER_PROOF (Partial)

tmux has no native delivery-proof primitive. The pattern is:

1. Send the command with `Enter`.
2. Poll `capture-pane` until the expected prompt or output appears.
3. Record the capture result as the delivery artifact.

This is probabilistic rather than cryptographic; it satisfies tier-2 proof
requirements but not tier-4 journal-level guarantees.

```
tmux send-keys -t {pane} "{command}" Enter
# then poll:
tmux capture-pane -p -t {pane}
```

### READ_SCREEN

Capture the visible text content of a pane as a UTF-8 string:

```
tmux capture-pane -p -t {pane}
```

Requires tmux 2.0 or later for the `-p` (print to stdout) flag.

For history beyond the visible viewport:

```
tmux capture-pane -p -S -{history-lines} -t {pane}
```

### WAIT_IDLE

Block until a named event fires. The event must be signalled by a shell
command or wrapper running inside the target pane:

```
tmux wait-for {event_name}
# signal from inside the pane:
tmux wait-for -S {event_name}
```

`wait-for` is suitable for synchronizing after long-running commands when
the inner process can call `tmux wait-for -S`.

### EVENTS

**Not supported.** tmux has no hook API comparable to a native multiplexer's
`set-hook` or `notify` system. Supervision logic must poll `capture-pane`
at a fixed interval; event-driven scheduling is not available.

### PERSISTENCE

**Not supported at the SCP adapter level.** tmux sessions survive disconnects,
but there is no append-only journal, atomic snapshot, or crash-recovery
primitive accessible to the SCP adapter.

### RECORDING

**Not supported.** tmux has no structured evidence recording primitive. If
recording is required, redirect output to a log file from within the shell
session.

---

## Minimum Version Requirements

| Requirement      | Minimum |
|:-----------------|:--------|
| tmux             | 2.0     |
| `capture-pane -p`| tmux 2.0|
| `wait-for`       | tmux 2.2|
| `%N` pane IDs    | tmux 1.6|

---

## odin-watch Integration Pattern

The `TmuxBackend` uses `capture-pane -p` to read pane state. Because EVENTS
is not supported, the backend operates in **polling mode only**:

1. Read pane content via `capture-pane -p -t {pane}`.
2. Hash the output to detect changes (`screen_hash`, `screen_changed`).
3. If the content matches an idle or completion marker, update `WakeState`.
4. Sleep for the configured `pollIntervalSeconds` and repeat.

There is no interrupt mechanism. The poller must run at a fixed cadence.
Recommended polling interval: 15–30 seconds for routine supervision;
5 seconds for time-sensitive gates.

---

## Limitations

- **No EVENTS:** All observation is poll-based. The backend cannot be
  notified of state changes; it must check on a timer.
- **No PERSISTENCE:** If the odin-watch process restarts, no journal is
  available to reconstruct prior state. The backend must re-scan pane
  content from scratch.
- **ENTER_PROOF is probabilistic:** Delivery confirmation relies on
  recognizing expected output in a subsequent `capture-pane`, not on a
  cryptographic or journal-level proof.
- **Pane content is ephemeral:** The terminal scrollback is finite;
  long-running sessions may lose history unless piped to a file.
