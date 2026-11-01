import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type CreateServerOptions } from "../../src/mcp/server.js";
import {
  appendRegistryEvent,
  appendRegistryEventAsync,
  queryRegistryEvents,
  REGISTRY_EVENTS_FILENAME,
  REGISTRY_LOCK_DIRNAME
} from "../../src/protocol/event-registry/index.js";
import { appendGovdispEvent, type GovdispRegistryStoreLike } from "../../src/protocol/governance.js";

// SLICE registry-lock-async, proof 1: the MCP server must keep answering while an append
// waits for a contended registry lock. Before this slice the wait used Atomics.wait, so once
// a store is wired into the default server a contended lock would freeze EVERY tool call for
// up to the lock budget. The async path waits with timers; this test proves the event loop
// stays free, and that the pending append still succeeds once the lock is released.

const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-mcp-lock-async-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function attemptEvent(eventId: string) {
  return {
    schema_version: "govdisp.event.v1",
    event_id: eventId,
    ts: "2026-10-31T00:00:00Z",
    stable_objective_id: "obj-lock-async",
    event_class: "ATTEMPT" as const,
    event_type: "ATTEMPT_STARTED" as const,
    attempt_index: 1,
    trigger: "start" as const
  };
}

async function connect(options?: CreateServerOptions) {
  const server = createServer(options);
  const client = new Client({ name: "registry-lock-async-mcp", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  if (!first || first.type !== "text") throw new Error("Expected text tool result");
  return first.text ?? "";
}

const LOCK_BUDGET_MS = 2_500;

function asyncStore(): GovdispRegistryStoreLike {
  return {
    appendRegistryEvent,
    appendRegistryEventAsync: (scope: string, event: unknown, base?: string) =>
      appendRegistryEventAsync(scope, event, base, undefined, undefined, undefined, {
        lockBudgetMs: LOCK_BUDGET_MS
      }),
    queryRegistryEvents
  };
}

describe("MCP server stays responsive while an append waits for the registry lock", () => {
  it("answers another tool call in under 300 ms, and the pending append then succeeds", async () => {
    const base = makeTmpBase();
    const scope = "ops";
    const lockDir = join(base, scope, REGISTRY_LOCK_DIRNAME);
    mkdirSync(lockDir, { recursive: true });

    const { client, server } = await connect({ govdispRegistry: { enabled: true, store: asyncStore(), base } });
    try {
      // Both calls are dispatched in order: the append starts first and (async) yields at its
      // first timer wait, so the version call must be answered immediately. A synchronous
      // wait would hold the event loop and delay the second response by the lock budget.
      const pendingAppend = client.callTool({
        name: "odin_append_event",
        arguments: { scope, event: attemptEvent("evt-lock-async-1") }
      });

      const startedAt = Date.now();
      const version = await client.callTool({ name: "odin.get_version", arguments: {} });
      const versionLatencyMs = Date.now() - startedAt;

      expect(versionLatencyMs).toBeLessThan(300);
      expect(textOf(version)).toContain("odin-sentinel");

      // Release the lock: the pending append acquires it on its next poll and completes.
      rmdirSync(lockDir);
      const appended = JSON.parse(textOf(await pendingAppend)) as { ok?: boolean };
      expect(appended.ok).toBe(true);

      const lines = readFileSync(join(base, scope, REGISTRY_EVENTS_FILENAME), "utf8")
        .trim()
        .split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).event_id).toBe("evt-lock-async-1");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("with no store injected, odin_append_event is byte-identical to the synchronous service result", async () => {
    const { client, server } = await connect();
    try {
      const event = attemptEvent("evt-no-store");
      const result = await client.callTool({
        name: "odin_append_event",
        arguments: { scope: "ops", event }
      });
      // The exact text main produced with no store injected (frozen literal, not a call
      // through the same code): any drift in the no-store branch fails this byte comparison.
      const frozenNoStoreText = [
        "{",
        "  \"ok\": false,",
        "  \"rejections\": [",
        "    {",
        "      \"field\": \"store\",",
        "      \"event_class\": \"<store>\",",
        "      \"code\": \"store_unavailable\",",
        "      \"detail\": \"a registry store with a appendRegistryEvent function is required; construct one from the Wave-1 registry storage module and inject it\"",
        "    }",
        "  ]",
        "}"
      ].join("\n");
      expect(textOf(result)).toBe(frozenNoStoreText);
      expect(result.isError).toBe(true);
      // And the service still agrees with itself.
      const direct = appendGovdispEvent(undefined as never, "ops", event);
      expect(JSON.stringify(direct, null, 2)).toBe(frozenNoStoreText);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
