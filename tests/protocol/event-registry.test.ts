import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendRegistryEvent,
  getRegistryEventsPath,
  isSafeRegistryScope,
  LOCAL_REGISTRY_BASE,
  queryRegistryEvents,
  readRegistryEvents,
  REGISTRY_EVENTS_FILENAME,
  REGISTRY_LOCK_DIRNAME,
  validateGovdispEvent,
  validateRegistryEventQuery,
  type GovdispEvent
} from "../../src/protocol/event-registry/index.js";
import {
  appendGovdispEvent,
  createProtocolService,
  queryGovdispEvents
} from "../../src/protocol/service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-registry-test-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function eventBase(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "govdisp.event.v1",
    event_id: "evt-1",
    ts: "2026-08-22T00:00:00Z",
    stable_objective_id: "obj-govdisp-w1",
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

function eventsFile(base: string, scope: string): string {
  return join(base, scope, REGISTRY_EVENTS_FILENAME);
}

// ---------------------------------------------------------------------------
// validateGovdispEvent — THE single choke point
// ---------------------------------------------------------------------------

describe("validateGovdispEvent (single choke point)", () => {
  it("accepts one valid event per class", () => {
    const events = [
      attemptEvent(),
      findingEvent(),
      eventBase({ event_class: "BREAK_GLASS", event_type: "BREAK_GLASS_RECORDED", authorizing_human: "operator", contradiction_ref: "GDR-20260808-001" }),
      eventBase({ event_class: "BUDGET", event_type: "BUDGET_CROSSED", budget_kind: "tokens" }),
      eventBase({ event_class: "TERMINAL", event_type: "TERMINAL_COMPLETED", content_hashes: [{ path: "src/protocol/service.ts", sha256: "a".repeat(64) }] })
    ];
    for (const event of events) {
      const result = validateGovdispEvent(event);
      expect(result.valid).toBe(true);
    }
  });

  it("rejects a missing required field with a named reason citing field and event class", () => {
    const { event_id: _omitted, ...noId } = attemptEvent();
    const result = validateGovdispEvent(noId);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejections.length).toBeGreaterThan(0);
    expect(result.rejections[0].field).toContain("event_id");
    expect(result.rejections[0].event_class).toBe("ATTEMPT");
    expect(result.rejections[0].code).not.toBe("");
    expect(result.rejections[0].detail).not.toBe("");
  });

  it("rejects an unknown event_type with a named reason", () => {
    const result = validateGovdispEvent(attemptEvent({ event_type: "ATTEMPT_TELEPORTED" }));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejections.some((r) => r.field.includes("event_type"))).toBe(true);
    expect(result.rejections[0].event_class).toBe("ATTEMPT");
  });

  it("rejects unknown extra fields (strict shape) and names the extra field", () => {
    const result = validateGovdispEvent(attemptEvent({ prompt_text: "should never persist" }));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejections.some((r) => r.field.includes("prompt_text") || r.detail.includes("prompt_text"))).toBe(true);
  });

  it("rejects a BREAK_GLASS event without authorizing_human, naming the field", () => {
    const result = validateGovdispEvent(eventBase({ event_class: "BREAK_GLASS", event_type: "BREAK_GLASS_RECORDED", contradiction_ref: "GDR-X" }));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejections.some((r) => r.field.includes("authorizing_human"))).toBe(true);
    expect(result.rejections[0].event_class).toBe("BREAK_GLASS");
  });

  it("rejects a TERMINAL event with empty content_hashes", () => {
    const result = validateGovdispEvent(eventBase({ event_class: "TERMINAL", event_type: "TERMINAL_BLOCKED", content_hashes: [] }));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejections.some((r) => r.field.includes("content_hashes"))).toBe(true);
  });

  it("rejects a wrong schema_version", () => {
    const result = validateGovdispEvent(attemptEvent({ schema_version: "govdisp.event.v0" }));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejections.some((r) => r.field.includes("schema_version"))).toBe(true);
  });

  it("rejects non-object input with event_class <unknown>", () => {
    const result = validateGovdispEvent("not an event");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejections[0].event_class).toBe("<unknown>");
    expect(result.rejections[0].field).toBe("<root>");
  });

  it("rejects an unknown event_class discriminator", () => {
    const result = validateGovdispEvent(eventBase({ event_class: "AUDIT", event_type: "ATTEMPT_STARTED" }));
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejections[0].event_class).toBe("AUDIT");
  });
});

// ---------------------------------------------------------------------------
// Scope safety + path layout
// ---------------------------------------------------------------------------

describe("scope safety and storage layout", () => {
  it("accepts a single safe path segment and rejects traversal forms", () => {
    expect(isSafeRegistryScope("obj-govdisp-w1")).toBe(true);
    expect(isSafeRegistryScope("")).toBe(false);
    expect(isSafeRegistryScope("../escape")).toBe(false);
    expect(isSafeRegistryScope("a/b")).toBe(false);
    expect(isSafeRegistryScope("a\\b")).toBe(false);
    expect(isSafeRegistryScope("..")).toBe(false);
    expect(isSafeRegistryScope(".hidden")).toBe(false);
  });

  it("lays out the log at .odin/registry/<scope>/events.jsonl", () => {
    expect(getRegistryEventsPath("scope-1")).toBe(join(LOCAL_REGISTRY_BASE, "scope-1", "events.jsonl"));
  });

  it("throws (never joins) on an unsafe scope path", () => {
    expect(() => getRegistryEventsPath("../escape")).toThrow(/unsafe registry scope/);
  });

  it(".odin/registry/ is gitignored via the .odin/ entry", () => {
    const gitignore = readFileSync(join(repoRoot, ".gitignore"), "utf8");
    const lines = gitignore.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
    expect(lines.some((line) => line === ".odin/" || line === ".odin/registry/" || line === "/.odin/")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// appendRegistryEvent — choke point + append-only growth (real fs)
// ---------------------------------------------------------------------------

describe("appendRegistryEvent", () => {
  it("appends one JSONL line per event and grows append-only", () => {
    const base = makeTmpBase();
    const scope = "obj-a";
    const first = appendRegistryEvent(scope, attemptEvent({ event_id: "evt-1" }), base);
    expect(first.ok).toBe(true);
    const second = appendRegistryEvent(scope, findingEvent({ event_id: "evt-2" }), base);
    expect(second.ok).toBe(true);

    const text = readFileSync(eventsFile(base, scope), "utf8");
    const lines = text.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event_id).toBe("evt-1");
    expect(JSON.parse(lines[1]).event_id).toBe("evt-2");
    expect(text.endsWith("\n")).toBe(true);
    // No raw newlines inside a record: one complete JSON object per line.
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("rejects a malformed event with a named reason and writes NOTHING (choke point before mkdir/append)", () => {
    const base = makeTmpBase();
    const scope = "obj-b";
    const result = appendRegistryEvent(scope, attemptEvent({ event_type: "NOPE" }), base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0].event_class).toBe("ATTEMPT");
    expect(existsSync(eventsFile(base, scope))).toBe(false);
    expect(existsSync(join(base, scope))).toBe(false);
  });

  it("rejects an unsafe scope with a named reason and no write", () => {
    const base = makeTmpBase();
    const result = appendRegistryEvent("../escape", attemptEvent(), base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0].field).toBe("scope");
    expect(result.rejections[0].code).toBe("unsafe_scope");
    expect(existsSync(join(base, "escape"))).toBe(false);
  });

  it("runs the choke point before any fs mutation (stubbed fs proves no mkdir/append on invalid input)", () => {
    const fsAppend = vi.fn();
    const fsMkdir = vi.fn();
    const fsRmdir = vi.fn();
    const result = appendRegistryEvent("scope-1", { garbage: true }, "/tmp/unused", fsAppend as never, fsMkdir as never, fsRmdir as never);
    expect(result.ok).toBe(false);
    expect(fsAppend).not.toHaveBeenCalled();
    expect(fsMkdir).not.toHaveBeenCalled();
    expect(fsRmdir).not.toHaveBeenCalled();
  });

  it("appends via stubbed fs with the lock acquire/append/release sequence", () => {
    const written: string[] = [];
    const calls: string[] = [];
    const fsAppend = vi.fn().mockImplementation((_p: string, data: string) => {
      calls.push("append");
      written.push(data);
    });
    const fsMkdir = vi.fn().mockImplementation((_p: string, opts?: unknown) => {
      calls.push(opts === undefined ? "lock" : "mkdir");
    });
    const fsRmdir = vi.fn().mockImplementation(() => {
      calls.push("unlock");
    });
    const result = appendRegistryEvent("scope-1", attemptEvent(), "/tmp/fake-base", fsAppend as never, fsMkdir as never, fsRmdir as never);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["mkdir", "lock", "append", "unlock"]);
    expect(written).toHaveLength(1);
    expect(written[0].endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// read / query — deterministic, fail-closed on corruption
// ---------------------------------------------------------------------------

describe("readRegistryEvents / queryRegistryEvents", () => {
  it("reads an empty registry as an empty list (no file is not an error)", () => {
    const base = makeTmpBase();
    const result = readRegistryEvents("absent-scope", base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([]);
  });

  it("rejects an unsafe scope with a named rejection on the read path", () => {
    const base = makeTmpBase();
    const result = readRegistryEvents("../escape", base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0].code).toBe("unsafe_scope");
  });

  it("fails closed on a corrupt line, naming the 1-based line number", () => {
    const base = makeTmpBase();
    const scope = "obj-corrupt";
    appendRegistryEvent(scope, attemptEvent({ event_id: "good-1" }), base);
    appendFileSync(eventsFile(base, scope), "this is not json\n", "utf8");
    const result = readRegistryEvents(scope, base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.some((r) => r.field === "line[2]" && r.code === "corrupt_line")).toBe(true);
  });

  it("fails closed on a valid-JSON but schema-invalid persisted line", () => {
    const base = makeTmpBase();
    const scope = "obj-invalid-line";
    appendRegistryEvent(scope, attemptEvent({ event_id: "good-1" }), base);
    appendFileSync(eventsFile(base, scope), `${JSON.stringify({ event_class: "ATTEMPT", event_type: "ATTEMPT_STARTED" })}\n`, "utf8");
    const result = readRegistryEvents(scope, base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.some((r) => r.field.startsWith("line[2]."))).toBe(true);
    expect(result.rejections[0].event_class).toBe("ATTEMPT");
  });

  it("queries deterministically by stable_objective_id, class, type, and time range", () => {
    const base = makeTmpBase();
    const scope = "obj-query";
    const seed: Array<Record<string, unknown>> = [
      attemptEvent({ event_id: "e1", ts: "2026-08-22T00:00:00Z", stable_objective_id: "obj-1" }),
      attemptEvent({ event_id: "e2", ts: "2026-08-22T01:00:00Z", stable_objective_id: "obj-1", event_type: "ATTEMPT_COUNTED" }),
      findingEvent({ event_id: "e3", ts: "2026-08-22T02:00:00Z", stable_objective_id: "obj-1" }),
      attemptEvent({ event_id: "e4", ts: "2026-08-22T03:00:00Z", stable_objective_id: "obj-2" }),
      findingEvent({ event_id: "e5", ts: "2026-08-22T04:00:00Z", stable_objective_id: "obj-2", event_type: "FINDING_CLOSED" })
    ];
    for (const event of seed) {
      const appended = appendRegistryEvent(scope, event, base);
      expect(appended.ok).toBe(true);
    }

    const byObjective = queryRegistryEvents(scope, { stable_objective_id: "obj-1" }, base);
    expect(byObjective.ok).toBe(true);
    if (!byObjective.ok) return;
    expect(byObjective.events.map((event) => event.event_id)).toEqual(["e1", "e2", "e3"]);

    const byClass = queryRegistryEvents(scope, { event_class: "FINDING" }, base);
    expect(byClass.ok).toBe(true);
    if (!byClass.ok) return;
    expect(byClass.events.map((event) => event.event_id)).toEqual(["e3", "e5"]);

    const byType = queryRegistryEvents(scope, { event_type: "ATTEMPT_COUNTED" }, base);
    expect(byType.ok).toBe(true);
    if (!byType.ok) return;
    expect(byType.events.map((event) => event.event_id)).toEqual(["e2"]);

    const byRange = queryRegistryEvents(scope, { from_ts: "2026-08-22T01:00:00Z", to_ts: "2026-08-22T03:00:00Z" }, base);
    expect(byRange.ok).toBe(true);
    if (!byRange.ok) return;
    expect(byRange.events.map((event) => event.event_id)).toEqual(["e2", "e3", "e4"]);

    const combined = queryRegistryEvents(scope, { stable_objective_id: "obj-1", event_class: "ATTEMPT", from_ts: "2026-08-22T01:00:00Z" }, base);
    expect(combined.ok).toBe(true);
    if (!combined.ok) return;
    expect(combined.events.map((event) => event.event_id)).toEqual(["e2"]);

    // Append order is preserved (deterministic) across repeated identical queries.
    const again = queryRegistryEvents(scope, {}, base);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.events.map((event) => event.event_id)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  it("rejects an invalid query shape with named rejections and no read", () => {
    const base = makeTmpBase();
    const scope = "obj-query-invalid";
    appendRegistryEvent(scope, attemptEvent(), base);
    const badClass = queryRegistryEvents(scope, { event_class: "AUDIT" }, base);
    expect(badClass.ok).toBe(false);
    if (badClass.ok) return;
    expect(badClass.rejections[0].field).toBe("event_class");
    expect(badClass.rejections[0].event_class).toBe("<query>");

    const unknownField = queryRegistryEvents(scope, { bogus: "x" } as never, base);
    expect(unknownField.ok).toBe(false);
    if (unknownField.ok) return;
    expect(unknownField.rejections[0].field).toBe("bogus");

    expect(validateRegistryEventQuery({ from_ts: 42 } as never).some((r) => r.field === "from_ts")).toBe(true);
    expect(validateRegistryEventQuery("nope")).toHaveLength(1);
    expect(validateRegistryEventQuery(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Append-only API surface proof
// ---------------------------------------------------------------------------

describe("append-only API surface", () => {
  it("storage module source contains no mutation/deletion fs calls on the event log", () => {
    const source = readFileSync(join(repoRoot, "src/protocol/event-registry/storage.ts"), "utf8");
    // The only write call on the event log is appendFileSync. No rewrite,
    // truncate, rename, or delete APIs may appear in the module at all.
    expect(source).not.toMatch(/\bwriteFileSync\b/);
    expect(source).not.toMatch(/\bunlinkSync\b/);
    expect(source).not.toMatch(/\brmSync\b/);
    expect(source).not.toMatch(/\btruncateSync\b/);
    expect(source).not.toMatch(/\brenameSync\b/);
    expect(source).not.toMatch(/\bcpSync\b/);
    expect(source).toMatch(/\bappendFileSync\b/);
  });

  it("registry module exports no mutation or deletion API", async () => {
    const registryModule = await import("../../src/protocol/event-registry/index.js");
    for (const exported of Object.keys(registryModule)) {
      expect(exported).not.toMatch(/delete|remove|update|truncate|clear|purge|rewrite/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Service-layer append/query functions (dependency-injected store)
// ---------------------------------------------------------------------------

describe("service append/query functions", () => {
  const store = { appendRegistryEvent, queryRegistryEvents };

  it("appends and queries through the injected store end to end", () => {
    const base = makeTmpBase();
    const scope = "obj-service";
    const appended = appendGovdispEvent(store, scope, attemptEvent({ event_id: "svc-1" }), base);
    expect(appended.ok).toBe(true);

    const queried = queryGovdispEvents(store, scope, { event_class: "ATTEMPT" }, base);
    expect(queried.ok).toBe(true);
    if (!queried.ok) return;
    expect(queried.events.map((event: GovdispEvent) => event.event_id)).toEqual(["svc-1"]);
  });

  it("passes the store's named rejections through unchanged", () => {
    const base = makeTmpBase();
    const result = appendGovdispEvent(store, "obj-service-2", attemptEvent({ event_type: "NOPE" }), base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0].event_class).toBe("ATTEMPT");
    expect(result.rejections.some((r) => r.field.includes("event_type"))).toBe(true);
  });

  it("fails closed with named rejections when the store or scope argument is unusable", () => {
    const noStore = appendGovdispEvent({} as never, "obj-x", attemptEvent());
    expect(noStore.ok).toBe(false);
    if (noStore.ok) return;
    expect(noStore.rejections[0].field).toBe("store");
    expect(noStore.rejections[0].code).toBe("store_unavailable");

    const noStoreQuery = queryGovdispEvents(null as never, "obj-x");
    expect(noStoreQuery.ok).toBe(false);
    if (noStoreQuery.ok) return;
    expect(noStoreQuery.rejections[0].code).toBe("store_unavailable");

    const badScope = appendGovdispEvent(store, "", attemptEvent());
    expect(badScope.ok).toBe(false);
    if (badScope.ok) return;
    expect(badScope.rejections[0].field).toBe("scope");

    const badScopeQuery = queryGovdispEvents(store, 42 as never);
    expect(badScopeQuery.ok).toBe(false);
    if (badScopeQuery.ok) return;
    expect(badScopeQuery.rejections[0].field).toBe("scope");
  });

  it("exposes the append/query functions on the protocol service surface", () => {
    const service = createProtocolService();
    expect(typeof service.appendGovdispEvent).toBe("function");
    expect(typeof service.queryGovdispEvents).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Lock directory naming (contention proof lives in the companion test file)
// ---------------------------------------------------------------------------

describe("contention strategy surface", () => {
  it("names the lock directory alongside the log", () => {
    expect(REGISTRY_LOCK_DIRNAME).toBe("events.lock");
    expect(REGISTRY_EVENTS_FILENAME).toBe("events.jsonl");
  });
});
