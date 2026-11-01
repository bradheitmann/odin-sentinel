import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  acquireLease,
  checkLease,
  DEFAULT_CLOCK_SKEW_MS,
  fenceAction,
  leaseStatus,
  releaseLease,
  renewLease,
  type LeaseOptions
} from "../../src/protocol/lease/index.js";

// SLICE slot-lease. A multi-runner job needs one holder per slot, an expiry and a fencing
// token; every read-modify-write runs under ODIN's existing registry lock (the same mkdir
// lock the event registry uses, with its capped-backoff budget). These tests pin the
// one-holder race across real processes, expiry + takeover fencing, and holder-only mutation.

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const tmpRoots: string[] = [];
const CHILD_PATH = join(tmpdir(), `odin-lease-race-child-${process.pid}.mjs`);

function makeTmpDir(prefix = "odin-lease-"): string {
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

/** A clock the test moves by hand. */
function clock(startIso = "2026-11-01T00:00:00Z"): { now: () => number; advance: (ms: number) => void } {
  let current = Date.parse(startIso);
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    }
  };
}

function options(time: { now: () => number }): LeaseOptions {
  return { now: time.now, skewMs: DEFAULT_CLOCK_SKEW_MS };
}

// The race children run the compiled lease module (built once below), so a round costs one
// short node start rather than a TypeScript transform per process.
const DIST_LEASE_MODULE = join(repoRoot, "dist", "src", "protocol", "lease", "index.js");

beforeAll(async () => {
  await execFileAsync("pnpm", ["run", "build"], { cwd: repoRoot, timeout: 240_000 });
  if (!existsSync(DIST_LEASE_MODULE)) {
    throw new Error(`compiled lease module missing after build: ${DIST_LEASE_MODULE}`);
  }
  const childSource = `
import { acquireLease } from ${JSON.stringify(DIST_LEASE_MODULE)};
const [dir, slot, holder] = process.argv.slice(2);
const result = acquireLease(dir, slot, holder, 60);
process.stdout.write(JSON.stringify(result));
`;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(CHILD_PATH, childSource, "utf8");
}, 300_000);

async function raceRound(dir: string, slot: string, holders: string[]): Promise<Array<Record<string, unknown>>> {
  const runs = holders.map((holder) =>
    execFileAsync(process.execPath, [CHILD_PATH, dir, slot, holder], { timeout: 30_000 })
  );
  const settled = await Promise.all(runs);
  return settled.map((outcome) => JSON.parse(outcome.stdout) as Record<string, unknown>);
}

describe("one holder per slot under process contention", () => {
  it("4 racing processes over 20 rounds always yield exactly one holder and one token", async () => {
    const dir = makeTmpDir("odin-lease-race-");
    const holders = ["runner-a", "runner-b", "runner-c", "runner-d"];
    const rounds = 20;

    for (let round = 0; round < rounds; round += 1) {
      const slot = `job-round-${round}`;
      const results = await raceRound(dir, slot, holders);
      const winners = results.filter((result) => result.ok === true);
      const losers = results.filter((result) => result.ok === false);
      expect(winners, `round ${round}: exactly one winner`).toHaveLength(1);
      expect(losers, `round ${round}: every other process refused`).toHaveLength(holders.length - 1);
      for (const loser of losers) {
        expect(loser.code, `round ${round}`).toBe("slot_held");
      }
      const record = winners[0].record as { token: number; holder: string };
      expect(record.token, `round ${round}: a fresh slot starts at token 1`).toBe(1);
      expect(holders).toContain(record.holder);

      // The persisted record agrees, and nobody else holds the slot.
      const status = leaseStatus(dir, slot);
      expect(status.ok).toBe(true);
      if (status.ok) {
        expect(status.record.holder).toBe(record.holder);
        expect(status.record.token).toBe(1);
        expect(status.free).toBe(false);
      }
    }
  }, 300_000);
});

describe("expiry and fencing", () => {
  it("takes over an expired lease, increments the token, and voids the old holder", () => {
    const dir = makeTmpDir();
    const time = clock();
    const ttl = 60;

    const first = acquireLease(dir, "job", "runner-a", ttl, options(time));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.record.token).toBe(1);
    expect(first.acquired).toBe(true);
    const oldToken = first.record.token;

    // Not yet expired: a second runner is refused.
    const early = acquireLease(dir, "job", "runner-b", ttl, options(time));
    expect(early).toMatchObject({ ok: false, code: "slot_held" });

    // Past expiry + the documented skew allowance: takeover increments the token.
    time.advance(ttl * 1000 + DEFAULT_CLOCK_SKEW_MS + 1);
    const takeover = acquireLease(dir, "job", "runner-b", ttl, options(time));
    expect(takeover.ok).toBe(true);
    if (!takeover.ok) return;
    expect(takeover.took_over).toBe(true);
    expect(takeover.record.token).toBe(oldToken + 1);
    expect(takeover.record.holder).toBe("runner-b");

    // The old holder's operations all fail with typed reasons.
    const oldCheck = checkLease(dir, "job", "runner-a", oldToken, options(time));
    expect(oldCheck).toMatchObject({ ok: false, code: "not_holder" });
    const oldRenew = renewLease(dir, "job", "runner-a", oldToken, ttl, options(time));
    expect(oldRenew).toMatchObject({ ok: false, code: "not_holder" });
    const oldRelease = releaseLease(dir, "job", "runner-a", oldToken, options(time));
    expect(oldRelease).toMatchObject({ ok: false, code: "not_holder" });

    // And an action stamped with the old token is void against the new one.
    const fenced = fenceAction(dir, "job", oldToken);
    expect(fenced).toMatchObject({ ok: true, valid: false, reason: "superseded", current_token: oldToken + 1 });
    const current = fenceAction(dir, "job", oldToken + 1);
    expect(current).toMatchObject({ ok: true, valid: true, reason: "current" });

    // The new holder is valid until its own expiry.
    const newCheck = checkLease(dir, "job", "runner-b", oldToken + 1, options(time));
    expect(newCheck).toMatchObject({ ok: true, held: true });
  });

  it("an expired lease cannot be renewed by its own holder", () => {
    const dir = makeTmpDir();
    const time = clock();
    const acquired = acquireLease(dir, "job", "runner-a", 10, options(time));
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    time.advance(10_000 + DEFAULT_CLOCK_SKEW_MS + 1);
    const renewed = renewLease(dir, "job", "runner-a", acquired.record.token, 10, options(time));
    expect(renewed).toMatchObject({ ok: false, code: "lease_expired" });
    const checked = checkLease(dir, "job", "runner-a", acquired.record.token, options(time));
    expect(checked).toMatchObject({ ok: false, code: "lease_expired" });
  });

  it("an expired lease may still be released by its holder, retaining the token", () => {
    const dir = makeTmpDir();
    const time = clock();
    const acquired = acquireLease(dir, "job", "runner-a", 10, options(time));
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    time.advance(10_000 + DEFAULT_CLOCK_SKEW_MS + 1);
    const released = releaseLease(dir, "job", "runner-a", acquired.record.token, options(time));
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.record.holder).toBeNull();
    expect(released.record.token).toBe(acquired.record.token);
    // The next acquire continues the sequence rather than restarting it.
    const next = acquireLease(dir, "job", "runner-b", 10, options(time));
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.record.token).toBe(acquired.record.token + 1);
  });
});

describe("holder-only mutation", () => {
  it("refuses renew and release from another holder and changes nothing", () => {
    const dir = makeTmpDir();
    const time = clock();
    const acquired = acquireLease(dir, "job", "runner-a", 60, options(time));
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    const before = JSON.stringify(acquired.record);

    expect(renewLease(dir, "job", "runner-b", acquired.record.token, 60, options(time))).toMatchObject({
      ok: false,
      code: "not_holder"
    });
    expect(releaseLease(dir, "job", "runner-b", acquired.record.token, options(time))).toMatchObject({
      ok: false,
      code: "not_holder"
    });

    const status = leaseStatus(dir, "job", options(time));
    expect(status.ok).toBe(true);
    if (status.ok) expect(JSON.stringify(status.record)).toBe(before);
  });

  it("refuses a stale token from the right holder and changes nothing", () => {
    const dir = makeTmpDir();
    const time = clock();
    const acquired = acquireLease(dir, "job", "runner-a", 60, options(time));
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    const before = JSON.stringify(acquired.record);
    const stale = acquired.record.token + 7;

    expect(renewLease(dir, "job", "runner-a", stale, 60, options(time))).toMatchObject({ ok: false, code: "stale_token" });
    expect(releaseLease(dir, "job", "runner-a", stale, options(time))).toMatchObject({ ok: false, code: "stale_token" });
    expect(checkLease(dir, "job", "runner-a", stale, options(time))).toMatchObject({ ok: false, code: "stale_token" });

    const status = leaseStatus(dir, "job", options(time));
    if (status.ok) expect(JSON.stringify(status.record)).toBe(before);
  });

  it("renew extends the expiry for the current holder and token", () => {
    const dir = makeTmpDir();
    const time = clock();
    const acquired = acquireLease(dir, "job", "runner-a", 30, options(time));
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    time.advance(20_000);
    const renewed = renewLease(dir, "job", "runner-a", acquired.record.token, 60, options(time));
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(Date.parse(renewed.record.expires_at ?? "")).toBe(time.now() + 60_000);
    expect(renewed.record.token).toBe(acquired.record.token);
  });
});

describe("lease storage shape", () => {
  it("keeps one record per slot under the lease dir and no lock directory after the operation", () => {
    const dir = makeTmpDir();
    const time = clock();
    expect(acquireLease(dir, "job", "runner-a", 60, options(time)).ok).toBe(true);
    const files = readdirSync(dir).sort();
    expect(files).toEqual(["job.lease.json"]);
  });

  it("reports an unknown slot as free and missing, not as an error", () => {
    const dir = makeTmpDir();
    const status = leaseStatus(dir, "never-used");
    expect(status).toMatchObject({ ok: true, free: true, expired: false });
    const check = checkLease(dir, "never-used", "runner-a", 1);
    expect(check).toMatchObject({ ok: false, code: "lease_missing" });
  });

  it("refuses an unsafe slot id", () => {
    const dir = makeTmpDir();
    expect(acquireLease(dir, "../escape", "runner-a", 60)).toMatchObject({ ok: false, code: "invalid_slot" });
    expect(acquireLease(dir, "job", "  ", 60)).toMatchObject({ ok: false, code: "invalid_holder" });
    expect(acquireLease(dir, "job", "runner-a", 0)).toMatchObject({ ok: false, code: "invalid_ttl" });
  });
});
