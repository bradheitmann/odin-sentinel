# Capability adoption (0.8.0)

The default server deployment preserves all 48 tools, all 27 static resources and the registry resource template. Existing `govdispRegistry.enabled` / `ODIN_GOVDISP_REGISTRY_MCP` opt-out behavior remains unchanged.

```ts
import { createServer } from "@bradheitmann/odin-sentinel/mcp";
const full = createServer();
const referenceOnly = createServer({ capabilities: ["protocol"] });
const noReporting = createServer({ capabilities: ["protocol", "governance"] });
```

For stdio hosts append `--capabilities protocol,governance` to the usual `odin-sentinel-mcp` command. Omit the option for full deployment. Unknown, duplicate, empty or malformed selections reject startup rather than silently enabling another group.

| Group | Registered surface |
| --- | --- |
| protocol | Packaged protocol resources, role cards, startup/onboarding/delegation packets, version/runtime metadata, snapshot and mission pack |
| governance | Validators, readiness and health evaluators, surface-layout computations, and the existing flag-controlled registry append/query tools and resource template |
| telemetry | Configuration inspection, local report compilation/redaction and explicit-consent report submission |

A disabled group is absent from discovery and direct calls/reads fail through MCP's unknown-tool/resource handling. Selection is immutable for a server instance; reconnect to a newly composed server to change it. Disablement is not a migration or deletion of persisted state. Protocol references still describe the full public doctrine; selecting protocol is not a promise to conceal public documentation. No tool grants readiness, role or registry authority by being installed. Validators keep their existing fail-closed rules; telemetry keeps explicit consent, token authentication, HTTPS/loopback endpoint policy and bounded ingestion.

## Transport-independent use

```ts
import { evaluateAttemptCeiling } from "@bradheitmann/odin-sentinel/governance";
import { canonicalRoleSlot } from "@bradheitmann/odin-sentinel/role-identity";
import { computeSurfaceLayout } from "@bradheitmann/odin-sentinel/surface-layout";
```

The governance module owns registry authority resolution, attempts, meta-governance depth, overhead budgets and finding lifecycle. It accepts a structural store supplied by the caller; importing it never starts MCP, creates a store or opens a network connection. Existing service exports and their function identities remain compatible. Shared schemas and validators remain the single validation vocabulary rather than being copied into each capability. These exports are adoption seams, not a generic plugin system or a relaxation of authority checks.
