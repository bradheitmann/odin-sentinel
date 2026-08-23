import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendRegistryEvent,
  readRegistryEvents,
  REGISTRY_EVENTS_FILENAME,
  REGISTRY_LOCK_DIRNAME,
  validateGovdispEvent
} from "../../src/protocol/event-registry/index.js";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const storageModuleUrl = pathToFileURL(join(repoRoot, "src/protocol/event-registry/storage.ts")).href;
const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-registry-contention-"));
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
    ts: "2026-08-22T00:00:00Z",
    stable_objective_id: "obj-contention",
    event_class: "ATTEMPT" as const,
    event_type: "ATTEMPT_STARTED" as const,
    attempt_index: 1,
    trigger: "start" as const
  };
}

/**
 * Multi-process contention proof. Four independent OS processes race to append
 * to the SAME scope log through the real storage module. The mkdir lock must
 * serialize them; afterwards every line must be one intact, valid JSON record
 * and the event_id multiset must match exactly — any interleaved write would
 * corrupt a line and fail this check.
 */
describe("event-registry contention (multi-process)", () => {
  it("four racing processes produce an intact, complete, line-atomic log", { timeout: 120000 }, async () => {
    const base = makeTmpBase();
    const scope = "race-scope";
    const processCount = 4;
    const eventsPerProcess = 25;

    const childPath = join(base, "registry-appender.child.mts");
    const childSource = `
import { appendRegistryEvent } from ${JSON.stringify(storageModuleUrl)};
const [scope, base, countRaw, label] = process.argv.slice(2);
const count = Number(countRaw);
let failures = 0;
for (let i = 0; i < count; i += 1) {
  const event = {
    schema_version: "govdisp.event.v1",
    event_id: label + "-" + String(i),
    ts: "2026-08-22T00:00:" + String(i % 60).padStart(2, "0") + "Z",
    stable_objective_id: "obj-contention",
    event_class: "ATTEMPT",
    event_type: "ATTEMPT_STARTED",
    attempt_index: i + 1,
    trigger: "start"
  };
  const result = appendRegistryEvent(scope, event, base);
  if (!result.ok) {
    failures += 1;
    console.error(label + " rejection: " + JSON.stringify(result.rejections));
  }
}
process.exit(failures === 0 ? 0 : 1);
`;
    writeFileSync(childPath, childSource, "utf8");

    const runs: Array<Promise<unknown>> = [];
    for (let k = 0; k < processCount; k += 1) {
      runs.push(
        execFileAsync(
          process.execPath,
          ["--import", "tsx", childPath, scope, base, String(eventsPerProcess), `child-${k}`],
          { cwd: repoRoot }
        )
      );
    }
    const settled = await Promise.allSettled(runs);
    const failures = settled.filter((outcome) => outcome.status === "rejected");
    expect(failures).toEqual([]);

    const logPath = join(base, scope, REGISTRY_EVENTS_FILENAME);
    expect(existsSync(logPath)).toBe(true);
    const text = readFileSync(logPath, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(processCount * eventsPerProcess);

    // No interleaved corruption: every line is one complete valid event.
    const seen = new Set<string>();
    for (const line of lines) {
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(line);
      }).not.toThrow();
      const validation = validateGovdispEvent(parsed);
      expect(validation.valid).toBe(true);
      if (validation.valid) {
        expect(seen.has(validation.event.event_id)).toBe(false);
        seen.add(validation.event.event_id);
      }
    }
    for (let k = 0; k < processCount; k += 1) {
      for (let i = 0; i < eventsPerProcess; i += 1) {
        expect(seen.has(`child-${k}-${i}`)).toBe(true);
      }
    }

    // And the registry's own read path accepts the contested log in full.
    const read = readRegistryEvents(scope, base);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.events).toHaveLength(processCount * eventsPerProcess);
  });
});

describe("event-registry contention (lock semantics)", () => {
  it("fails closed with a named lock_unavailable rejection when the lock is held, writing nothing", () => {
    const base = makeTmpBase();
    const scope = "locked-scope";
    mkdirSync(join(base, scope, REGISTRY_LOCK_DIRNAME), { recursive: true });

    const result = appendRegistryEvent(scope, attemptEvent("blocked-1"), base, undefined, undefined, undefined, {
      maxLockAttempts: 3,
      lockRetryMs: 1
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0].code).toBe("lock_unavailable");
    expect(result.rejections[0].field).toBe(REGISTRY_LOCK_DIRNAME);
    expect(result.rejections[0].event_class).toBe("ATTEMPT");
    expect(existsSync(join(base, scope, REGISTRY_EVENTS_FILENAME))).toBe(false);
  });

  it("retries the lock and appends once the holder releases it", () => {
    const written: string[] = [];
    let lockAttempts = 0;
    const fsAppend = vi.fn().mockImplementation((_p: string, data: string) => {
      written.push(data);
    });
    const fsMkdir = vi.fn().mockImplementation((path: string, opts?: unknown) => {
      if (opts === undefined) {
        lockAttempts += 1;
        if (lockAttempts === 1) {
          const error = new Error("EEXIST: file exists, mkdir") as NodeJS.ErrnoException;
          error.code = "EEXIST";
          throw error;
        }
      }
      return undefined;
    });
    const fsRmdir = vi.fn();

    const result = appendRegistryEvent("retry-scope", attemptEvent("retry-1"), "/tmp/fake-base", fsAppend as never, fsMkdir as never, fsRmdir as never, {
      maxLockAttempts: 5,
      lockRetryMs: 1
    });
    expect(result.ok).toBe(true);
    expect(lockAttempts).toBe(2);
    expect(written).toHaveLength(1);
    expect(fsRmdir).toHaveBeenCalledTimes(1);
  });

  it("rethrows unexpected lock-acquisition errors (operator-visible halt, never a silent drop)", () => {
    const fsAppend = vi.fn();
    const fsMkdir = vi.fn().mockImplementation((path: string, opts?: unknown) => {
      if (opts === undefined) {
        const error = new Error("EACCES: permission denied, mkdir") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return undefined;
    });
    const fsRmdir = vi.fn();
    expect(() =>
      appendRegistryEvent("err-scope", attemptEvent("err-1"), "/tmp/fake-base", fsAppend as never, fsMkdir as never, fsRmdir as never)
    ).toThrow(/EACCES/);
    expect(fsAppend).not.toHaveBeenCalled();
  });

  it("releases the lock even when the append itself throws", () => {
    const fsAppend = vi.fn().mockImplementation(() => {
      throw new Error("disk full");
    });
    const fsMkdir = vi.fn();
    const fsRmdir = vi.fn();
    expect(() =>
      appendRegistryEvent("release-scope", attemptEvent("release-1"), "/tmp/fake-base", fsAppend as never, fsMkdir as never, fsRmdir as never)
    ).toThrow(/disk full/);
    expect(fsRmdir).toHaveBeenCalledTimes(1);
  });

  it("an in-process burst of appends yields an intact log (line atomicity guard)", () => {
    const base = makeTmpBase();
    const scope = "burst-scope";
    const count = 200;
    const results = [];
    for (let i = 0; i < count; i += 1) {
      results.push(appendRegistryEvent(scope, attemptEvent(`burst-${i}`), base));
    }
    expect(results.every((result) => result.ok)).toBe(true);
    const text = readFileSync(join(base, scope, REGISTRY_EVENTS_FILENAME), "utf8");
    const lines = text.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(count);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
