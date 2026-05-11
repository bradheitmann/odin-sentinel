# Cost And Privacy

ODIN Sentinel does not provide inference.

It does not proxy model calls, host a backend, phone home, collect telemetry, or
ship credentials. It is a local MCP server that returns protocol resources,
startup packets, validation results, delegation envelopes, closeout checklists,
and fallback text snapshots.

## Who Pays For What

The maintainer does not pay when another person runs ODIN Sentinel locally.

Users are responsible for their own harness setup and any model calls those
harnesses make. ODIN Sentinel only returns coordination data over MCP.

ODIN Sentinel only names preferred harness slots and model capability profiles.
Those are dispatch preferences, not hosted compute.

## Network Boundary

The server is stdio-only by default:

```text
MCP client  <->  local stdio process  <->  protocol files
```

No network call is required for normal operation.

## Standalone Boundary

ODIN Sentinel is standalone.

The default handoff search list uses `.odin/` paths. A fresh repo does not need
any separate orchestration system installed for ODIN Sentinel to work.
