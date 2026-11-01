import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/mcp/server.js";
import type { GovdispRegistryStoreLike } from "../src/protocol/service.js";
import {
  appendRegistryEvent,
  queryRegistryEvents,
  REGISTRY_EVENTS_FILENAME
} from "../src/protocol/event-registry/storage.js";

// ---------------------------------------------------------------------------
// REGISTRY-REPAIR-001 — registry default-ON with the shipped filesystem store.
//
// The defect this file guards: the stock CLI (src/bin/index.ts) started the MCP
// server with a zero-argument createServer(), so the registry compatibility
// surface was registered with NO store and every call failed closed with
// store_unavailable even though the registry is documented ON by default.
//
// Coverage split on purpose:
// - EXECUTABLE tests spawn the real compiled CLI (dist/src/bin/index.js) over
//   stdio in an isolated launch cwd, proving startup wiring + the shipped
//   storage contract (.odin/registry under the process launch cwd).
// - PROGRAMMATIC tests pin the injection seam itself: zero-argument
//   createServer() must stay fail-closed for an absent store, and storage-layer
//   negatives (query-only store, unwritable base, creatable base) stay named.
//
// No assertion here weakens the runtime-isolation invariant (the CLI's dynamic
// import) or the 46-tool opt-out inventory.
// ---------------------------------------------------------------------------

const FLAG_ENV_VAR = "ODIN_GOVDISP_REGISTRY_MCP";
const REGISTRY_TOOL_NAMES = ["odin_append_event", "odin_query_events"];
// This file lives at tests/ (one level below the repo root), so the repo root
// is the parent of this file's directory.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const BIN_PATH = join(repoRoot, "dist", "src", "bin", "index.js");

const tmpRoots: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

// Build once so the executable tests exercise the compiled entry point rather
// than a source shim. Regeneration goes through the existing package script
// only; dist is never hand-edited.
beforeAll(() => {
  execFileSync("pnpm", ["run", "build"], { cwd: repoRoot, stdio: "pipe", timeout: 240_000 });
  if (!existsSync(BIN_PATH)) {
    throw new Error(`compiled CLI missing after build: ${BIN_PATH}`);
  }
}, 300_000);

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** Child env with the registry flag removed so ambient opt-outs cannot leak in. */
function childEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  delete env[FLAG_ENV_VAR];
  return { ...env, ...overrides };
}

async function connectExecutable(cwd: string, env: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "odin-sentinel-registry-cli-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN_PATH],
    cwd,
    env,
    stderr: "pipe"
  });
  await client.connect(transport);
  return client;
}

async function connectProgrammatic(options: Parameters<typeof createServer>[0]): Promise<Client> {
  const server = createServer(options);
  const client = new Client({ name: "odin-sentinel-registry-seam-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function parseTextResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  if (!first || first.type !== "text") {
    throw new Error("Expected a text tool result");
  }
  return JSON.parse(first.text ?? "");
}

type RegistryRejection = { field: string; event_class: string; code: string; detail: string };
type AppendBody = { ok: true; path: string; event: { event_id: string } } | { ok: false; rejections: RegistryRejection[] };
type QueryBody = { ok: true; events: Array<{ event_id: string }> } | { ok: false; rejections: RegistryRejection[] };

/** Canonical ATTEMPT event as defined by the shipped schema (not invented). */
function attemptEvent(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "govdisp.event.v1",
    event_id: eventId,
    ts: "2026-10-20T19:00:00Z",
    stable_objective_id: "obj-registry-repair-001",
    event_class: "ATTEMPT",
    event_type: "ATTEMPT_STARTED",
    attempt_index: 1,
    trigger: "start",
    ...overrides
  };
}

const realStore: GovdispRegistryStoreLike = { appendRegistryEvent, queryRegistryEvents };

// ---------------------------------------------------------------------------
// AC1 — executable CLI, default flag, isolated launch cwd, shipped storage
// ---------------------------------------------------------------------------

describe("executable CLI startup (registry default-ON)", () => {
  it("answers a registry query, appends a canonical event under the launch cwd, and reads it back", async () => {
    const cwd = makeTmpDir("odin-registry-cli-cwd-");
    const client = await connectExecutable(cwd, childEnv());

    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      for (const toolName of REGISTRY_TOOL_NAMES) {
        expect(names).toContain(toolName);
      }

      // A missing log is an empty registry, not an error.
      const emptyQuery = await client.callTool({ name: "odin_query_events", arguments: { scope: "rr001", query: {} } });
      expect(emptyQuery.isError ?? false).toBe(false);
      expect(parseTextResult(emptyQuery)).toEqual({ ok: true, events: [] });

      const appended = await client.callTool({
        name: "odin_append_event",
        arguments: { scope: "rr001", event: attemptEvent("evt-rr001-1") }
      });
      expect(appended.isError ?? false).toBe(false);
      const appendBody = parseTextResult(appended) as AppendBody;
      if (!appendBody.ok) throw new Error(`append rejected: ${JSON.stringify(appendBody.rejections)}`);
      expect(appendBody.event.event_id).toBe("evt-rr001-1");

      // The base resolves from the process launch cwd, not from the repo root
      // and not from a global shared scope path.
      // resolve() against the launch cwd can surface the platform real path
      // (macOS /private prefix), so compare canonicalized absolute paths.
      const logPath = join(realpathSync(cwd), ".odin", "registry", "rr001", REGISTRY_EVENTS_FILENAME);
      expect(appendBody.path).toBe(logPath);
      expect(existsSync(logPath)).toBe(true);

      const lines = readFileSync(logPath, "utf8").trimEnd().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ event_id: "evt-rr001-1", event_class: "ATTEMPT" });

      const readBack = await client.callTool({ name: "odin_query_events", arguments: { scope: "rr001", query: {} } });
      expect(readBack.isError ?? false).toBe(false);
      const queryBody = parseTextResult(readBack) as QueryBody;
      if (!queryBody.ok) throw new Error(`query rejected: ${JSON.stringify(queryBody.rejections)}`);
      expect(queryBody.events.map((event) => event.event_id)).toEqual(["evt-rr001-1"]);
    } finally {
      await client.close();
    }
  }, 120_000);

  it("keeps the explicit ODIN_GOVDISP_REGISTRY_MCP=0 opt-out (registry tools removed)", async () => {
    const cwd = makeTmpDir("odin-registry-cli-optout-");
    const client = await connectExecutable(cwd, childEnv({ [FLAG_ENV_VAR]: "0" }));

    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      for (const toolName of REGISTRY_TOOL_NAMES) {
        expect(names).not.toContain(toolName);
      }
      expect(names).toHaveLength(46);
    } finally {
      await client.close();
    }
  }, 120_000);

  it("rejects an unsafe scope through the executable and writes nothing outside the base", async () => {
    const cwd = makeTmpDir("odin-registry-cli-scope-");
    const client = await connectExecutable(cwd, childEnv());

    try {
      const result = await client.callTool({
        name: "odin_append_event",
        arguments: { scope: "../escape", event: attemptEvent("evt-rr001-escape") }
      });
      expect(result.isError).toBe(true);
      const body = parseTextResult(result) as AppendBody;
      if (body.ok) throw new Error("unsafe scope was accepted");
      expect(body.rejections.length).toBeGreaterThan(0);
      expect(JSON.stringify(body.rejections)).toContain("scope");
      expect(existsSync(join(cwd, "escape"))).toBe(false);
      expect(existsSync(join(cwd, ".odin", "registry", "..", "escape"))).toBe(false);
    } finally {
      await client.close();
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// AC2 — programmatic seam: zero-argument createServer stays fail-closed
// ---------------------------------------------------------------------------

describe("programmatic seam (no store injected)", () => {
  it("still registers the default-ON surface but fails closed with store_unavailable", async () => {
    const client = await connectProgrammatic({ govdispRegistry: { env: {} } });

    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      for (const toolName of REGISTRY_TOOL_NAMES) {
        expect(names).toContain(toolName);
      }

      const append = await client.callTool({
        name: "odin_append_event",
        arguments: { scope: "rr001", event: attemptEvent("evt-rr001-nostore") }
      });
      expect(append.isError).toBe(true);
      const appendBody = parseTextResult(append) as AppendBody;
      if (appendBody.ok) throw new Error("zero-argument storeless server accepted an append");
      expect(appendBody.rejections[0]).toMatchObject({ field: "store", code: "store_unavailable" });

      const query = await client.callTool({ name: "odin_query_events", arguments: { scope: "rr001", query: {} } });
      expect(query.isError).toBe(true);
      const queryBody = parseTextResult(query) as QueryBody;
      if (queryBody.ok) throw new Error("zero-argument storeless server accepted a query");
      expect(queryBody.rejections[0]).toMatchObject({ field: "store", code: "store_unavailable" });
    } finally {
      await client.close();
    }
  });

  it("rejects append from a query-only store with a method-specific store_unavailable rejection", async () => {
    const queryOnlyStore = { queryRegistryEvents } as unknown as GovdispRegistryStoreLike;
    const client = await connectProgrammatic({ govdispRegistry: { env: {}, store: queryOnlyStore, base: makeTmpDir("odin-registry-queryonly-") } });

    try {
      const append = await client.callTool({
        name: "odin_append_event",
        arguments: { scope: "rr001", event: attemptEvent("evt-rr001-queryonly") }
      });
      expect(append.isError).toBe(true);
      const body = parseTextResult(append) as AppendBody;
      if (body.ok) throw new Error("query-only store accepted an append");
      expect(body.rejections[0]?.code).toBe("store_unavailable");
      expect(body.rejections[0]?.detail).toContain("appendRegistryEvent");
    } finally {
      await client.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC3 — storage contract negatives (DIAG-002 control8 correction)
// ---------------------------------------------------------------------------

describe("storage contract bounds", () => {
  it("treats an unwritable base as an honest error, never a silent success", () => {
    expect(() => appendRegistryEvent("rr001", attemptEvent("evt-rr001-unwritable"), "/dev/null/odin-registry")).toThrow();
  });

  it("creates a merely nonexistent writable base (not required to fail)", () => {
    const base = join(makeTmpDir("odin-registry-create-"), "fresh", "nested");
    expect(existsSync(base)).toBe(false);

    const appended = appendRegistryEvent("rr001", attemptEvent("evt-rr001-created"), base);
    if (!appended.ok) throw new Error(`append rejected: ${JSON.stringify(appended.rejections)}`);
    expect(existsSync(join(base, "rr001", REGISTRY_EVENTS_FILENAME))).toBe(true);

    const queried = queryRegistryEvents("rr001", {}, base);
    if (!queried.ok) throw new Error(`query rejected: ${JSON.stringify(queried.rejections)}`);
    expect(queried.events.map((event) => event.event_id)).toEqual(["evt-rr001-created"]);
  });

  it("keeps the real store usable through programmatic injection (the seam the CLI now binds)", () => {
    const base = makeTmpDir("odin-registry-injection-");
    expect(realStore.appendRegistryEvent("rr001", attemptEvent("evt-rr001-injected"), base).ok).toBe(true);
    const queried = realStore.queryRegistryEvents("rr001", {}, base);
    if (!queried.ok) throw new Error(`query rejected: ${JSON.stringify(queried.rejections)}`);
    expect(queried.events.map((event) => event.event_id)).toEqual(["evt-rr001-injected"]);
  });
});

// ---------------------------------------------------------------------------
// AC4 — the default wiring is non-blocking (registry-lock-async on the real
// CLI): while another holder owns the registry lock, the executable server must
// keep answering tool calls instead of freezing its event loop for the budget.
// ---------------------------------------------------------------------------

describe("executable CLI startup (non-blocking lock)", () => {
  it("answers odin.get_version in under 300 ms while an append waits on a held lock", async () => {
    const cwd = makeTmpDir("odin-registry-cli-lock-");
    const lockPath = join(cwd, ".odin", "registry", "held", "events.lock");
    mkdirSync(lockPath, { recursive: true });
    const client = await connectExecutable(cwd, childEnv());

    try {
      const pendingAppend = client.callTool({
        name: "odin_append_event",
        arguments: { scope: "held", event: attemptEvent("evt-held-1") }
      });

      const startedAt = Date.now();
      const version = await client.callTool({ name: "odin.get_version", arguments: {} });
      const versionLatencyMs = Date.now() - startedAt;
      expect(versionLatencyMs).toBeLessThan(300);
      expect(parseTextResult(version)).toMatchObject({ name: "odin-sentinel" });

      // Release the lock: the pending append acquires it on its next poll.
      rmdirSync(lockPath);
      const appended = parseTextResult(await pendingAppend) as AppendBody;
      if (!appended.ok) throw new Error(`append rejected: ${JSON.stringify(appended.rejections)}`);
      expect(appended.event.event_id).toBe("evt-held-1");
      const logPath = join(realpathSync(cwd), ".odin", "registry", "held", REGISTRY_EVENTS_FILENAME);
      expect(readFileSync(logPath, "utf8").trimEnd().split("\n")).toHaveLength(1);
    } finally {
      await client.close();
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// AC5 — the startup binding must stay a DYNAMIC import: the runtime host never
// couples statically to the event-registry module (Wave-0 runtime isolation).
// The generic isolation test checks module-root imports; this one pins the exact
// storage submodule the CLI binds, which that regex does not cover.
// ---------------------------------------------------------------------------

describe("startup store binding keeps the runtime-isolation invariant", () => {
  it("imports the storage module dynamically and never statically", () => {
    const source = readFileSync(join(repoRoot, "src", "bin", "index.ts"), "utf8");
    expect(source).toMatch(/await import\(\s*["']\.\.\/protocol\/event-registry\/storage\.js["']\s*\)/);
    expect(source).not.toMatch(/from\s+["'][^"']*event-registry/);
    expect(source).not.toMatch(/require\(\s*["'][^"']*event-registry/);
  });
});
