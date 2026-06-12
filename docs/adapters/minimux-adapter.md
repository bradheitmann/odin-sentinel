# minimux Adapter Specification

## Overview

minimux is a **headless Zig daemon** and the **highest-capability headless
substrate** for the Supervised Completion Protocol (SCP). It exposes all seven
capability flags through a JSON-RPC API, making it the only current substrate
that reaches **tier 4**.

minimux is designed purely for agent workloads. It is never the orchestrator
and never a multiplexer for humans. Workers run in minimux sessions while a
human-visible multiplexer (cmux, herdr, or similar) provides the operator view.

**SCP Capability Tier: 4**

---

## PROTOTYPE STABILITY CAVEAT

> **minimux v0.1.1 is prototype software. Protocol guarantees are not
> production-hardened. Homebrew/npm distribution exists but the runtime adapter
> for SCP is deferred to a later phase.**

Do not use minimux for production governed-team runs until the runtime SCP
adapter is complete and the stability caveat is lifted. This document is
documentation-only for the current release cycle.

---

## Capability Matrix

| Capability   | Supported | Notes                                                        |
|:-------------|:----------|:-------------------------------------------------------------|
| SEND         | Yes       | `pane.send` JSON-RPC method                                  |
| ENTER_PROOF  | Yes       | `agent.wait_idle` delivery proof primitive                   |
| READ_SCREEN  | Yes       | `pane.snapshot` structured snapshot                          |
| WAIT_IDLE    | Yes       | `agent.wait_idle` blocks until the pane process is idle      |
| EVENTS       | Yes       | `tap` method — live event stream per session/pane            |
| PERSISTENCE  | Yes       | Append-only journal + atomic snapshot; kill-9 survivable     |
| RECORDING    | Yes       | `recordings` evidence primitive                              |

---

## JSON-RPC Method Reference

minimux communicates over a local JSON-RPC socket. All methods follow the
standard JSON-RPC 2.0 envelope (`jsonrpc`, `method`, `params`, `id`).

### SEND — `pane.send`

Send text to a named pane in a session:

```json
{
  "method": "pane.send",
  "params": { "session": "{session_id}", "pane": "{pane_id}", "text": "{text}" }
}
```

### ENTER_PROOF — `agent.wait_idle`

Block until the target pane's process reaches an idle state and return a
structured delivery proof:

```json
{
  "method": "agent.wait_idle",
  "params": { "session": "{session_id}", "pane": "{pane_id}", "timeout_ms": 30000 }
}
```

The response includes a timestamp, process state, and a journal sequence number
that serves as the delivery proof artifact.

### READ_SCREEN — `pane.snapshot`

Return a structured snapshot of the current pane content:

```json
{
  "method": "pane.snapshot",
  "params": { "session": "{session_id}", "pane": "{pane_id}" }
}
```

The snapshot includes full scrollback within the journal window, process state,
and the sequence number at the time of capture.

### WAIT_IDLE — `agent.wait_idle`

Same method as ENTER_PROOF. `agent.wait_idle` serves both the "wait until idle"
and the "proof of delivery" roles because the idle gate is also the delivery
confirmation boundary.

### EVENTS — `tap`

Subscribe to a live NDJSON event stream for a session or pane:

```json
{
  "method": "tap",
  "params": { "session": "{session_id}", "pane": "{pane_id}" }
}
```

The stream emits one JSON object per line as events occur (input, output,
process state changes, idle transitions). Use this for real-time supervision
without polling.

### PERSISTENCE

minimux maintains an **append-only journal** and **atomic snapshots** for each
session. If the daemon is killed (including `kill -9`), the journal is replayed
on restart and the session state is recovered automatically.

This is the only tier-4 persistence primitive in the current substrate catalog.

### RECORDING — `recordings`

Retrieve structured recording artifacts for a session or pane:

```json
{
  "method": "recordings",
  "params": { "session": "{session_id}", "pane": "{pane_id}", "from_seq": 0 }
}
```

Recordings serve as evidence artifacts for audit trails and QA review.

---

## Positioning Note

minimux is **never the orchestrator** and **never a multiplexer for humans**.

Workers run inside minimux sessions. The human operator views the governed
workspace through a human-visible multiplexer (cmux on macOS, herdr on Linux
or SSH hosts). minimux provides the headless execution layer; the human-visible
layer is a separate substrate.

---

## Implementation Status

The runtime SCP adapter for minimux is **deferred**. This document specifies
the JSON-RPC surface that the adapter will use when implemented. No minimux
dependency has been added to the core protocol package.

When the adapter is implemented, it will be released under a separate adapter
package that lists minimux as a peer dependency. The core package remains
substrate-agnostic.
