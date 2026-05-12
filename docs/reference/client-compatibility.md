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

## CMUX Boundary

CMUX is required for governed team mode because role slots must be visible,
locatable, and human-readable. Tab-only layouts are degraded. The canonical mode
is one CMUX workspace with spatial/pod organization and EXEC PM in the same
workspace by default.
