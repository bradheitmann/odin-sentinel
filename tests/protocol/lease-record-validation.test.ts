import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireLease, readLease } from "../../src/protocol/lease/index.js";
import { LEASE_FILE_SUFFIX, LEASE_SCHEMA_VERSION } from "../../src/protocol/lease/store.js";

// quality-fix-1 F-29: a held lease with an unparseable or null expiry is corrupt. It must be
// reported as lease_corrupt, never taken over at once (garbage) nor held forever (null).

const tmpRoots: string[] = [];
afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function dirWithRecord(record: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-lease-record-"));
  tmpRoots.push(dir);
  writeFileSync(
    join(dir, `s${LEASE_FILE_SUFFIX}`),
    `${JSON.stringify({ schema_version: LEASE_SCHEMA_VERSION, slot: "s", token: 1, ...record }, null, 2)}\n`
  );
  return dir;
}

describe("lease record validation", () => {
  it.each([
    ["garbage expires_at", { holder: "a", acquired_at: "2026-11-01T00:00:00.000Z", expires_at: "garbage" }],
    ["null expires_at on a held slot", { holder: "a", acquired_at: "2026-11-01T00:00:00.000Z", expires_at: null }],
    ["null acquired_at on a held slot", { holder: "a", acquired_at: null, expires_at: "2099-01-01T00:00:00.000Z" }],
    ["timestamps with no holder", { holder: null, acquired_at: "2026-11-01T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z" }]
  ])("%s is lease_corrupt for acquire and read", (_label, record) => {
    const dir = dirWithRecord(record);
    const acquired = acquireLease(dir, "s", "b", 60);
    expect(acquired.ok).toBe(false);
    if (!acquired.ok) expect(acquired.code).toBe("lease_corrupt");
    const read = readLease(dir, "s");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe("lease_corrupt");
  });

  it("negative control: a free record and a well-formed held record still load", () => {
    const free = dirWithRecord({ holder: null, acquired_at: null, expires_at: null });
    expect(readLease(free, "s").ok).toBe(true);
    expect(acquireLease(free, "s", "b", 60).ok).toBe(true);

    const held = dirWithRecord({ holder: "a", acquired_at: "2026-11-01T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z" });
    const read = readLease(held, "s");
    expect(read.ok).toBe(true);
    const contested = acquireLease(held, "s", "b", 60);
    expect(contested.ok).toBe(false);
    if (!contested.ok) expect(contested.code).toBe("slot_held");
  });
});
