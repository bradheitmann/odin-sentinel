import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendRegistryEvent,
  REGISTRY_EVENTS_FILENAME,
  REGISTRY_LOCK_DIRNAME,
  type EventRejection
} from "../../src/protocol/event-registry/index.js";
import { compactRegistryEvents } from "../../src/protocol/event-registry/compact.js";

// SLICE registry-lock-budget. Field origin 2026-10-31: the cross-process lock
// gave a contending writer 50 attempts x 10 ms (about 0.5 s) before a named
// lock_unavailable rejection, so tests/protocol/event-registry-contention.test.ts
// (4 writers x 25 appends) failed roughly 1 run in 4 even alone. Fail-closed is
// right; the default budget was too tight. The default policy is now capped
// exponential backoff with jitter under a wall-clock budget (start 5 ms,
// double to a 200 ms cap, default budget 10 000 ms). Explicit maxLockAttempts /
// lockRetryMs still pin the legacy fixed attempt count and interval.

const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-registry-lock-budget-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function attemptEvent(eventId: string, ts = "2020-01-01T00:00:00Z") {
  return {
    schema_version: "govdisp.event.v1",
    event_id: eventId,
    ts,
    stable_objective_id: "obj-lock-budget",
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
    // The recursive base-directory mkdir is not a lock acquisition.
    if (opts !== undefined) return undefined;
    counter.attempts += 1;
    const error = new Error("EEXIST: file exists, mkdir") as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  });
}

describe("default lock policy: capped backoff under a wall-clock budget", () => {
  it("waits past the old 0.5 s window instead of exhausting 50 fixed attempts", () => {
    const base = makeTmpBase();
    const scope = "budget-scope";
    heldLock(base, scope);

    const startedAt = Date.now();
    const result = appendRegistryEvent(scope, attemptEvent("budget-1"), base, undefined, undefined, undefined, {
      lockBudgetMs: 120
    });
    const elapsedMs = Date.now() - startedAt;

    const rejection = onlyRejection(result);
    expect(rejection.code).toBe("lock_unavailable");
    expect(rejection.field).toBe(REGISTRY_LOCK_DIRNAME);
    expect(rejection.event_class).toBe("ATTEMPT");
    // The rejection names the attempts made and the elapsed milliseconds.
    expect(rejection.detail).toMatch(/after \d+ attempt\(s\) over \d+ ms/);
    expect(elapsedMs).toBeGreaterThanOrEqual(100);
    expect(elapsedMs).toBeLessThan(2000);
    // Fail-closed: nothing was written.
    expect(existsSync(join(base, scope, REGISTRY_EVENTS_FILENAME))).toBe(false);
  });

  it("still fails closed, with the same code and field, when the budget is already spent", () => {
    const base = makeTmpBase();
    const scope = "zero-budget-scope";
    heldLock(base, scope);

    const result = appendRegistryEvent(scope, attemptEvent("zero-1"), base, undefined, undefined, undefined, {
      lockBudgetMs: 0
    });
    const rejection = onlyRejection(result);
    expect(rejection.code).toBe("lock_unavailable");
    expect(rejection.field).toBe(REGISTRY_LOCK_DIRNAME);
    expect(rejection.detail).toContain("after 1 attempt(s)");
    expect(existsSync(join(base, scope, REGISTRY_EVENTS_FILENAME))).toBe(false);
  });

  it("appends normally and releases the lock when uncontended", () => {
    const base = makeTmpBase();
    const scope = "free-scope";
    const result = appendRegistryEvent(scope, attemptEvent("free-1"), base);
    expect(result.ok).toBe(true);
    expect(existsSync(join(base, scope, REGISTRY_LOCK_DIRNAME))).toBe(false);
    const lines = readFileSync(join(base, scope, REGISTRY_EVENTS_FILENAME), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
  });
});

describe("explicit lock options keep the legacy fixed policy", () => {
  it("uses exactly maxLockAttempts at the fixed lockRetryMs interval", () => {
    const counter = { attempts: 0 };
    const fsMkdir = alwaysHeldMkdir(counter);
    const result = appendRegistryEvent(
      "fixed-scope",
      attemptEvent("fixed-1"),
      "/tmp/fake-lock-budget-base",
      undefined,
      fsMkdir as never,
      undefined,
      { maxLockAttempts: 4, lockRetryMs: 1 }
    );
    expect(counter.attempts).toBe(4);
    const rejection = onlyRejection(result);
    expect(rejection.code).toBe("lock_unavailable");
    expect(rejection.detail).toContain("after 4 attempt(s)");
  });

  it("explicit options win over the default budget", () => {
    const counter = { attempts: 0 };
    const fsMkdir = alwaysHeldMkdir(counter);
    const startedAt = Date.now();
    const result = appendRegistryEvent(
      "explicit-wins-scope",
      attemptEvent("explicit-wins-1"),
      "/tmp/fake-lock-budget-base",
      undefined,
      fsMkdir as never,
      undefined,
      { maxLockAttempts: 2, lockRetryMs: 1, lockBudgetMs: 5000 }
    );
    expect(counter.attempts).toBe(2);
    expect(onlyRejection(result).detail).toContain("after 2 attempt(s)");
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("a single explicit lockRetryMs keeps the legacy 50-attempt cap at that interval", () => {
    const counter = { attempts: 0 };
    const fsMkdir = alwaysHeldMkdir(counter);
    const result = appendRegistryEvent(
      "retry-only-scope",
      attemptEvent("retry-only-1"),
      "/tmp/fake-lock-budget-base",
      undefined,
      fsMkdir as never,
      undefined,
      { lockRetryMs: 0 }
    );
    expect(counter.attempts).toBe(50);
    expect(onlyRejection(result).detail).toContain("after 50 attempt(s)");
  });
});

describe("compaction shares the same lock policy", () => {
  function seedCompactableLog(base: string, scope: string): string {
    const appended = appendRegistryEvent(scope, attemptEvent("old-1"), base);
    expect(appended.ok).toBe(true);
    return join(base, scope, REGISTRY_EVENTS_FILENAME);
  }

  it("fails closed with a named lock_unavailable under the default backoff budget", () => {
    const base = makeTmpBase();
    const scope = "compact-budget-scope";
    const logPath = seedCompactableLog(base, scope);
    const before = readFileSync(logPath, "utf8");
    heldLock(base, scope);

    const startedAt = Date.now();
    const result = compactRegistryEvents(scope, {
      base,
      now: "2026-10-31T00:00:00Z",
      lockBudgetMs: 120
    });
    const elapsedMs = Date.now() - startedAt;

    const rejection = onlyRejection(result);
    expect(rejection.code).toBe("lock_unavailable");
    expect(rejection.field).toBe(REGISTRY_LOCK_DIRNAME);
    expect(rejection.detail).toMatch(/after \d+ attempt\(s\) over \d+ ms/);
    expect(rejection.detail).toContain("compaction fails closed");
    expect(elapsedMs).toBeGreaterThanOrEqual(100);
    expect(elapsedMs).toBeLessThan(2000);
    // No partial or renamed write: the log is byte-identical.
    expect(readFileSync(logPath, "utf8")).toBe(before);
  });

  it("honours explicit maxLockAttempts and lockRetryMs unchanged", () => {
    const base = makeTmpBase();
    const scope = "compact-fixed-scope";
    seedCompactableLog(base, scope);
    const counter = { attempts: 0 };
    const fsMkdir = alwaysHeldMkdir(counter);

    const result = compactRegistryEvents(scope, {
      base,
      now: "2026-10-31T00:00:00Z",
      maxLockAttempts: 3,
      lockRetryMs: 1,
      fsMkdir: fsMkdir as never
    });

    expect(counter.attempts).toBe(3);
    const rejection = onlyRejection(result);
    expect(rejection.code).toBe("lock_unavailable");
    expect(rejection.detail).toContain("after 3 attempt(s)");
  });
});
