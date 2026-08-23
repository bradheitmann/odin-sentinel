import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendRegistryEvent,
  EVENT_TOO_LARGE_CODE,
  GOVDISP_EVENT_MAX_BYTES,
  readRegistryEvents,
  REGISTRY_EVENTS_FILENAME,
  REGISTRY_LOCK_DIRNAME
} from "../../src/protocol/event-registry/storage.js";
import {
  COMPACTION_SUMMARY_EVENT_TYPE,
  compactRegistryEvents,
  GOVDISP_PROOF_TTL_CLASS_OVERRIDES,
  GOVDISP_PROOF_TTL_DAYS_DEFAULT,
  hashRegistryEventLine,
  REGISTRY_COMPACT_TMP_FILENAME
} from "../../src/protocol/event-registry/compact.js";
import { runCompactRegistryCli } from "../../src/bin/index.js";

// ---------------------------------------------------------------------------
// SLICE-GOVDISP-TTL-DEV-001 — proof TTL/compaction (GD-DEC-006), the
// compact-registry CLI, and the per-event byte-cap closing the GOVDISP-002
// exam's O1 holdout finding.
//
// Compaction: raw proof events older than the TTL compact into ONE terminal
// summary record per scope (a TERMINAL_COMPLETED event carrying the ordered
// sha256 of every removed line). Deterministic (same log + same now →
// byte-identical), replay-verifiable (hash of each removed event preserved
// in order), atomic (temp + rename under the append path's mkdir lock).
// The byte-cap rides the append choke point: over-cap events are rejected
// fail-closed by name (event_too_large, field "_size").
// ---------------------------------------------------------------------------

const NOW = "2026-08-23T00:00:00.000Z";
// Default TTL 30 days → cutoff 2026-07-24T00:00:00.000Z.
const OLD_TS = "2026-07-23T23:59:59.000Z"; // just older than the cutoff → compacts
const BOUNDARY_TS = "2026-07-24T00:00:00.000Z"; // exactly at the cutoff → survives
const FRESH_TS = "2026-08-22T00:00:00.000Z"; // fresh → survives

const tmpRoots: string[] = [];

function makeTmpBase(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-govdisp-ttl-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

let eventSeq = 0;

function eventBase(objectiveId: string, ts: string) {
  eventSeq += 1;
  return {
    schema_version: "govdisp.event.v1",
    event_id: `evt-ttl-${eventSeq}`,
    ts,
    stable_objective_id: objectiveId
  };
}

function attemptEvent(objectiveId: string, ts: string) {
  return { ...eventBase(objectiveId, ts), event_class: "ATTEMPT", event_type: "ATTEMPT_STARTED" };
}

function findingEvent(objectiveId: string, ts: string, findingId: string) {
  return { ...eventBase(objectiveId, ts), event_class: "FINDING", event_type: "FINDING_OPENED", finding_id: findingId };
}

function terminalEvent(objectiveId: string, ts: string) {
  return {
    ...eventBase(objectiveId, ts),
    event_class: "TERMINAL",
    event_type: "TERMINAL_COMPLETED",
    content_hashes: [{ path: "src/protocol/service.ts", sha256: "a".repeat(64) }]
  };
}

function seed(base: string, scope: string, event: unknown): void {
  const result = appendRegistryEvent(scope, event, base);
  expect(result.ok).toBe(true);
}

function eventsPath(base: string, scope: string): string {
  return join(base, scope, REGISTRY_EVENTS_FILENAME);
}

function logLines(base: string, scope: string): string[] {
  const lines = readFileSync(eventsPath(base, scope), "utf8").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function lineByteLength(event: unknown): number {
  return Buffer.byteLength(`${JSON.stringify(event)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// TTL boundary
// ---------------------------------------------------------------------------

describe("compaction TTL boundary", () => {
  it("compacts events strictly older than the TTL and keeps at-boundary and fresh events", () => {
    const base = makeTmpBase();
    const scope = "scope-boundary";
    seed(base, scope, attemptEvent("obj-b", OLD_TS));
    seed(base, scope, findingEvent("obj-b", BOUNDARY_TS, "finding-b"));
    seed(base, scope, attemptEvent("obj-b", FRESH_TS));

    const result = compactRegistryEvents(scope, { base, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.compacted).toBe(true);
    expect(result.report.removed_count).toBe(1);
    expect(result.report.kept_count).toBe(2);
    expect(result.report.removed_per_class).toEqual({ ATTEMPT: 1 });
    expect(result.report.dry_run).toBe(false);
    expect(result.report.now).toBe(NOW);
    expect(result.report.ttl_days_default).toBe(GOVDISP_PROOF_TTL_DAYS_DEFAULT);
    expect(result.report.ttl_days_default).toBe(30);

    // The compacted log stays valid and readable: kept events in append
    // order, then exactly one terminal summary record, last.
    const read = readRegistryEvents(scope, base);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.events).toHaveLength(3);
    expect(read.events[0].ts).toBe(BOUNDARY_TS);
    expect(read.events[1].ts).toBe(FRESH_TS);
    const summary = read.events[2];
    expect(summary.event_class).toBe("TERMINAL");
    if (summary.event_class !== "TERMINAL") return;
    expect(summary.event_type).toBe(COMPACTION_SUMMARY_EVENT_TYPE);
    expect(summary.stable_objective_id).toBe(scope);
    expect(summary.ts).toBe(NOW);
    expect(summary.content_hashes).toHaveLength(1);
  });

  it("honors per-event-class TTL overrides", () => {
    const base = makeTmpBase();
    const scope = "scope-override";
    // Both events are 45 days old: past the 30-day default, inside a 60-day override.
    const fortyFiveDaysAgo = "2026-07-09T00:00:00.000Z";
    seed(base, scope, findingEvent("obj-o", fortyFiveDaysAgo, "finding-old"));
    seed(base, scope, attemptEvent("obj-o", fortyFiveDaysAgo));

    const result = compactRegistryEvents(scope, { base, now: NOW, ttlDaysByClass: { FINDING: 60 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.removed_per_class).toEqual({ ATTEMPT: 1 });
    expect(result.report.ttl_days_by_class).toEqual({ FINDING: 60 });

    const read = readRegistryEvents(scope, base);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const finding = read.events[0];
    expect(finding.event_class).toBe("FINDING");
    if (finding.event_class !== "FINDING") return;
    expect(finding.finding_id).toBe("finding-old");
    expect(read.events[1].event_class).toBe("TERMINAL");
  });

  it("never compacts TERMINAL-class events, however old they are", () => {
    const base = makeTmpBase();
    const scope = "scope-terminal";
    seed(base, scope, terminalEvent("obj-t", "2026-05-01T00:00:00.000Z"));
    seed(base, scope, attemptEvent("obj-t", "2026-05-01T00:00:00.000Z"));

    const result = compactRegistryEvents(scope, { base, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.removed_per_class).toEqual({ ATTEMPT: 1 });
    expect(result.report.removed_per_class.TERMINAL).toBeUndefined();

    const lines = logLines(base, scope);
    expect(lines).toHaveLength(2);
    const keptTerminal = JSON.parse(lines[0]);
    expect(keptTerminal.event_class).toBe("TERMINAL");
    expect(keptTerminal.ts).toBe("2026-05-01T00:00:00.000Z");

    // Re-compacting at the same instant is a no-op even though the seeded
    // terminal record is far past the TTL: nothing old enough remains.
    const second = compactRegistryEvents(scope, { base, now: NOW });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.report.compacted).toBe(false);
    expect(logLines(base, scope)).toEqual(lines);
  });

  it("ships an empty class-override policy by default", () => {
    expect(GOVDISP_PROOF_TTL_CLASS_OVERRIDES).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("compaction determinism", () => {
  it("compacting the same log twice with the same now yields byte-identical output", () => {
    const base = makeTmpBase();
    const scope = "scope-det";
    seed(base, scope, attemptEvent("obj-d", OLD_TS));
    seed(base, scope, attemptEvent("obj-d", "2026-07-01T00:00:00.000Z"));
    seed(base, scope, attemptEvent("obj-d", FRESH_TS));
    const original = readFileSync(eventsPath(base, scope), "utf8");

    const first = compactRegistryEvents(scope, { base, now: NOW });
    expect(first.ok).toBe(true);
    const compactedOnce = readFileSync(eventsPath(base, scope), "utf8");
    expect(compactedOnce).not.toBe(original);

    // Restore the identical log and compact again at the same instant.
    writeFileSync(eventsPath(base, scope), original, "utf8");
    const second = compactRegistryEvents(scope, { base, now: NOW });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(readFileSync(eventsPath(base, scope), "utf8")).toBe(compactedOnce);
    expect(second.report).toEqual(first.report);
  });

  it("is a no-op on an already compacted log at the same instant (nothing written)", () => {
    const base = makeTmpBase();
    const scope = "scope-idem";
    seed(base, scope, attemptEvent("obj-i", OLD_TS));
    seed(base, scope, attemptEvent("obj-i", FRESH_TS));

    const first = compactRegistryEvents(scope, { base, now: NOW });
    expect(first.ok).toBe(true);
    const compacted = readFileSync(eventsPath(base, scope), "utf8");
    const listing = readdirSync(join(base, scope)).sort();

    const second = compactRegistryEvents(scope, { base, now: NOW });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.report.compacted).toBe(false);
    expect(second.report.removed_count).toBe(0);
    expect(second.report.summary_event).toBeNull();
    expect(second.report.bytes_after).toBe(second.report.bytes_before);
    expect(readFileSync(eventsPath(base, scope), "utf8")).toBe(compacted);
    expect(readdirSync(join(base, scope)).sort()).toEqual(listing);
  });

  it("is a no-op for a missing log and for a log with nothing old enough", () => {
    const base = makeTmpBase();
    const missing = compactRegistryEvents("scope-absent", { base, now: NOW });
    expect(missing.ok).toBe(true);
    if (!missing.ok) return;
    expect(missing.report.compacted).toBe(false);
    expect(missing.report.bytes_before).toBe(0);

    const scope = "scope-fresh";
    seed(base, scope, attemptEvent("obj-f", FRESH_TS));
    const before = readFileSync(eventsPath(base, scope), "utf8");
    const result = compactRegistryEvents(scope, { base, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.compacted).toBe(false);
    expect(readFileSync(eventsPath(base, scope), "utf8")).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Hash-chain replay verification
// ---------------------------------------------------------------------------

describe("compaction hash chain", () => {
  it("preserves the sha256 of each removed event in order, replay-verifiable against the original log", () => {
    const base = makeTmpBase();
    const scope = "scope-chain";
    seed(base, scope, attemptEvent("obj-c", OLD_TS));
    seed(base, scope, findingEvent("obj-c", "2026-07-10T00:00:00.000Z", "finding-chain"));
    seed(base, scope, attemptEvent("obj-c", BOUNDARY_TS));
    const originalLines = logLines(base, scope);
    const removedLines = [originalLines[0], originalLines[1]];

    const result = compactRegistryEvents(scope, { base, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = result.report.summary_event;
    expect(summary).not.toBeNull();
    if (summary === null) return;

    // Replay: re-hash each removed line in file order; the summary's
    // content_hashes must match exactly, path bound to the removed event_id.
    expect(summary.content_hashes.map((hash) => hash.sha256)).toEqual(removedLines.map((line) => hashRegistryEventLine(line)));
    expect(summary.content_hashes.map((hash) => hash.path)).toEqual(removedLines.map((line) => (JSON.parse(line) as { event_id: string }).event_id));

    // Independent recomputation with the verify-pack hash convention.
    for (const [index, line] of removedLines.entries()) {
      const digest = createHash("sha256").update(line, "utf8").digest("hex");
      expect(summary.content_hashes[index].sha256).toBe(digest);
    }

    // The summary event_id is content-derived: the digest of the ordered
    // path:hash lines, so identical input reproduces the identical record.
    const chainDigest = createHash("sha256")
      .update(summary.content_hashes.map((hash) => `${hash.path}:${hash.sha256}`).join("\n"), "utf8")
      .digest("hex");
    expect(summary.event_id).toBe(`evt-compaction-${chainDigest.slice(0, 24)}`);
    expect(summary.ts).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// Dry-run
// ---------------------------------------------------------------------------

describe("compaction dry-run", () => {
  it("reports what WOULD compact and writes nothing (no file change, no temp, no lock)", () => {
    const base = makeTmpBase();
    const scope = "scope-dry";
    seed(base, scope, attemptEvent("obj-dry", OLD_TS));
    seed(base, scope, attemptEvent("obj-dry", FRESH_TS));
    const before = readFileSync(eventsPath(base, scope), "utf8");
    const listingBefore = readdirSync(join(base, scope)).sort();

    const result = compactRegistryEvents(scope, { base, now: NOW, dryRun: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.dry_run).toBe(true);
    expect(result.report.compacted).toBe(true);
    expect(result.report.removed_count).toBe(1);
    expect(result.report.kept_count).toBe(1);
    expect(result.report.summary_event).not.toBeNull();

    expect(readFileSync(eventsPath(base, scope), "utf8")).toBe(before);
    expect(readdirSync(join(base, scope)).sort()).toEqual(listingBefore);
    expect(existsSync(join(base, scope, REGISTRY_COMPACT_TMP_FILENAME))).toBe(false);

    // The dry-run projection is exact: a real run lands a log of precisely
    // the projected size. (For tiny logs the summary can outweigh the removed
    // lines; compaction pays off as removed history grows.)
    const projectedBytes = result.report.bytes_after;
    const real = compactRegistryEvents(scope, { base, now: NOW });
    expect(real.ok).toBe(true);
    expect(Buffer.byteLength(readFileSync(eventsPath(base, scope), "utf8"), "utf8")).toBe(projectedBytes);
  });
});

// ---------------------------------------------------------------------------
// Atomicity
// ---------------------------------------------------------------------------

describe("compaction atomicity", () => {
  it("leaves the original log intact and releases the lock when the temp write fails", () => {
    const base = makeTmpBase();
    const scope = "scope-atomic-write";
    seed(base, scope, attemptEvent("obj-a", OLD_TS));
    seed(base, scope, attemptEvent("obj-a", FRESH_TS));
    const original = readFileSync(eventsPath(base, scope), "utf8");

    expect(() =>
      compactRegistryEvents(scope, {
        base,
        now: NOW,
        fsWrite: (() => {
          throw new Error("injected write failure");
        }) as never
      })
    ).toThrow("injected write failure");

    expect(readFileSync(eventsPath(base, scope), "utf8")).toBe(original);
    expect(readdirSync(join(base, scope)).sort()).toEqual([REGISTRY_EVENTS_FILENAME]);

    // The lock was released: a subsequent append succeeds.
    seed(base, scope, attemptEvent("obj-a", FRESH_TS));
  });

  it("leaves the original log intact and removes the temp when the rename fails", () => {
    const base = makeTmpBase();
    const scope = "scope-atomic-rename";
    seed(base, scope, attemptEvent("obj-r", OLD_TS));
    seed(base, scope, attemptEvent("obj-r", FRESH_TS));
    const original = readFileSync(eventsPath(base, scope), "utf8");

    expect(() =>
      compactRegistryEvents(scope, {
        base,
        now: NOW,
        fsRename: (() => {
          throw new Error("injected rename failure");
        }) as never
      })
    ).toThrow("injected rename failure");

    expect(readFileSync(eventsPath(base, scope), "utf8")).toBe(original);
    // No partial events.jsonl, no leftover temp, no stale lock.
    expect(readdirSync(join(base, scope)).sort()).toEqual([REGISTRY_EVENTS_FILENAME]);
  });

  it("fails closed with a named lock_unavailable rejection when the lock is held, writing nothing", () => {
    const base = makeTmpBase();
    const scope = "scope-locked";
    seed(base, scope, attemptEvent("obj-l", OLD_TS));
    const before = readFileSync(eventsPath(base, scope), "utf8");
    mkdirSync(join(base, scope, REGISTRY_LOCK_DIRNAME));

    const result = compactRegistryEvents(scope, { base, now: NOW, maxLockAttempts: 3, lockRetryMs: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0].code).toBe("lock_unavailable");
    expect(result.rejections[0].field).toBe(REGISTRY_LOCK_DIRNAME);
    expect(readFileSync(eventsPath(base, scope), "utf8")).toBe(before);

    rmdirSync(join(base, scope, REGISTRY_LOCK_DIRNAME));
  });

  it("keeps the log appendable after a successful compaction", () => {
    const base = makeTmpBase();
    const scope = "scope-append-after";
    seed(base, scope, attemptEvent("obj-ap", OLD_TS));
    seed(base, scope, attemptEvent("obj-ap", FRESH_TS));

    const result = compactRegistryEvents(scope, { base, now: NOW });
    expect(result.ok).toBe(true);

    seed(base, scope, attemptEvent("obj-ap", NOW));
    const read = readRegistryEvents(scope, base);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.events).toHaveLength(3);
    expect(read.events[2].ts).toBe(NOW);
    expect(read.events[1].event_class).toBe("TERMINAL");
  });
});

// ---------------------------------------------------------------------------
// Fail-closed refusals
// ---------------------------------------------------------------------------

describe("compaction fail-closed refusals", () => {
  it("refuses an unsafe scope by name", () => {
    const base = makeTmpBase();
    const result = compactRegistryEvents("../escape", { base, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0].field).toBe("scope");
    expect(result.rejections[0].code).toBe("unsafe_scope");
  });

  it("refuses an unparseable evaluation instant by name", () => {
    const base = makeTmpBase();
    const result = compactRegistryEvents("scope-now", { base, now: "not-a-date" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0].field).toBe("now");
    expect(result.rejections[0].code).toBe("invalid_now");
  });

  it("refuses invalid TTL policy by name (nonpositive default; unknown override class)", () => {
    const base = makeTmpBase();
    const badDefault = compactRegistryEvents("scope-ttl", { base, now: NOW, ttlDays: 0 });
    expect(badDefault.ok).toBe(false);
    if (badDefault.ok) return;
    expect(badDefault.rejections[0].code).toBe("invalid_ttl");

    const badOverride = compactRegistryEvents("scope-ttl", { base, now: NOW, ttlDaysByClass: { NOPE: 5 } as never });
    expect(badOverride.ok).toBe(false);
    if (badOverride.ok) return;
    expect(badOverride.rejections[0].code).toBe("invalid_ttl");
    expect(badOverride.rejections[0].detail).toContain("NOPE");
  });

  it("refuses to compact a corrupt log by name and writes nothing", () => {
    const base = makeTmpBase();
    const scope = "scope-corrupt";
    seed(base, scope, attemptEvent("obj-x", OLD_TS));
    writeFileSync(eventsPath(base, scope), `${readFileSync(eventsPath(base, scope), "utf8")}{not json\n`, "utf8");
    const before = readFileSync(eventsPath(base, scope), "utf8");

    const result = compactRegistryEvents(scope, { base, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0].code).toBe("corrupt_line");
    expect(result.rejections[0].field).toBe("line[2]");
    expect(readFileSync(eventsPath(base, scope), "utf8")).toBe(before);
  });

  it("refuses to guess an event's age when its ts does not parse", () => {
    const base = makeTmpBase();
    const scope = "scope-badts";
    // ts is a min-1 string in the schema, so this appends fine; compaction
    // is the fail-closed reader that refuses to date it.
    seed(base, scope, attemptEvent("obj-ts", "not-an-instant"));
    const before = readFileSync(eventsPath(base, scope), "utf8");

    const result = compactRegistryEvents(scope, { base, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0].code).toBe("unparseable_ts");
    expect(result.rejections[0].field).toBe("line[1].ts");
    expect(readFileSync(eventsPath(base, scope), "utf8")).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Byte-cap at the append choke point (GOVDISP-002 exam, holdout O1)
// ---------------------------------------------------------------------------

describe("per-event byte cap (O1)", () => {
  const sizeSkeleton = () => ({
    schema_version: "govdisp.event.v1",
    event_id: "evt-size",
    ts: FRESH_TS,
    stable_objective_id: "obj-size",
    event_class: "ATTEMPT",
    event_type: "ATTEMPT_STARTED",
    actor_role: ""
  });

  it("accepts an event whose serialized line is exactly at the cap", () => {
    const base = makeTmpBase();
    const skeleton = sizeSkeleton();
    const pad = GOVDISP_EVENT_MAX_BYTES - lineByteLength(skeleton);
    const atCap = { ...skeleton, actor_role: "a".repeat(pad) };
    expect(lineByteLength(atCap)).toBe(GOVDISP_EVENT_MAX_BYTES);

    const result = appendRegistryEvent("scope-size", atCap, base);
    expect(result.ok).toBe(true);
  });

  it("rejects an event one byte over the cap by name (field _size, code event_too_large, size and cap in detail), writing nothing", () => {
    const base = makeTmpBase();
    const scope = "scope-size-over";
    const skeleton = sizeSkeleton();
    const pad = GOVDISP_EVENT_MAX_BYTES - lineByteLength(skeleton) + 1;
    const overCap = { ...skeleton, actor_role: "a".repeat(pad) };
    const size = lineByteLength(overCap);
    expect(size).toBe(GOVDISP_EVENT_MAX_BYTES + 1);

    const result = appendRegistryEvent(scope, overCap, base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections).toHaveLength(1);
    const rejection = result.rejections[0];
    expect(rejection.field).toBe("_size");
    expect(rejection.code).toBe(EVENT_TOO_LARGE_CODE);
    expect(rejection.code).toBe("event_too_large");
    expect(rejection.event_class).toBe("ATTEMPT");
    expect(rejection.detail).toContain(String(size));
    expect(rejection.detail).toContain(String(GOVDISP_EVENT_MAX_BYTES));

    // Fail-closed at the choke point: not even the scope directory was made.
    expect(existsSync(join(base, scope))).toBe(false);
  });

  it("rejects the GOVDISP-002 exam's O1 case: a 1 MiB actor_role payload", () => {
    const base = makeTmpBase();
    const scope = "scope-o1";
    const o1 = { ...sizeSkeleton(), actor_role: "x".repeat(1024 * 1024) };
    const size = lineByteLength(o1);

    const result = appendRegistryEvent(scope, o1, base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0].field).toBe("_size");
    expect(result.rejections[0].code).toBe("event_too_large");
    expect(result.rejections[0].detail).toContain(String(size));
    expect(result.rejections[0].detail).toContain("65536");
    expect(existsSync(join(base, scope))).toBe(false);
  });

  it("honors an injected cap override in both directions", () => {
    const base = makeTmpBase();
    const event = attemptEvent("obj-cap", FRESH_TS);
    const size = lineByteLength(event);

    const under = appendRegistryEvent("scope-cap-lo", event, base, undefined, undefined, undefined, { maxEventBytes: size - 1 });
    expect(under.ok).toBe(false);
    if (under.ok) return;
    expect(under.rejections[0].code).toBe("event_too_large");

    const over = appendRegistryEvent("scope-cap-hi", event, base, undefined, undefined, undefined, { maxEventBytes: size });
    expect(over.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// compact-registry CLI subcommand
// ---------------------------------------------------------------------------

describe("compact-registry CLI", () => {
  it("dry-run prints the JSON report and writes nothing; a real run then compacts", async () => {
    const base = makeTmpBase();
    const scope = "cli-scope";
    seed(base, scope, attemptEvent("obj-cli", OLD_TS));
    seed(base, scope, attemptEvent("obj-cli", FRESH_TS));
    const before = readFileSync(eventsPath(base, scope), "utf8");

    const outLines: string[] = [];
    const errLines: string[] = [];
    const io = { out: (line: string) => outLines.push(line), err: (line: string) => errLines.push(line) };

    const dryCode = await runCompactRegistryCli(["--scope", scope, "--base", base, "--now", NOW, "--dry-run"], io);
    expect(dryCode).toBe(0);
    expect(errLines).toEqual([]);
    const dryReport = JSON.parse(outLines.join("\n"));
    expect(dryReport.ok).toBe(true);
    expect(dryReport.dry_run).toBe(true);
    expect(dryReport.compacted).toBe(true);
    expect(dryReport.removed_count).toBe(1);
    expect(readFileSync(eventsPath(base, scope), "utf8")).toBe(before);

    outLines.length = 0;
    const realCode = await runCompactRegistryCli(["--scope", scope, "--base", base, "--now", NOW], io);
    expect(realCode).toBe(0);
    const realReport = JSON.parse(outLines.join("\n"));
    expect(realReport.compacted).toBe(true);
    expect(realReport.dry_run).toBe(false);

    const read = readRegistryEvents(scope, base);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.events).toHaveLength(2);
    expect(read.events[1].event_class).toBe("TERMINAL");
  });

  it("exits nonzero without --scope and on an unsafe scope", async () => {
    const base = makeTmpBase();
    const errLines: string[] = [];
    const io = { out: () => {}, err: (line: string) => errLines.push(line) };

    const missing = await runCompactRegistryCli([], io);
    expect(missing).toBe(1);
    expect(errLines.some((line) => line.includes("--scope"))).toBe(true);

    errLines.length = 0;
    const unsafe = await runCompactRegistryCli(["--scope", "../escape", "--base", base], io);
    expect(unsafe).toBe(1);
    expect(errLines.join("\n")).toContain("unsafe_scope");
  });

  it("exits nonzero on a refused compaction and names the refusal", async () => {
    const base = makeTmpBase();
    const scope = "cli-refused";
    seed(base, scope, attemptEvent("obj-cli-bad", "not-an-instant"));

    const errLines: string[] = [];
    const code = await runCompactRegistryCli(["--scope", scope, "--base", base, "--now", NOW], { out: () => {}, err: (line: string) => errLines.push(line) });
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("unparseable_ts");
  });
});
