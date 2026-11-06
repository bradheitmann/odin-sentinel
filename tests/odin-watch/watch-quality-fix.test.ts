import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassifierInput } from "../../src/odin-watch/classifier.js";
import { classify } from "../../src/odin-watch/classifier.js";

const repoRoot = realpathSync(fileURLToPath(new URL("../..", import.meta.url)));

function baseInput(overrides: Partial<ClassifierInput> = {}): ClassifierInput {
  return {
    text: "",
    hash: "hash-a",
    prev_hash: null,
    elapsed_ms: 0,
    now_ms: 1_750_000_000_000,
    mandatory_audit_interval_ms: 600_000,
    stale_threshold_ms: 360_000,
    write_scope: [],
    dirty_paths: [],
    last_verdict: null,
    last_mandatory_audit_ts: null,
    ...overrides,
  };
}

describe("F-25: write-scope matching is path-segment aware", () => {
  it("a sibling prefix (src/allowed-evil) is out of scope for scope src/allowed", () => {
    const result = classify(
      baseInput({
        write_scope: ["src/allowed"],
        dirty_paths: ["src/allowed/ok.ts", "src/allowed", "src/allowed-evil/x.ts", "src/other.ts"],
      })
    );
    expect(result.dirty_out_of_scope).toEqual(["src/allowed-evil/x.ts", "src/other.ts"]);
  });

  it("a trailing slash on the scope still covers paths under it and nothing beside it", () => {
    const result = classify(
      baseInput({
        write_scope: ["src/allowed/"],
        dirty_paths: ["src/allowed/ok.ts", "src/allowed-evil/x.ts"],
      })
    );
    expect(result.dirty_out_of_scope).toEqual(["src/allowed-evil/x.ts"]);
  });
});

describe("F-27: a failed git diff is reported, not read as 'no dirty paths'", () => {
  afterEach(() => {
    vi.doUnmock("../../src/utils/execFileNoThrow.js");
    vi.resetModules();
  });

  async function loadIndexWith(result: { status: number; stdout: string; stderr: string }) {
    vi.resetModules();
    vi.doMock("../../src/utils/execFileNoThrow.js", () => ({
      execFileNoThrow: vi.fn().mockResolvedValue(result),
    }));
    return import("../../src/odin-watch/index.js");
  }

  it("getDirtyPaths throws when git diff exits non-zero", async () => {
    const { getDirtyPaths } = await loadIndexWith({ status: 128, stdout: "", stderr: "fatal: not a git repository" });
    await expect(getDirtyPaths()).rejects.toThrow(/git diff failed \(exit 128\)/);
  });

  it("getDirtyPaths still returns the listed paths on success", async () => {
    const { getDirtyPaths } = await loadIndexWith({ status: 0, stdout: "a.ts\n b.ts \n\n", stderr: "" });
    await expect(getDirtyPaths()).resolves.toEqual(["a.ts", "b.ts"]);
  });

  it("the cmux and tmux backends share one capture implementation", async () => {
    const { CmuxBackend } = await import("../../src/odin-watch/backends/cmux.js");
    const { TmuxBackend } = await import("../../src/odin-watch/backends/tmux.js");
    const { CommandCaptureBackend } = await import("../../src/odin-watch/backends/command-backend.js");
    expect(new CmuxBackend("unused")).toBeInstanceOf(CommandCaptureBackend);
    expect(new TmuxBackend("unused")).toBeInstanceOf(CommandCaptureBackend);
  });
});

describe("F-28: the odin-watch CLI binds the filesystem registry store", () => {
  const tmpRoots: string[] = [];
  afterEach(() => {
    while (tmpRoots.length > 0) {
      const dir = tmpRoots.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("one CLI poll appends FINDING_OPENED with no 'emission refused' (flag unset)", async () => {
    const work = realpathSync(mkdtempSync(join(tmpdir(), "odin-watch-cli-")));
    tmpRoots.push(work);
    // A git work tree, so the poll's git diff succeeds.
    expect(spawnSync("git", ["init", "-q"], { cwd: work }).status).toBe(0);
    // A stub cmux on PATH that prints a screen and exits 0.
    const binDir = join(work, "bin");
    mkdirSync(binDir);
    const stub = join(binDir, "cmux");
    writeFileSync(stub, "#!/bin/sh\necho 'stub screen'\n");
    chmodSync(stub, 0o755);

    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}` };
    delete env.ODIN_GOVDISP_REGISTRY_MCP;

    const child = spawn(
      join(repoRoot, "node_modules", ".bin", "tsx"),
      [
        join(repoRoot, "src", "odin-watch", "index.ts"),
        "--surface", "surface-1",
        "--substrate", "cmux",
        "--label", "qa",
        "--interval", "60",
        "--flag-dir", join(work, "wake"),
        "--archive-dir", join(work, "archive"),
      ],
      { cwd: work, env, stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const registryLog = join(work, ".odin", "registry", "odin-watch", "events.jsonl");
    try {
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline && !/verdict=|poll error|refused|fatal/.test(stderr)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      child.kill("SIGTERM");
    }

    expect(stderr).not.toContain("emission refused");
    expect(stderr).not.toContain("poll error");
    expect(existsSync(registryLog)).toBe(true);
    const lines = readFileSync(registryLog, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ event_class: "FINDING", event_type: "FINDING_OPENED" });
  }, 40_000);
});
