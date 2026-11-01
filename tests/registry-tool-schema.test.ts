import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type CreateServerOptions } from "../src/mcp/server.js";
import {
  appendRegistryEvent,
  queryRegistryEvents,
  REGISTRY_EVENTS_FILENAME
} from "../src/protocol/event-registry/storage.js";

// ---------------------------------------------------------------------------
// REGISTRY-SCHEMA-REPAIR-001 — the registry tools must PUBLISH object-typed
// arguments (not the empty schema `{}`) so clients cannot reasonably serialise
// an event/query as a JSON string, while the store stays the single validation
// choke point:
//   - tools/list advertises `type: "object"` for event and query;
//   - valid objects pass through untouched and the store keeps rejecting with
//     the SAME named rejections (field/event_class/code/detail);
//   - strings are refused at the schema/transport layer and write nothing;
//   - query stays optional and object filters still work.
// No JSON-string acceptance is added anywhere.
// ---------------------------------------------------------------------------

const REGISTRY_TOOL_NAMES = ["odin_append_event", "odin_query_events"] as const;
const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-registry-schema-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const realStore = { appendRegistryEvent, queryRegistryEvents };

async function connectClient(options?: CreateServerOptions): Promise<Client> {
  const server = createServer(options);
  const client = new Client({ name: "odin-registry-schema-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function parseTextResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  if (!first || first.type !== "text") throw new Error("Expected a text tool result");
  return JSON.parse(first.text ?? "");
}

type AnyRecord = Record<string, unknown>;

function attemptEvent(eventId: string, overrides: AnyRecord = {}): AnyRecord {
  return {
    schema_version: "govdisp.event.v1",
    event_id: eventId,
    ts: "2026-10-21T05:00:00Z",
    stable_objective_id: "obj-registry-schema-repair-001",
    event_class: "ATTEMPT",
    event_type: "ATTEMPT_STARTED",
    attempt_index: 1,
    trigger: "start",
    ...overrides
  };
}

function toolSchema(tools: Awaited<ReturnType<Client["listTools"]>>, name: string): AnyRecord {
  const tool = tools.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool.inputSchema as AnyRecord;
}

function propertySchema(schema: AnyRecord, property: string): AnyRecord {
  const properties = schema["properties"];
  if (typeof properties !== "object" || properties === null) throw new Error("schema has no properties object");
  const value = (properties as AnyRecord)[property];
  if (typeof value !== "object" || value === null) throw new Error(`no object schema published for ${property}`);
  return value as AnyRecord;
}

describe("published registry tool schema", () => {
  it("advertises object-typed event and query arguments (not the empty schema)", async () => {
    const client = await connectClient({ govdispRegistry: { env: {}, store: realStore, base: makeTmpBase() } });
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      for (const name of REGISTRY_TOOL_NAMES) expect(names).toContain(name);

      const append = toolSchema(tools, "odin_append_event");
      const query = toolSchema(tools, "odin_query_events");

      expect(append["type"]).toBe("object");
      expect(query["type"]).toBe("object");
      expect(append["required"]).toEqual(["scope", "event"]);
      // query remains OPTIONAL: only scope is required.
      expect(query["required"]).toEqual(["scope"]);

      const eventSchema = propertySchema(append, "event");
      const querySchema = propertySchema(query, "query");
      expect(eventSchema["type"]).toBe("object");
      expect(querySchema["type"]).toBe("object");
      // Loose by design: no required fields, so the store remains the single
      // validation choke point (required fields/enums are NOT pushed here).
      expect(eventSchema["required"]).toBeUndefined();
      expect(querySchema["required"]).toBeUndefined();
      expect(eventSchema["additionalProperties"]).not.toBe(false);
      expect(querySchema["additionalProperties"]).not.toBe(false);
    } finally {
      await client.close();
    }
  });
});

describe("valid objects still flow to the store", () => {
  it("appends a canonical object event and reads it back", async () => {
    const base = makeTmpBase();
    const client = await connectClient({ govdispRegistry: { env: {}, store: realStore, base } });
    try {
      const appended = await client.callTool({
        name: "odin_append_event",
        arguments: { scope: "schema-scope", event: attemptEvent("evt-schema-1") }
      });
      expect(appended.isError ?? false).toBe(false);
      const body = parseTextResult(appended) as { ok: boolean; path?: string };
      expect(body.ok).toBe(true);
      expect(existsSync(join(base, "schema-scope", REGISTRY_EVENTS_FILENAME))).toBe(true);

      const queried = await client.callTool({ name: "odin_query_events", arguments: { scope: "schema-scope", query: {} } });
      expect(queried.isError ?? false).toBe(false);
      const queryBody = parseTextResult(queried) as { ok: boolean; events: Array<{ event_id: string }> };
      expect(queryBody.ok).toBe(true);
      expect(queryBody.events.map((event) => event.event_id)).toEqual(["evt-schema-1"]);
    } finally {
      await client.close();
    }
  });

  it("keeps the SAME named store rejection for an invalid object event", async () => {
    const base = makeTmpBase();
    const client = await connectClient({ govdispRegistry: { env: {}, store: realStore, base } });
    try {
      const result = await client.callTool({
        name: "odin_append_event",
        arguments: { scope: "schema-scope", event: attemptEvent("evt-schema-bad", { event_class: "NOT_A_CLASS" }) }
      });
      expect(result.isError).toBe(true);
      const body = parseTextResult(result) as { ok: boolean; rejections: Array<{ field: string; event_class: string; code: string; detail: string }> };
      expect(body.ok).toBe(false);
      expect(body.rejections.length).toBeGreaterThan(0);
      const first = body.rejections[0];
      expect(first?.field).toBe("event_class");
      expect(typeof first?.code).toBe("string");
      expect(typeof first?.detail).toBe("string");
      // Store validation ran: nothing was written for the rejected event.
      expect(existsSync(join(base, "schema-scope", REGISTRY_EVENTS_FILENAME))).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("accepts an omitted query (optional) and an object query filter", async () => {
    const base = makeTmpBase();
    const client = await connectClient({ govdispRegistry: { env: {}, store: realStore, base } });
    try {
      const first = await client.callTool({ name: "odin_append_event", arguments: { scope: "schema-scope", event: attemptEvent("evt-schema-a") } });
      expect((parseTextResult(first) as { ok: boolean }).ok).toBe(true);
      const second = await client.callTool({
        name: "odin_append_event",
        arguments: { scope: "schema-scope", event: attemptEvent("evt-schema-b", { event_id: "evt-schema-b" }) }
      });
      expect((parseTextResult(second) as { ok: boolean }).ok).toBe(true);

      const omitted = await client.callTool({ name: "odin_query_events", arguments: { scope: "schema-scope" } });
      expect(omitted.isError ?? false).toBe(false);
      const omittedBody = parseTextResult(omitted) as { ok: boolean; events: Array<{ event_id: string }> };
      expect(omittedBody.ok).toBe(true);
      expect(omittedBody.events).toHaveLength(2);

      const filtered = await client.callTool({
        name: "odin_query_events",
        arguments: { scope: "schema-scope", query: { event_type: "ATTEMPT_STARTED" } }
      });
      expect(filtered.isError ?? false).toBe(false);
      const filteredBody = parseTextResult(filtered) as { ok: boolean; events: Array<{ event_id: string }> };
      expect(filteredBody.ok).toBe(true);
      expect(filteredBody.events).toHaveLength(2);
    } finally {
      await client.close();
    }
  });
});

describe("strings are refused at the schema/transport layer (no string acceptance)", () => {
  it("rejects a JSON-string event without writing anything", async () => {
    const base = makeTmpBase();
    const client = await connectClient({ govdispRegistry: { env: {}, store: realStore, base } });
    try {
      const result = await client.callTool({
        name: "odin_append_event",
        arguments: { scope: "schema-scope", event: JSON.stringify(attemptEvent("evt-schema-string")) }
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      expect(text).toContain("-32602");
      expect(text).toContain("expected object");
      expect(existsSync(join(base, "schema-scope", REGISTRY_EVENTS_FILENAME))).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("rejects a JSON-string query at the transport layer", async () => {
    const base = makeTmpBase();
    const client = await connectClient({ govdispRegistry: { env: {}, store: realStore, base } });
    try {
      const result = await client.callTool({
        name: "odin_query_events",
        arguments: { scope: "schema-scope", query: "{\"event_type\":\"ATTEMPT_STARTED\"}" }
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      expect(text).toContain("-32602");
      expect(text).toContain("expected object");
    } finally {
      await client.close();
    }
  });
});
