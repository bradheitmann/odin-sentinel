import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// F-20: every script's "run only when invoked directly" guard must compare real paths, so a
// script invoked through a symlinked path still runs main() instead of exiting 0 silently.
const repoRoot = realpathSync(fileURLToPath(new URL("../..", import.meta.url)));
const scriptsDir = join(repoRoot, "scripts");

const GUARDED_SCRIPTS = [
  "protocol/verify-instruction-read.mjs",
  "protocol/verify-governed-context.mjs",
  "protocol/install-activation-hooks.mjs",
  "audit/public-surface.mjs",
  "audit/verify-pack.mjs",
  "audit/dependency-audit.mjs",
  "audit/doctrine-currency.mjs",
  "audit/generate-govdisp-baseline.mjs"
];

let workDir = "";
let linkedScripts = "";

beforeAll(() => {
  workDir = realpathSync(mkdtempSync(join(tmpdir(), "odin-main-symlink-")));
  linkedScripts = join(workDir, "linked-scripts");
  symlinkSync(scriptsDir, linkedScripts, "dir");
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function runLinked(script: string, args: string[], cwd: string) {
  return spawnSync("node", [join(linkedScripts, script), ...args], { cwd, encoding: "utf8", timeout: 60_000 });
}

describe("main-module guard works through a symlinked scripts directory", () => {
  it("every guarded script uses the realpath-based isMain check", () => {
    for (const script of GUARDED_SCRIPTS) {
      const text = readFileSync(join(scriptsDir, script), "utf8");
      expect(text, script).toContain("if (isMain(import.meta.url)) {");
      expect(text, script).toContain("realpathSync(invoked) === realpathSync(fileURLToPath(metaUrl))");
      expect(text, script).not.toContain("pathToFileURL(process.argv[1])");
      expect(text, script).not.toContain("resolve(process.argv[1])");
    }
  });

  it("public-surface.mjs runs the audit when invoked through the symlink", () => {
    const result = runLinked("audit/public-surface.mjs", [], repoRoot);
    expect(result.stdout + result.stderr).toContain("Public surface audit");
  });

  it.each([
    "protocol/verify-instruction-read.mjs",
    "protocol/verify-governed-context.mjs",
    "protocol/install-activation-hooks.mjs",
    "audit/dependency-audit.mjs",
    "audit/doctrine-currency.mjs"
  ])("%s --help prints usage when invoked through the symlink", (script) => {
    const result = runLinked(script, ["--help"], repoRoot);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  it("verify-pack.mjs and generate-govdisp-baseline.mjs run main() when invoked through the symlink", () => {
    const scratch = mkdtempSync(join(workDir, "cwd-"));
    // verify-pack in an empty directory has no package to pack: main() must run and fail loudly.
    const pack = runLinked("audit/verify-pack.mjs", [], scratch);
    expect(pack.status).not.toBe(0);
    expect(pack.stderr.trim().length).toBeGreaterThan(0);
    // The generator writes its manifest relative to the cwd (a scratch directory here).
    const baseline = runLinked("audit/generate-govdisp-baseline.mjs", [], scratch);
    expect(baseline.status).toBe(0);
    expect(baseline.stdout).toContain("Wrote");
  });
});
