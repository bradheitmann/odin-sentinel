import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer, type CreateServerOptions } from "../../src/mcp/server.js";
import { MCP_CAPABILITIES, MCP_TOOL_CAPABILITIES, resolveMcpCapabilities } from "../../src/mcp/capabilities.js";
import * as governance from "../../src/protocol/governance.js";
import * as service from "../../src/protocol/service.js";

async function withClient(options: CreateServerOptions, check: (client: Client) => Promise<void>) {
  const server = createServer(options);
  const client = new Client({ name: "capability-boundary-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b);
    await client.connect(a);
    await check(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("capability deployment boundaries", () => {
  it("does not let JavaScript consumers mutate the default validation domain", () => {
    expect(Object.isFrozen(MCP_CAPABILITIES)).toBe(true);
    expect(() => (MCP_CAPABILITIES as unknown as string[]).push("unknown")).toThrow(TypeError);
    expect(() => (MCP_CAPABILITIES as unknown as string[]).pop()).toThrow(TypeError);
    expect(() => resolveMcpCapabilities(["unknown"])).toThrow(TypeError);
    expect([...resolveMcpCapabilities()]).toEqual(["protocol", "governance", "telemetry"]);
  });

  it("defaults to the complete immutable selection and copies caller-owned lists", () => {
    expect([...resolveMcpCapabilities()]).toEqual([...MCP_CAPABILITIES]);
    const chosen = ["protocol"];
    const resolved = resolveMcpCapabilities(chosen);
    chosen.push("telemetry");
    expect([...resolved]).toEqual(["protocol"]);
  });

  it.each([[], [""], ["unknown"], ["protocol", "unknown"], ["protocol", "protocol"], null, "protocol", {}, [true]])(
    "rejects invalid selection %j before starting a server", (capabilities) => {
      expect(() => createServer({ capabilities } as unknown as CreateServerOptions)).toThrow(TypeError);
    }
  );

  it("protocol-only lists references but denies disabled tools and state reads", async () => {
    await withClient({ capabilities: ["protocol"] }, async client => {
      expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(
        Object.keys(MCP_TOOL_CAPABILITIES).filter(n => MCP_TOOL_CAPABILITIES[n] === "protocol").sort()
      );
      expect((await client.listResources()).resources.length).toBe(27);
      expect((await client.listResourceTemplates()).resourceTemplates).toEqual([]);
      expect((await client.callTool({ name: "odin.get_version", arguments: {} })).isError).not.toBe(true);
      expect((await client.callTool({ name: "odin.evaluate_readiness_gate", arguments: { slots: [] } })).isError).toBe(true);
      expect((await client.callTool({ name: "odin.submit_session_report", arguments: { report: {}, userConsentConfirmed: true } })).isError).toBe(true);
      expect((await client.callTool({ name: "odin_append_event", arguments: { scope: "scope", event: {} } })).isError).toBe(true);
      await expect(client.readResource({ uri: "odin://registry/scope/events" })).rejects.toThrow();
    });
  });

  it("governance-only denies all static protocol references and keeps readiness fail-closed", async () => {
    await withClient({ capabilities: ["governance"], govdispRegistry: { enabled: false } }, async client => {
      expect(client.getServerCapabilities()?.resources).toBeUndefined();
      await expect(client.listResources()).rejects.toThrow();
      expect((await client.listTools()).tools.every(t => MCP_TOOL_CAPABILITIES[t.name] === "governance")).toBe(true);
      await expect(client.readResource({ uri: "odin://protocol/main" })).rejects.toThrow();
      expect((await client.callTool({ name: "odin.get_startup_packet", arguments: {} })).isError).toBe(true);
      const result = await client.callTool({ name: "odin.evaluate_readiness_gate", arguments: { slots: [{ roleSlot: "B/DEV-1" }], execPmAuthorized: true, cmuxAvailable: false } });
      expect(result.isError).not.toBe(true);
      const readiness = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(readiness.activationStatus).toBe("TEAM_ACTIVATION_BLOCKED");
      expect(readiness.overallStatus).toBe("FAIL");
      await expect(client.listResourceTemplates()).rejects.toThrow();
    });
  });

  it("telemetry-only denies protocol and governance even when registry is explicitly enabled", async () => {
    await withClient({ capabilities: ["telemetry"], govdispRegistry: { enabled: true } }, async client => {
      expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(
        Object.keys(MCP_TOOL_CAPABILITIES).filter(n => MCP_TOOL_CAPABILITIES[n] === "telemetry").sort()
      );
      expect(client.getServerCapabilities()?.resources).toBeUndefined();
      await expect(client.listResources()).rejects.toThrow();
      await expect(client.listResourceTemplates()).rejects.toThrow();
      expect((await client.callTool({ name: "odin_query_events", arguments: { scope: "scope" } })).isError).toBe(true);
    });
  });

  it("preserves every existing governance function identity through the compatibility facade", () => {
    for (const [name, value] of Object.entries(governance)) {
      if (name === "adjudicateRegistryAuthority" || name === "withProseTransportAdvisory") continue;
      expect((service as Record<string, unknown>)[name], name).toBe(value);
    }
    expect(governance.evaluateAttemptCeiling(undefined as never, "scope", "objective", "start")).toMatchObject({ ok: false });
  });
});
