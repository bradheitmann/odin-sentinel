import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendRegistryEvent,
  appendRegistryEventAsync,
  readRegistryEvents,
  REGISTRY_EVENTS_FILENAME
} from "../../src/protocol/event-registry/index.js";
import type { WakeState } from "../../src/protocol/schemas.js";
import { writeWakeFiles } from "../../src/odin-watch/writers.js";

// F-23 / F-24: files under the workspace-relative .odin/ state directories must never be written
// or read through a planted symbolic link.

const tmpRoots: string[] = [];
function makeTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const OUTSIDE_TEXT = "outside file, must stay unchanged\n";

function findingEvent() {
  return {
    schema_version: "govdisp.event.v1",
    event_id: "evt-symlink-1",
    ts: "2026-08-22T00:00:00Z",
    stable_objective_id: "obj-symlink",
    event_class: "FINDING",
    event_type: "FINDING_OPENED",
    finding_id: "finding-1"
  };
}

function plantLoggedSymlink(): { base: string; outside: string } {
  const base = makeTmp("odin-symlink-registry-");
  const outsideDir = makeTmp("odin-symlink-outside-");
  const outside = join(outsideDir, "victim.txt");
  writeFileSync(outside, OUTSIDE_TEXT);
  mkdirSync(join(base, "scope-a"), { recursive: true });
  symlinkSync(outside, join(base, "scope-a", REGISTRY_EVENTS_FILENAME));
  return { base, outside };
}

describe("F-23: the event registry refuses symbolic links", () => {
  it("appendRegistryEvent refuses a symlinked events.jsonl and leaves the outside file unchanged", () => {
    const { base, outside } = plantLoggedSymlink();
    const result = appendRegistryEvent("scope-a", findingEvent(), base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejections.map((r) => r.code)).toContain("symlink_refused");
    expect(readFileSync(outside, "utf8")).toBe(OUTSIDE_TEXT);
  });

  it("appendRegistryEventAsync refuses a symlinked events.jsonl", async () => {
    const { base, outside } = plantLoggedSymlink();
    const result = await appendRegistryEventAsync("scope-a", findingEvent(), base);
    expect(result.ok).toBe(false);
    expect(readFileSync(outside, "utf8")).toBe(OUTSIDE_TEXT);
  });

  it("appendRegistryEvent refuses a symlinked scope directory and writes nothing outside", () => {
    const base = makeTmp("odin-symlink-registry-");
    const outsideDir = makeTmp("odin-symlink-outside-");
    symlinkSync(outsideDir, join(base, "scope-b"), "dir");
    const result = appendRegistryEvent("scope-b", findingEvent(), base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejections[0]?.code).toBe("symlink_refused");
    expect(() => readFileSync(join(outsideDir, REGISTRY_EVENTS_FILENAME), "utf8")).toThrow();
  });

  it("readRegistryEvents refuses a symlinked events.jsonl", () => {
    const { base } = plantLoggedSymlink();
    const result = readRegistryEvents("scope-a", base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejections[0]?.code).toBe("symlink_refused");
  });

  it("negative control: a regular log still appends and reads", () => {
    const base = makeTmp("odin-symlink-registry-");
    expect(appendRegistryEvent("scope-c", findingEvent(), base).ok).toBe(true);
    const read = readRegistryEvents("scope-c", base);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.events).toHaveLength(1);
  });
});

function wakeState(): WakeState {
  return {
    schema_version: "1.0",
    ts: "2026-06-12T00:00:00.000Z",
    surface: "surface-1",
    pane_id: "surface-1",
    substrate: "cmux",
    state: "WORKING",
    wake: 0,
    reason_codes: ["ALL_CLEAR"],
    dirty_paths: [],
    dirty_out_of_scope: [],
    screen_hash: "deadbeef",
    screen_changed: false,
    prompt_budget_class: "silent",
    next_mandatory_audit_due: "2026-06-12T00:10:00.000Z"
  };
}

describe("F-24: writeWakeFiles refuses symbolic links", () => {
  const optOut = { env: { ODIN_GOVDISP_REGISTRY_MCP: "0" } };

  it("a symlinked qa.flag is refused and the outside file is unchanged", () => {
    const flagDir = makeTmp("odin-symlink-wake-");
    const outside = join(makeTmp("odin-symlink-outside-"), "victim.txt");
    writeFileSync(outside, OUTSIDE_TEXT);
    symlinkSync(outside, join(flagDir, "qa.flag"));
    expect(() => writeWakeFiles(flagDir, "qa", wakeState(), optOut)).toThrow(/symbolic link/);
    expect(readFileSync(outside, "utf8")).toBe(OUTSIDE_TEXT);
  });

  it("negative control: regular files are still written byte-exact", () => {
    const flagDir = makeTmp("odin-symlink-wake-");
    writeWakeFiles(flagDir, "qa", wakeState(), optOut);
    expect(readFileSync(join(flagDir, "qa.flag"), "utf8")).toBe("0");
    expect(readFileSync(join(flagDir, "qa.reason"), "utf8")).toBe("ALL_CLEAR");
    // Overwrite path: a second write truncates the existing regular file.
    writeWakeFiles(flagDir, "qa", { ...wakeState(), wake: 1, reason_codes: ["X"] }, optOut);
    expect(readFileSync(join(flagDir, "qa.flag"), "utf8")).toBe("1");
    expect(readFileSync(join(flagDir, "qa.reason"), "utf8")).toBe("X");
  });
});
