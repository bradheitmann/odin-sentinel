import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runLeaseCli } from "../../src/bin/index.js";

// SLICE slot-lease, CLI contract. `odin-sentinel lease <op> --dir <dir> --slot <id> ...`
// prints exactly one JSON object per call, exits 0 on success and 1 with a typed reason on
// refusal, and writes nothing outside --dir. The lease module is loaded lazily, so the MCP
// server startup path never couples to it.

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const tmpRoots: string[] = [];

function makeTmpDir(prefix = "odin-lease-cli-"): string {
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

interface CliRun {
  code: number;
  stdout: string[];
  stderr: string[];
  json: Record<string, unknown>;
}

async function leaseCli(argv: string[]): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runLeaseCli(argv, {
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line)
  });
  const text = stdout.join("\n");
  let json: Record<string, unknown> = {};
  // Exactly one JSON object per call: parse the whole stream, not a line.
  json = JSON.parse(text) as Record<string, unknown>;
  return { code, stdout, stderr, json };
}

describe("lease CLI contract", () => {
  it("acquire prints one JSON object and exits 0; a second holder is refused with a typed reason", async () => {
    const parent = makeTmpDir();
    const dir = join(parent, "leases");

    const acquired = await leaseCli(["acquire", "--dir", dir, "--slot", "job", "--holder", "runner-a", "--ttl", "60"]);
    expect(acquired.code).toBe(0);
    expect(acquired.json).toMatchObject({ ok: true, acquired: true, took_over: false });
    expect(acquired.json.record).toMatchObject({ slot: "job", holder: "runner-a", token: 1 });

    const contended = await leaseCli(["acquire", "--dir", dir, "--slot", "job", "--holder", "runner-b"]);
    expect(contended.code).toBe(1);
    expect(contended.json).toMatchObject({ ok: false, code: "slot_held" });

    // One record per slot, one lock released, nothing else in the parent.
    expect(readdirSync(dir)).toEqual(["job.lease.json"]);
    expect(readdirSync(parent)).toEqual(["leases"]);
  });

  it("status, check, renew and release speak the same JSON shape", async () => {
    const dir = join(makeTmpDir(), "leases");
    await leaseCli(["acquire", "--dir", dir, "--slot", "job", "--holder", "runner-a", "--ttl", "60"]);

    const status = await leaseCli(["status", "--dir", dir, "--slot", "job"]);
    expect(status.code).toBe(0);
    expect(status.json).toMatchObject({ ok: true, free: false, expired: false });

    const checked = await leaseCli(["check", "--dir", dir, "--slot", "job", "--holder", "runner-a", "--token", "1"]);
    expect(checked.code).toBe(0);
    expect(checked.json).toMatchObject({ ok: true, held: true });

    const staleRenew = await leaseCli(["renew", "--dir", dir, "--slot", "job", "--holder", "runner-a", "--token", "9"]);
    expect(staleRenew.code).toBe(1);
    expect(staleRenew.json).toMatchObject({ ok: false, code: "stale_token" });

    const renewed = await leaseCli(["renew", "--dir", dir, "--slot", "job", "--holder", "runner-a", "--token", "1", "--ttl", "120"]);
    expect(renewed.code).toBe(0);
    expect(renewed.json).toMatchObject({ ok: true });

    const released = await leaseCli(["release", "--dir", dir, "--slot", "job", "--holder", "runner-a", "--token", "1"]);
    expect(released.code).toBe(0);
    expect(released.json).toMatchObject({ ok: true });
    const record = released.json.record as { holder: string | null; token: number };
    expect(record.holder).toBeNull();
    expect(record.token).toBe(1); // the token is retained across release

    const afterRelease = await leaseCli(["check", "--dir", dir, "--slot", "job", "--holder", "runner-a", "--token", "1"]);
    expect(afterRelease.code).toBe(1);
    expect(afterRelease.json).toMatchObject({ ok: false, code: "lease_missing" });
  });

  it("argument faults exit non-zero with a typed reason and write nothing", async () => {
    const parent = makeTmpDir();
    const missingDir = await leaseCli(["acquire", "--slot", "job", "--holder", "runner-a"]);
    expect(missingDir.code).toBe(1);
    expect(missingDir.json).toMatchObject({ ok: false, code: "invalid_args" });

    const unknown = await leaseCli(["frobnicate", "--dir", join(parent, "leases"), "--slot", "job"]);
    expect(unknown.code).toBe(1);
    expect(unknown.json).toMatchObject({ ok: false, code: "invalid_args" });

    const badTtl = await leaseCli(["acquire", "--dir", join(parent, "leases"), "--slot", "job", "--holder", "a", "--ttl", "0"]);
    expect(badTtl.code).toBe(1);
    expect(badTtl.json).toMatchObject({ ok: false, code: "invalid_ttl" });

    const noHolder = await leaseCli(["acquire", "--dir", join(parent, "leases"), "--slot", "job"]);
    expect(noHolder.code).toBe(1);
    expect(noHolder.json).toMatchObject({ ok: false, code: "invalid_holder" });

    expect(existsSync(join(parent, "leases"))).toBe(false);
  });

  it("never writes outside --dir", async () => {
    const parent = makeTmpDir();
    const dir = join(parent, "leases");
    const cwdBefore = readdirSync(process.cwd()).sort();
    await leaseCli(["acquire", "--dir", dir, "--slot", "job", "--holder", "runner-a"]);
    await leaseCli(["status", "--dir", dir, "--slot", "job"]);
    expect(readdirSync(parent)).toEqual(["leases"]);
    expect(readdirSync(process.cwd()).sort()).toEqual(cwdBefore);
  });

  it("the real CLI entrypoint dispatches the lease subcommand and exits 0", async () => {
    const dir = join(makeTmpDir(), "leases");
    await leaseCli(["acquire", "--dir", dir, "--slot", "job", "--holder", "runner-a"]);
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", join(repoRoot, "src", "bin", "index.ts"), "lease", "status", "--dir", dir, "--slot", "job"],
      { cwd: repoRoot, timeout: 120_000 }
    );
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed).toMatchObject({ ok: true, free: false });
  });

  it("loads the lease module lazily (runtime isolation)", () => {
    const source = readFileSync(join(repoRoot, "src", "bin", "index.ts"), "utf8");
    expect(source).toMatch(/await import\(\s*["']\.\.\/protocol\/lease\/index\.js["']\s*\)/);
    expect(source).not.toMatch(/from\s+["'][^"']*protocol\/lease/);
  });
});

describe("any-of acquire and the allow-list through the CLI", () => {
  it("grants the first free slot from --slots and reports which one", async () => {
    const dir = join(makeTmpDir(), "leases");
    const granted = await leaseCli(["acquire", "--dir", dir, "--slots", "suite-1,suite-2", "--holder", "runner-a"]);
    expect(granted.code).toBe(0);
    expect(granted.json).toMatchObject({ ok: true, slot: "suite-1", acquired: true });
    const record = granted.json.record as { token: number; holder: string };
    expect(record.token).toBe(1);
    expect(record.holder).toBe("runner-a");
  });

  it("refuses with all_slots_held and lists each holder", async () => {
    const dir = join(makeTmpDir(), "leases");
    await leaseCli(["acquire", "--dir", dir, "--slots", "suite-1", "--holder", "runner-a"]);
    await leaseCli(["acquire", "--dir", dir, "--slots", "suite-2", "--holder", "runner-b"]);
    const refused = await leaseCli(["acquire", "--dir", dir, "--slots", "suite-1,suite-2", "--holder", "runner-c"]);
    expect(refused.code).toBe(1);
    expect(refused.json).toMatchObject({ ok: false, code: "all_slots_held" });
    expect(String(refused.json.detail)).toContain('suite-1 by "runner-a"');
    expect(Array.isArray(refused.json.slots)).toBe(true);
  });

  it("refuses --slot together with --slots, and --slots on another operation", async () => {
    const dir = join(makeTmpDir(), "leases");
    const both = await leaseCli([
      "acquire", "--dir", dir, "--slot", "suite-1", "--slots", "suite-1,suite-2", "--holder", "runner-a"
    ]);
    expect(both.code).toBe(1);
    expect(both.json).toMatchObject({ ok: false, code: "invalid_args" });

    const renew = await leaseCli([
      "renew", "--dir", dir, "--slots", "suite-1,suite-2", "--holder", "runner-a", "--token", "1"
    ]);
    expect(renew.code).toBe(1);
    expect(renew.json).toMatchObject({ ok: false, code: "invalid_args" });
  });

  it("refuses a typo slot through the allow-list and creates no file for it", async () => {
    const parent = makeTmpDir();
    const dir = join(parent, "leases");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "slots.allow"), "suite-1\nsuite-2\n", "utf8");

    const typo = await leaseCli(["acquire", "--dir", dir, "--slot", "suite-9", "--holder", "runner-a"]);
    expect(typo.code).toBe(1);
    expect(typo.json).toMatchObject({ ok: false, code: "slot_not_allowed" });

    const anyOfTypo = await leaseCli(["acquire", "--dir", dir, "--slots", "suite-1,suite-9", "--holder", "runner-a"]);
    expect(anyOfTypo.code).toBe(1);
    expect(anyOfTypo.json).toMatchObject({ ok: false, code: "slot_not_allowed" });

    expect(existsSync(join(dir, "suite-9.lease.json"))).toBe(false);
    expect(readdirSync(dir).sort()).toEqual(["slots.allow"]);
  });
});
