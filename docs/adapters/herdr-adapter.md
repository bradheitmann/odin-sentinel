# herdr Adapter Specification

## Overview

herdr is a third-party Rust TUI agent multiplexer (herdr.dev) that runs inside
any terminal and provides persistent background sessions with a rich NDJSON
socket API. It is the **primary tier-3+ substrate** for SSH hosts, Linux
agents, and non-Mac environments.

herdr supports 14+ documented agent integrations as of 2026-06, and its
persistent background session model means agent processes survive terminal
disconnects.

**SCP Capability Tier: 3+**

---

## LICENSE NOTE

> **herdr is licensed under AGPL-3.0 with a commercial dual-license option.
> Any future runtime adapter code included in a distributed package requires
> legal review to confirm GPL compatibility with the host project's license
> before distribution.**

This document is documentation-only for the current release cycle. No herdr
dependency has been added to the core protocol package. Legal review must be
completed before any herdr adapter code is shipped in a distributed artifact.

---

## Capability Matrix

| Capability   | Supported | Notes                                                    |
|:-------------|:----------|:---------------------------------------------------------|
| SEND         | Yes       | workspace/tab/pane/output NDJSON operations              |
| ENTER_PROOF  | Yes       | `wait` operation confirms delivery                       |
| READ_SCREEN  | Yes       | `pane/output` read operations                            |
| WAIT_IDLE    | Yes       | `wait` operation on pane process state                   |
| EVENTS       | Yes       | Persistent background session with NDJSON event stream   |
| PERSISTENCE  | Yes       | Persistent background sessions survive disconnects       |
| RECORDING    | No        | No structured evidence recording primitive               |

---

## NDJSON Socket API Reference

herdr exposes a NDJSON socket API. Each request and response is a single
JSON object on one line (newline-delimited). The socket path is configurable;
the default is a Unix domain socket in the user's runtime directory.

### SEND — workspace/tab/pane/output

Send text to a pane inside a named workspace and tab:

```json
{"op": "pane/send", "workspace": "{workspace_id}", "tab": "{tab_id}", "pane": "{pane_id}", "text": "{text}"}
```

### ENTER_PROOF — wait

Block until the pane reaches an idle or expected-output state:

```json
{"op": "wait", "workspace": "{workspace_id}", "tab": "{tab_id}", "pane": "{pane_id}", "condition": "idle"}
```

The response includes a timestamp and the pane's process state at the moment
the wait condition was satisfied.

### READ_SCREEN — pane/output

Read the current visible output of a pane:

```json
{"op": "pane/output", "workspace": "{workspace_id}", "tab": "{tab_id}", "pane": "{pane_id}"}
```

### WAIT_IDLE — wait

Same operation as ENTER_PROOF. The `wait` operation serves both synchronization
and delivery-confirmation roles:

```json
{"op": "wait", "workspace": "{workspace_id}", "tab": "{tab_id}", "pane": "{pane_id}", "condition": "idle", "timeout_ms": 30000}
```

### EVENTS — persistent session event stream

herdr maintains a persistent background session server. Subscribe to a pane's
event stream to receive real-time output and state change notifications:

```json
{"op": "subscribe", "workspace": "{workspace_id}", "tab": "{tab_id}", "pane": "{pane_id}"}
```

Each event is emitted as one NDJSON line. This eliminates polling for
output detection and state transitions.

### PERSISTENCE

herdr's background session model keeps agent processes alive after the
originating terminal disconnects. Sessions are identified by workspace and
tab IDs and can be reconnected from any terminal on the same host.

This makes herdr suitable for long-running agent workloads on SSH hosts where
terminal disconnects are expected.

### RECORDING

**Not supported.** herdr has no structured evidence recording primitive at the
SCP adapter level. If recording is required, redirect pane output to a log file.

---

## Use Case

herdr is the recommended substrate for:

- **SSH hosts:** Agents running on remote Linux servers where cmux is not
  available.
- **Linux agents:** Non-Mac environments where a native macOS multiplexer
  cannot be installed.
- **Non-Mac CI/CD:** Governed agent runs in Linux containers or VMs.
- **Distributed team setups:** Multiple operators connecting to the same
  persistent agent sessions from different terminals.

Its 14+ documented agent integrations and persistent session model make it
the strongest available tier-3 substrate outside the macOS cmux ecosystem.

---

## Agent Integrations

herdr ships with integrations for 14+ agent frameworks as of 2026-06. Refer
to the herdr documentation at herdr.dev for the current integration catalog.
The SCP adapter will target the core NDJSON socket API directly and is
independent of the higher-level agent framework integrations.

---

## Implementation Status

The runtime SCP adapter for herdr is **deferred**. Legal review of AGPL-3.0
compatibility with the host project's license is required before any adapter
code is distributed. This document specifies the NDJSON socket surface that the
adapter will use when implemented.

When the adapter is implemented, it will be released under a separate adapter
package and will document the completed legal review outcome. The core package
remains substrate-agnostic and carries no herdr dependency.
