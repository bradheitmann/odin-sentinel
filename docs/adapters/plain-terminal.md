# Plain Terminal Adapter Specification

## Overview

A plain terminal (SSH tty, serial console, bare shell, or any environment
without a multiplexer) is the **lowest-capability substrate** for the
Supervised Completion Protocol (SCP). Only SEND is available.

There is no feedback channel. The agent cannot confirm delivery. The PM cannot
observe screen content. Polling is impossible. Governance obligations that
require tier >= 1 cannot be met in a plain terminal environment.

**SCP Capability Tier: 0**

---

## Capability Matrix

| Capability   | Supported     | Notes                                               |
|:-------------|:--------------|:----------------------------------------------------|
| SEND         | Yes           | Write to stdin or the tty device                    |
| ENTER_PROOF  | NOT SUPPORTED | No screen capture; delivery cannot be confirmed     |
| READ_SCREEN  | NOT SUPPORTED | No capture-pane or equivalent primitive             |
| WAIT_IDLE    | NOT SUPPORTED | No idle-detection mechanism                         |
| EVENTS       | NOT SUPPORTED | No hook system or event stream                      |
| PERSISTENCE  | NOT SUPPORTED | No session journal or crash-recovery primitive      |
| RECORDING    | NOT SUPPORTED | No structured evidence recording primitive          |

---

## Limitations

A plain terminal provides write-only access to the agent process. The
supervisor has no visibility into what the agent has received, processed, or
output. Specifically:

- **No delivery confirmation:** Once a string is sent to stdin, there is no
  mechanism to verify the agent received or acted on it.
- **No screen observation:** The PM cannot read the agent's output without an
  out-of-band channel (log file, sidecar process, etc.).
- **No idle detection:** The supervisor cannot determine when the agent has
  finished responding.
- **No event callbacks:** There is no hook or notification system to signal
  state transitions.
- **No persistence:** If the terminal session ends, all state is lost. There
  is no journal to replay.
- **No recording:** There is no structured artifact capturing the agent's
  activity for later review.

---

## Use Case

A plain terminal is the **fallback surface of last resort** for bootstrapping
in environments where no multiplexer is available. It is appropriate only when:

1. No multiplexer (tmux, cmux, minimux, herdr) can be installed on the host.
2. The operation does not require delivery confirmation, screen observation,
   or governed supervision.
3. The operator accepts that governance obligations requiring tier >= 1 cannot
   be met and takes responsibility for out-of-band status verification.

Typical scenarios: initial provisioning of a new host before a multiplexer is
installed; serial console access to an embedded device; a minimal container
environment where process namespace restrictions prevent multiplexer operation.

---

## Operator Responsibilities

Because the SCP adapter cannot observe the agent, the operator must:

- Use out-of-band channels (log files, sidecar processes, application metrics)
  to verify agent activity.
- Accept that no boot receipt, delivery proof, or wake-state report can be
  generated for this tier.
- Treat the plain terminal session as ungoverned and document the exception
  in the session record.

Promote the substrate to tier >= 1 (tmux) as soon as the environment permits.
