# Client Compatibility

ODIN Sentinel is implemented in TypeScript and runs on Node.js `>=22.13.0`.
Clients can be written in any language that can speak MCP over stdio or consume a
protocol snapshot.

## Compatibility Layers

- MCP server: language-neutral JSON-RPC over stdio.
- Native skill: host-specific context for automatic invocation and role behavior.
- Plugin: host install path that may bundle MCP config and native skill.
- Full prompt injection: fallback for hosts without MCP or native skill support.

A persistent governed role should have MCP plus native skill or full prompt proof.
If it does not, mark it `NON_GOVERNED_ONE_SHOT_ONLY`: it can do bounded one-shot
help, but should not occupy a persistent governed role.

## Native And WASM Clients

Native clients that can spawn subprocesses should launch:

```text
command: node
args: [/path/to/odin-sentinel/dist/src/bin/index.js]
transport: stdio
```

Clients that cannot spawn stdio should use a host bridge or a static snapshot
from `odin.export_protocol_snapshot`.

## Harness Readiness

Installed is not provisioned. Probe each harness before assigning a governed role and record
multi-dimensional readiness — `installed_binary`, `authenticated`, `mcp_configured`,
`mcp_tool_hydration`, `governed_role_ready` — rather than one boolean. Skill-capable harnesses
should install the `sentinel-coordination-protocol` skill before governed launch; native skill
discoverability improved compliance in observed runs.

- Droid: `droid mcp` is required for governed readiness; read-only `droid exec` is allowed without
  write authority; mission or high-autonomy work requires `--auto high`.
- Crush: lists models and runs, but has no MCP management command (classify `MCP_UNAVAILABLE`), and
  `unauthorized: Authentication parameter not received in Header` is an auth blocker
  (`BLOCKED_BY_AUTH` / `AUTH_PROVIDER_BLOCKED`), not readiness.
- Goose: requires a local-inference smoke test; reasoning-only output without visible content within
  the timeout is `MODEL_REASONING_ONLY` / `STREAMING_PROTOCOL_MISMATCH`.

Use `odin.get_harness_probe_matrix` to produce this classification with zero-secret output.

`odin.get_onboarding_plan` builds on the same probe classification (it does not introduce a
second readiness taxonomy) and turns it into a setup plan: harness readiness rows, blocker
summary, recommended setup mode, guided steps, assisted computer-use eligibility, the
install-ledger path, and the next user action. Guided manual setup is the safe default;
assisted computer-use setup is offered only when `computerUseAvailable` is true, and even
then the MCP server returns a plan only — actual GUI/computer use is performed by an
available computer-use-capable harness after the user chooses. The plan reports
secret/provider readiness by status only and never accepts or prints secret values.

## CMUX Boundary

CMUX is required for governed team mode because role slots must be visible,
locatable, and human-readable. Tab-only layouts are degraded. The canonical mode
is one CMUX workspace with spatial/pod organization and EXEC PM in the same
workspace by default.
