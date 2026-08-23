import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type CreateServerOptions } from "../../src/mcp/server.js";
import {
  appendRegistryEvent,
  queryRegistryEvents,
  REGISTRY_EVENTS_FILENAME
} from "../../src/protocol/event-registry/index.js";

// ---------------------------------------------------------------------------
// SLICE-GOVDISP-REG-DEV-002 — server-registration-level coverage of the
// flag-gated governance-registry compatibility surface: flag off inventory,
// flag on append valid/invalid, query filters, resource read.
// SLICE-GOVDISP-DEFAULT-DEV-001 (Amendment 46): postures inverted — the flag
// is ACTIVE BY DEFAULT (unset = registry surface present: 48 tools + the
// resource template); the 46-tool baseline inventory is asserted under
// explicit opt-out postures (=0 / =off / enabled:false).
// ---------------------------------------------------------------------------

const REGISTRY_TOOL_NAMES = ["odin_append_event", "odin_query_events"];
const REGISTRY_URI_FRAGMENT = "odin://registry/";
const FLAG_ENV_VAR = "ODIN_GOVDISP_REGISTRY_MCP";

const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-registry-mcp-test-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// The injection seam in action: the REAL staged storage module is bound into
// the server by the caller; the server module itself never imports it.
const realStore = { appendRegistryEvent, queryRegistryEvents };

async function connectClient(options?: CreateServerOptions) {
  const server = createServer(options);
  const client = new Client({
    name: "odin-sentinel-registry-test",
    version: "1.0.0"
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

function parseTextResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  if (!first || first.type !== "text") {
    throw new Error("Expected text tool result");
  }
  return JSON.parse(first.text ?? "");
}

function eventBase(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "govdisp.event.v1",
    event_id: "evt-1",
    ts: "2026-08-23T00:00:00Z",
    stable_objective_id: "obj-govdisp-w2",
    ...overrides
  };
}

function attemptEvent(overrides: Record<string, unknown> = {}) {
  return {
    ...eventBase(),
    event_class: "ATTEMPT" as const,
    event_type: "ATTEMPT_STARTED" as const,
    attempt_index: 1,
    trigger: "start" as const,
    ...overrides
  };
}

function findingEvent(overrides: Record<string, unknown> = {}) {
  return {
    ...eventBase(),
    event_class: "FINDING" as const,
    event_type: "FINDING_OPENED" as const,
    finding_id: "finding-1",
    ...overrides
  };
}

type RegistryRejection = { field: string; event_class: string; code: string; detail: string };
type AppendToolResult =
  | { ok: true; path: string; event: { event_id: string } }
  | { ok: false; rejections: RegistryRejection[] };
type QueryToolResult =
  | { ok: true; events: Array<{ event_id: string }> }
  | { ok: false; rejections: RegistryRejection[] };

// ---------------------------------------------------------------------------
// AC1 — DEFAULT ON (Amendment 46): the registry surface is present unless
// explicitly opted out; explicit opt-out restores the byte-baseline inventory
// ---------------------------------------------------------------------------

describe("default on (unset flag): registry surface present", () => {
  it("registers the registry surface by default: 48 tools + the registry resource template", async () => {
    const { client, server } = await connectClient({ govdispRegistry: { env: {}, store: realStore, base: makeTmpBase() } });

    try {
      const tools = await client.listTools();
      const resources = await client.listResources();
      const templates = await client.listResourceTemplates();

      const names = tools.tools.map((tool) => tool.name);
      for (const name of REGISTRY_TOOL_NAMES) {
        expect(names).toContain(name);
      }
      // Amendment 46 default posture: the 46-tool baseline plus the two
      // registry compat tools; the registry state surface is a resource
      // TEMPLATE, so the static resource inventory is unchanged.
      expect(tools.tools).toHaveLength(48);
      expect(resources.resources.some((resource) => resource.uri.includes(REGISTRY_URI_FRAGMENT))).toBe(false);
      expect(templates.resourceTemplates.map((template) => template.uriTemplate)).toContain("odin://registry/{scope}/events");

      // A baseline tool still answers.
      const version = parseTextResult(await client.callTool({ name: "odin.get_version", arguments: {} })) as { name?: string };
      expect(version.name).toBe("odin-sentinel");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("explicit opt-out: no registry surface (byte-baseline inventory)", () => {
  it("registers no registry tools, resources, or resource templates under explicit opt-out (=0): the 46-tool baseline", async () => {
    const { client, server } = await connectClient({ govdispRegistry: { env: { [FLAG_ENV_VAR]: "0" } } });

    try {
      const tools = await client.listTools();
      const resources = await client.listResources();
      const templates = await client.listResourceTemplates();

      for (const name of REGISTRY_TOOL_NAMES) {
        expect(tools.tools.some((tool) => tool.name === name)).toBe(false);
      }
      expect(tools.tools).toHaveLength(46);
      expect(resources.resources.some((resource) => resource.uri.includes(REGISTRY_URI_FRAGMENT))).toBe(false);
      expect(templates.resourceTemplates.some((template) => template.uriTemplate.includes(REGISTRY_URI_FRAGMENT))).toBe(false);

      // Behavior unchanged: a baseline tool still answers.
      const version = parseTextResult(await client.callTool({ name: "odin.get_version", arguments: {} })) as { name?: string };
      expect(version.name).toBe("odin-sentinel");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("stays inert for every explicit non-truthy opt-out value", async () => {
    for (const value of ["0", "false", "off", "no"]) {
      const { client, server } = await connectClient({ govdispRegistry: { env: { [FLAG_ENV_VAR]: value } } });
      try {
        const tools = await client.listTools();
        expect(tools.tools.some((tool) => REGISTRY_TOOL_NAMES.includes(tool.name))).toBe(false);
      } finally {
        await client.close();
        await server.close();
      }
    }
  });

  it("lets an explicit enabled:false option override a truthy env flag and pin the 46-tool baseline", async () => {
    const { client, server } = await connectClient({
      govdispRegistry: { enabled: false, env: { [FLAG_ENV_VAR]: "1" }, store: realStore, base: makeTmpBase() }
    });
    try {
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => REGISTRY_TOOL_NAMES.includes(tool.name))).toBe(false);
      expect(tools.tools).toHaveLength(46);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Flag ON — registration
// ---------------------------------------------------------------------------

describe("flag on: compat surface registration", () => {
  it("registers both compat tools and the registry resource template only when enabled", async () => {
    const { client, server } = await connectClient({
      govdispRegistry: { env: { [FLAG_ENV_VAR]: "1" }, store: realStore, base: makeTmpBase() }
    });

    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      for (const name of REGISTRY_TOOL_NAMES) {
        expect(names).toContain(name);
      }

      const resources = await client.listResources();
      expect(resources.resources.some((resource) => resource.uri.includes(REGISTRY_URI_FRAGMENT))).toBe(false);

      const templates = await client.listResourceTemplates();
      const uris = templates.resourceTemplates.map((template) => template.uriTemplate);
      expect(uris).toContain("odin://registry/{scope}/events");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("registers via the explicit enabled option with an empty env", async () => {
    const { client, server } = await connectClient({
      govdispRegistry: { enabled: true, env: {}, store: realStore, base: makeTmpBase() }
    });
    try {
      const tools = await client.listTools();
      expect(tools.tools.some((tool) => tool.name === "odin_append_event")).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC2 — flag on: append through the staged choke point
// ---------------------------------------------------------------------------

describe("flag on: odin_append_event", () => {
  it("appends a valid event through the store choke point and echoes it", async () => {
    const base = makeTmpBase();
    const scope = "obj-append";
    const { client, server } = await connectClient({
      govdispRegistry: { env: { [FLAG_ENV_VAR]: "1" }, store: realStore, base }
    });

    try {
      const result = parseTextResult(await client.callTool({
        name: "odin_append_event",
        arguments: { scope, event: attemptEvent({ event_id: "mcp-1" }) }
      })) as AppendToolResult;

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.event.event_id).toBe("mcp-1");
      expect(result.path).toBe(join(base, scope, REGISTRY_EVENTS_FILENAME));

      const text = readFileSync(result.path, "utf8");
      const lines = text.split("\n").filter((line) => line !== "");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).event_id).toBe("mcp-1");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects a malformed event with the store's named rejections propagated, writing nothing", async () => {
    const base = makeTmpBase();
    const scope = "obj-reject";
    const { client, server } = await connectClient({
      govdispRegistry: { env: { [FLAG_ENV_VAR]: "1" }, store: realStore, base }
    });

    try {
      const raw = await client.callTool({
        name: "odin_append_event",
        arguments: { scope, event: attemptEvent({ event_type: "NOPE" }) }
      });
      expect(raw.isError).toBe(true);
      const result = parseTextResult(raw) as AppendToolResult;

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejections.length).toBeGreaterThan(0);
      expect(result.rejections[0].event_class).toBe("ATTEMPT");
      expect(result.rejections.some((rejection) => rejection.field.includes("event_type"))).toBe(true);
      expect(result.rejections[0].code).not.toBe("");
      expect(result.rejections[0].detail).not.toBe("");

      expect(existsSync(join(base, scope, REGISTRY_EVENTS_FILENAME))).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects a non-object event with the store's named invalid_event_shape rejection", async () => {
    const base = makeTmpBase();
    const { client, server } = await connectClient({
      govdispRegistry: { env: { [FLAG_ENV_VAR]: "1" }, store: realStore, base }
    });

    try {
      const raw = await client.callTool({
        name: "odin_append_event",
        arguments: { scope: "obj-nonobject", event: "not an event" }
      });
      expect(raw.isError).toBe(true);
      const result = parseTextResult(raw) as AppendToolResult;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejections[0].code).toBe("invalid_event_shape");
      expect(result.rejections[0].event_class).toBe("<unknown>");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC3 — flag on: deterministic filtered query + read-only registry resource
// ---------------------------------------------------------------------------

describe("flag on: odin_query_events and the registry resource", () => {
  async function seededClient() {
    const base = makeTmpBase();
    const scope = "obj-query";
    const connected = await connectClient({
      govdispRegistry: { env: { [FLAG_ENV_VAR]: "1" }, store: realStore, base }
    });
    const seed = [
      attemptEvent({ event_id: "e1", ts: "2026-08-23T00:00:00Z", stable_objective_id: "obj-1" }),
      attemptEvent({ event_id: "e2", ts: "2026-08-23T01:00:00Z", stable_objective_id: "obj-1", event_type: "ATTEMPT_COUNTED" }),
      findingEvent({ event_id: "e3", ts: "2026-08-23T02:00:00Z", stable_objective_id: "obj-1" }),
      attemptEvent({ event_id: "e4", ts: "2026-08-23T03:00:00Z", stable_objective_id: "obj-2" })
    ];
    for (const event of seed) {
      const appended = parseTextResult(await connected.client.callTool({
        name: "odin_append_event",
        arguments: { scope, event }
      })) as AppendToolResult;
      expect(appended.ok).toBe(true);
    }
    return { ...connected, base, scope };
  }

  it("filters deterministically by stable_objective_id, event class, and time range", async () => {
    const { client, server, scope } = await seededClient();

    async function query(query: Record<string, unknown>): Promise<string[]> {
      const result = parseTextResult(await client.callTool({
        name: "odin_query_events",
        arguments: { scope, query }
      })) as QueryToolResult;
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unexpected query rejection");
      return result.events.map((event) => event.event_id);
    }

    try {
      expect(await query({ stable_objective_id: "obj-1" })).toEqual(["e1", "e2", "e3"]);
      expect(await query({ event_class: "FINDING" })).toEqual(["e3"]);
      expect(await query({ event_type: "ATTEMPT_COUNTED" })).toEqual(["e2"]);
      expect(await query({ from_ts: "2026-08-23T01:00:00Z", to_ts: "2026-08-23T03:00:00Z" })).toEqual(["e2", "e3", "e4"]);
      expect(await query({ stable_objective_id: "obj-1", event_class: "ATTEMPT", from_ts: "2026-08-23T01:00:00Z" })).toEqual(["e2"]);
      // Append order is deterministic across repeated identical queries.
      expect(await query({})).toEqual(["e1", "e2", "e3", "e4"]);
      expect(await query({})).toEqual(["e1", "e2", "e3", "e4"]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects an invalid query filter with the store's named rejection", async () => {
    const { client, server, scope } = await seededClient();

    try {
      const raw = await client.callTool({
        name: "odin_query_events",
        arguments: { scope, query: { bogus: "x" } }
      });
      expect(raw.isError).toBe(true);
      const result = parseTextResult(raw) as QueryToolResult;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejections[0].field).toBe("bogus");
      expect(result.rejections[0].event_class).toBe("<query>");
      expect(result.rejections[0].code).toBe("invalid_query");

      const badClass = parseTextResult(await client.callTool({
        name: "odin_query_events",
        arguments: { scope, query: { event_class: "NOT_A_CLASS" } }
      })) as QueryToolResult;
      expect(badClass.ok).toBe(false);
      if (badClass.ok) return;
      expect(badClass.rejections[0].field).toBe("event_class");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("serves read-only registry state for a scope through the resource", async () => {
    const { client, server, scope } = await seededClient();

    try {
      const resource = await client.readResource({ uri: `odin://registry/${scope}/events` });
      const first = resource.contents[0];
      expect(first.uri).toBe(`odin://registry/${scope}/events`);
      expect(first.mimeType).toBe("application/json");
      const body = JSON.parse("text" in first ? (first.text as string) : "") as {
        scope: string;
        event_count: number;
        events: Array<{ event_id: string }>;
      };
      expect(body.scope).toBe(scope);
      expect(body.event_count).toBe(4);
      expect(body.events.map((event) => event.event_id)).toEqual(["e1", "e2", "e3", "e4"]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Fail-closed wiring — flag on without an injected store
// ---------------------------------------------------------------------------

describe("flag on without an injected store", () => {
  it("fails closed with the named store_unavailable rejection on tools and resource", async () => {
    const { client, server } = await connectClient({
      govdispRegistry: { env: { [FLAG_ENV_VAR]: "1" } }
    });

    try {
      const raw = await client.callTool({
        name: "odin_append_event",
        arguments: { scope: "obj-nostore", event: attemptEvent() }
      });
      expect(raw.isError).toBe(true);
      const result = parseTextResult(raw) as AppendToolResult;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejections[0].field).toBe("store");
      expect(result.rejections[0].code).toBe("store_unavailable");
      expect(result.rejections[0].event_class).toBe("<store>");

      const queryRaw = await client.callTool({
        name: "odin_query_events",
        arguments: { scope: "obj-nostore" }
      });
      expect(queryRaw.isError).toBe(true);
      const queryResult = parseTextResult(queryRaw) as QueryToolResult;
      expect(queryResult.ok).toBe(false);
      if (queryResult.ok) return;
      expect(queryResult.rejections[0].code).toBe("store_unavailable");

      await expect(client.readResource({ uri: "odin://registry/obj-nostore/events" })).rejects.toThrow(/store_unavailable/);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
