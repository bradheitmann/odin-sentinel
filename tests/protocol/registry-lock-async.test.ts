import { mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendRegistryEvent,
  appendRegistryEventAsync,
  REGISTRY_EVENTS_FILENAME,
  REGISTRY_LOCK_DIRNAME,
  type EventRejection
} from "../../src/protocol/event-registry/index.js";

// SLICE registry-lock-async. The MCP server must never block its event loop waiting for the
// registry lock (QA F2 on registry-lock-budget): once the registry store is wired into the
// default server, a contended lock would otherwise freeze every tool call for up to the
// budget. The asynchronous path shares the SAME policy with the synchronous one, so the
// refusal stays exactly the same named rejection.

const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-registry-lock-async-"));
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

function heldLock(base: string, scope: string): string {
  const lockDir = join(base, scope, REGISTRY_LOCK_DIRNAME);
  mkdirSync(lockDir, { recursive: true });
  return lockDir;
}

function onlyRejection(result: { ok: boolean } & { rejections?: EventRejection[] }): EventRejection {
  if (result.ok) throw new Error("expected a named rejection, not a success");
  const rejection = result.rejections?.[0];
  if (!rejection) throw new Error("expected at least one rejection");
  return rejection;
}

function alwaysHeldMkdir(counter: { attempts: number }) {
  return vi.fn().mockImplementation((_path: string, opts?: unknown) => {
    if (opts !== undefined) return undefined;
    counter.attempts += 1;
    const error = new Error("EEXIST: file exists, mkdir") as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  });
}

describe("async lock path: same policy, same named refusal", () => {
  it("appends when the lock is free and releases it", async () => {
    const base = makeTmpBase();
    const result = await appendRegistryEventAsync("free-scope", attemptEvent("free-1"), base);
    expect(result.ok).toBe(true);
    const lines = readFileSync(join(base, "free-scope", REGISTRY_EVENTS_FILENAME), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).event_id).toBe("free-1");
  });

  it("refuses a never-released lock with the same code, field and naming, writing nothing", async () => {
    const base = makeTmpBase();
    const scope = "budget-scope";
    heldLock(base, scope);

    const startedAt = Date.now();
    const result = await appendRegistryEventAsync(scope, attemptEvent("budget-1"), base, undefined, undefined, undefined, {
      lockBudgetMs: 120
    });
    const elapsedMs = Date.now() - startedAt;

    const rejection = onlyRejection(result);
    expect(rejection.code).toBe("lock_unavailable");
    expect(rejection.field).toBe(REGISTRY_LOCK_DIRNAME);
    expect(rejection.event_class).toBe("ATTEMPT");
    expect(rejection.detail).toMatch(/after \d+ attempt\(s\) over \d+ ms/);
    expect(elapsedMs).toBeGreaterThanOrEqual(100);
    expect(elapsedMs).toBeLessThan(2000);
    expect(() => readFileSync(join(base, scope, REGISTRY_EVENTS_FILENAME))).toThrow();
  });

  it("honours explicit maxLockAttempts and lockRetryMs exactly like the sync path", async () => {
    const asyncCounter = { attempts: 0 };
    const syncCounter = { attempts: 0 };
    const options = { maxLockAttempts: 4, lockRetryMs: 1 };

    const asyncResult = await appendRegistryEventAsync(
      "fixed-scope",
      attemptEvent("fixed-async-1"),
      "/tmp/fake-lock-async-base",
      undefined,
      alwaysHeldMkdir(asyncCounter) as never,
      undefined,
      options
    );
    const syncResult = appendRegistryEvent(
      "fixed-scope",
      attemptEvent("fixed-sync-1"),
      "/tmp/fake-lock-async-base",
      undefined,
      alwaysHeldMkdir(syncCounter) as never,
      undefined,
      options
    );

    expect(asyncCounter.attempts).toBe(4);
    expect(syncCounter.attempts).toBe(4);
    expect(onlyRejection(asyncResult).detail).toContain("after 4 attempt(s)");
    expect(onlyRejection(syncResult).detail).toContain("after 4 attempt(s)");
  });

  it("polls more than once under a wall-clock budget, like the sync path", async () => {
    const base = makeTmpBase();
    const scope = "poll-scope";
    heldLock(base, scope);
    const result = await appendRegistryEventAsync(scope, attemptEvent("poll-1"), base, undefined, undefined, undefined, {
      lockBudgetMs: 60
    });
    const rejection = onlyRejection(result);
    expect(rejection.code).toBe("lock_unavailable");
    const attempts = Number(/after (\d+) attempt/.exec(rejection.detail)?.[1] ?? "0");
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it("rejects an invalid event before touching the lock", async () => {
    const base = makeTmpBase();
    const result = await appendRegistryEventAsync("validation-scope", { nope: true }, base);
    const rejection = onlyRejection(result);
    expect(rejection.code).not.toBe("lock_unavailable");
    expect(rejection.event_class).toBe("<unknown>");
  });

  it("lets another append proceed once the held lock is released", async () => {
    const base = makeTmpBase();
    const scope = "release-scope";
    const lockDir = heldLock(base, scope);
    const pending = appendRegistryEventAsync(scope, attemptEvent("release-1"), base, undefined, undefined, undefined, {
      lockBudgetMs: 3000
    });
    setTimeout(() => rmdirSync(lockDir), 150);
    const result = await pending;
    expect(result.ok).toBe(true);
    const lines = readFileSync(join(base, scope, REGISTRY_EVENTS_FILENAME), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
  });
});
