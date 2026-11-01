import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// SLICE lease-slots, proof 1 — the customer pattern, reproduced through the REAL CLI.
//
// Field case (2026-11-01): a consumer used the lease as a host-wide lock for full test suites,
// with two slots (suite-1, suite-2) shared by about nine agents. Host load fell from about 12
// (about 10 concurrent suites) to about 4.9. Agents then hand-rolled "try suite-1, else
// suite-2", repeating the same race in every caller, and one agent created a typo slot
// (`suite-9`) because any name was accepted.
//
// This file reproduces that shape: six concurrent processes per round ask for
// `--slots suite-1,suite-2`; exactly two are granted, one per slot; the rest are refused with
// all_slots_held. The CLI is spawned from SOURCE with `--import tsx`: no test here builds dist.

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const CLI_PATH = join(repoRoot, "src", "bin", "index.ts");
const TMP_ROOTS: string[] = [];

let leaseDir: string;

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  TMP_ROOTS.push(dir);
  return dir;
}

beforeEach(() => {
  leaseDir = join(makeTmpDir("odin-lease-customer-"), "leases");
  mkdirSync(leaseDir, { recursive: true });
  writeFileSync(join(leaseDir, "slots.allow"), "# host-wide suite slots\nsuite-1\nsuite-2\n", "utf8");
});

afterEach(() => {
  while (TMP_ROOTS.length > 0) {
    const dir = TMP_ROOTS.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

interface CliOutcome {
  code: number;
  json: Record<string, unknown>;
}

async function lease(...args: string[]): Promise<CliOutcome> {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", CLI_PATH, "lease", ...args],
      { cwd: repoRoot, timeout: 60_000 }
    );
    return { code: 0, json: JSON.parse(stdout) as Record<string, unknown> };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string };
    return { code: failure.code ?? 1, json: JSON.parse(failure.stdout ?? "{}") as Record<string, unknown> };
  }
}

describe("customer two-slot pattern through the real CLI", () => {
  it("grants exactly two of six concurrent callers per round, one per slot, tokens increasing", async () => {
    const rounds = 10;
    const callers = 6;
    const maxToken: Record<string, number> = { "suite-1": 0, "suite-2": 0 };

    for (let round = 0; round < rounds; round += 1) {
      const holders = Array.from({ length: callers }, (_, index) => `runner-r${round}-${index}`);
      const outcomes = await Promise.all(
        holders.map((holder) =>
          lease("acquire", "--dir", leaseDir, "--slots", "suite-1,suite-2", "--holder", holder, "--ttl", "60")
        )
      );

      const granted = outcomes.filter((outcome) => outcome.code === 0);
      const refused = outcomes.filter((outcome) => outcome.code !== 0);
      expect(granted, `round ${round}: exactly two grants`).toHaveLength(2);
      expect(refused, `round ${round}: the rest are refused`).toHaveLength(callers - 2);

      const slots = granted.map((outcome) => outcome.json.slot as string).sort();
      expect(slots, `round ${round}: one grant per slot`).toEqual(["suite-1", "suite-2"]);
      for (const outcome of refused) {
        expect(outcome.json, `round ${round}`).toMatchObject({ ok: false, code: "all_slots_held" });
      }

      // Tokens only increase per slot, by exactly one grant per round.
      for (const outcome of granted) {
        const slot = outcome.json.slot as string;
        const record = outcome.json.record as { token: number; holder: string };
        expect(record.token, `round ${round}: ${slot} token`).toBe(maxToken[slot] + 1);
        maxToken[slot] = record.token;

        // Release before the next round, with the granted holder and token.
        const released = await lease(
          "release", "--dir", leaseDir, "--slot", slot, "--holder", record.holder, "--token", String(record.token)
        );
        expect(released.code, `round ${round}: release ${slot}`).toBe(0);
      }

      // No slot file for anything outside the allow-list.
      const files = readdirSync(leaseDir).filter((name) => name.endsWith(".lease.json")).sort();
      expect(files).toEqual(["suite-1.lease.json", "suite-2.lease.json"]);
    }

    expect(maxToken["suite-1"]).toBe(rounds);
    expect(maxToken["suite-2"]).toBe(rounds);
  }, 300_000);

  it("refuses a typo slot with slot_not_allowed and creates no file for it", async () => {
    const typo = await lease(
      "acquire", "--dir", leaseDir, "--slot", "suite-9", "--holder", "runner-typo", "--ttl", "60"
    );
    expect(typo.code).toBe(1);
    expect(typo.json).toMatchObject({ ok: false, code: "slot_not_allowed" });

    const anyOfTypo = await lease(
      "acquire", "--dir", leaseDir, "--slots", "suite-1,suite-9", "--holder", "runner-typo", "--ttl", "60"
    );
    expect(anyOfTypo.code).toBe(1);
    expect(anyOfTypo.json).toMatchObject({ ok: false, code: "slot_not_allowed" });

    expect(existsSync(join(leaseDir, "suite-9.lease.json"))).toBe(false);
    expect(readdirSync(leaseDir).sort()).toEqual(["slots.allow"]);
  }, 120_000);
});
