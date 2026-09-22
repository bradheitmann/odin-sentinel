import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Every test in this file drives the REAL shipped fleet script against scratch
 * directories created with mkdtempSync. HOME, SCP_SKILL_TARGETS_FILE and
 * SCP_ADAPTER_TARGETS_FILE are always overridden, and the master is a scratch
 * copy except where the default structural master resolution is itself under
 * test (and then only in a mode that writes nothing). No test may touch a real
 * installation path.
 */
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT_PATH = join(REPO_ROOT, "plugins/odin-scp/skills/odin-scp/scripts/sync-installations.sh");
const REPO_MASTER_DIR = join(REPO_ROOT, "plugins/odin-scp/skills/odin-scp");

const ADAPTER_HEADER =
  "<!-- GENERATED FILE: odin-scp adapter derived from the canonical SKILL.md. Do not hand-edit; re-run sync-installations.sh. -->";

const scratchDirs: string[] = [];

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

function scratchRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-sync-fleet-"));
  scratchDirs.push(dir);
  return dir;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function expectedAdapterBytes(masterDir: string): string {
  return `${ADAPTER_HEADER}\n\n${readFileSync(join(masterDir, "SKILL.md"), "utf8")}`;
}

/** Recursive listing plus per-file hashes, used to prove a run wrote nothing. */
function snapshot(dir: string): string[] {
  const lines: string[] = [];
  const walk = (current: string, rel: string) => {
    for (const entry of readdirSync(current).sort()) {
      const abs = join(current, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      if (statSync(abs).isDirectory()) {
        lines.push(`dir  ${relPath}`);
        walk(abs, relPath);
      } else {
        lines.push(`file ${relPath} ${sha256File(abs)}`);
      }
    }
  };
  walk(dir, "");
  return lines;
}

interface Fleet {
  root: string;
  home: string;
  master: string;
  fleetRoot: string;
  targets: string[];
  adapters: string[];
  env: Record<string, string>;
}

function makeFleet(targetNames: string[] = ["alpha", "beta"], adapterNames: string[] = ["one.md", "two.md"]): Fleet {
  const root = scratchRoot();
  const home = join(root, "home");
  const master = join(root, "master");
  const fleetRoot = join(root, "fleet");
  mkdirSync(home, { recursive: true });
  mkdirSync(fleetRoot, { recursive: true });
  cpSync(REPO_MASTER_DIR, master, { recursive: true });

  const targets = targetNames.map((name) => join(fleetRoot, "targets", name));
  const adapters = adapterNames.map((name) => join(fleetRoot, "adapters", name));
  const targetsFile = join(root, "targets.txt");
  const adaptersFile = join(root, "adapters.txt");
  writeFileSync(targetsFile, `${targets.join("\n")}\n`);
  writeFileSync(adaptersFile, `${adapters.join("\n")}\n`);

  return {
    root,
    home,
    master,
    fleetRoot,
    targets,
    adapters,
    env: {
      HOME: home,
      SCP_SKILL_MASTER: master,
      SCP_SKILL_TARGETS_FILE: targetsFile,
      SCP_ADAPTER_TARGETS_FILE: adaptersFile
    }
  };
}

function runScript(args: string[], env: Record<string, string>) {
  // Strip every ambient SCP_* variable first: the overrides passed in are the
  // ONLY fleet configuration a run may see, so no operator environment can
  // redirect a test at a real installation path.
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("SCP_"))
  ) as Record<string, string>;

  return spawnSync("bash", [SCRIPT_PATH, ...args], {
    encoding: "utf8",
    env: { ...baseEnv, ...env }
  });
}

// ---------------------------------------------------------------------------
// POSITIVE CONTROL FIRST: the shipped fleet script on a healthy scratch fleet.
// ---------------------------------------------------------------------------

describe("sync-installations positive control (scratch fleet)", () => {
  it("syncs every native target and generates every adapter in write mode", () => {
    const fleet = makeFleet();
    const result = runScript([], fleet.env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SCP skill sync verified");

    const masterHash = sha256File(join(fleet.master, "SKILL.md"));
    for (const target of fleet.targets) {
      expect(sha256File(join(target, "SKILL.md"))).toBe(masterHash);
    }
    for (const adapter of fleet.adapters) {
      expect(readFileSync(adapter, "utf8")).toBe(expectedAdapterBytes(fleet.master));
    }
  });

  it("verifies a freshly synced scratch fleet with a zero exit", () => {
    const fleet = makeFleet();
    expect(runScript([], fleet.env).status).toBe(0);

    const verify = runScript(["--verify-only"], fleet.env);
    expect(verify.status).toBe(0);
    expect(verify.stdout).toContain("SCP skill sync verified");
    expect(verify.stdout).not.toContain("ABSENT");
    expect(verify.stdout).not.toContain("DRIFTED");
  });
});

// ---------------------------------------------------------------------------
// Functional 16 - fleet shape preserved.
// ---------------------------------------------------------------------------

describe("fleet shape and argument handling", () => {
  const scriptSource = readFileSync(SCRIPT_PATH, "utf8");

  function declaredArray(name: string): string[] {
    const block = scriptSource.match(new RegExp(`^${name}=\\(\\n([\\s\\S]*?)^\\)$`, "m"));
    expect(block).not.toBeNull();
    return (block as RegExpMatchArray)[1]
      .split("\n")
      .map((line) => line.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }

  it("declares the 13 native targets in unchanged identity and order", () => {
    expect(declaredArray("TARGETS")).toEqual([
      "${HOME}/.agents/skills/odin-scp",
      "${HOME}/.codex/skills/odin-scp",
      "${HOME}/.claude/skills/odin-scp",
      "${HOME}/.config/goose/skills/odin-scp",
      "${HOME}/.config/opencode/skills/odin-scp",
      "${HOME}/.opencode/skills/odin-scp",
      "${HOME}/.crush/skills/odin-scp",
      "${HOME}/.cursor/skills/odin-scp",
      "${HOME}/.cursor/skills-cursor/odin-scp",
      "${HOME}/.kilocode/skills/odin-scp",
      "${HOME}/.openhands/skills/odin-scp",
      "${HOME}/.pi/agent/skills/odin-scp",
      "${HOME}/.zed/skills/odin-scp"
    ]);
  });

  it("declares the 3 adapter targets in unchanged identity and order", () => {
    expect(declaredArray("ADAPTERS")).toEqual([
      "${HOME}/.config/droid/prompts/odin-scp.md",
      "${HOME}/.droid/prompts/odin-scp.md",
      "${HOME}/.crush/commands/odin-scp.md"
    ]);
  });

  it("reports the default fleet counts and the structural master link without writing", () => {
    const root = scratchRoot();
    const home = join(root, "home");
    mkdirSync(home, { recursive: true });

    // The full 13 + 3 default fleet, rebased from ${HOME} onto the scratch home,
    // so the emitted counts are the shipped counts while every path stays inside
    // mkdtemp. SCP_SKILL_MASTER is deliberately NOT set: the default structural
    // master resolution is what this test exercises, and --verify-only writes
    // nothing anywhere.
    const targets = declaredArray("TARGETS").map((path) => path.replace("${HOME}", home));
    const adapters = declaredArray("ADAPTERS").map((path) => path.replace("${HOME}", home));
    expect(targets).toHaveLength(13);
    expect(adapters).toHaveLength(3);
    for (const path of [...targets, ...adapters]) expect(path.startsWith(`${home}/`)).toBe(true);

    const targetsFile = join(root, "targets.txt");
    const adaptersFile = join(root, "adapters.txt");
    writeFileSync(targetsFile, `${targets.join("\n")}\n`);
    writeFileSync(adaptersFile, `${adapters.join("\n")}\n`);

    const result = runScript(["--verify-only"], {
      HOME: home,
      SCP_SKILL_TARGETS_FILE: targetsFile,
      SCP_ADAPTER_TARGETS_FILE: adaptersFile
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("native_targets: 13");
    expect(result.stdout).toContain("adapter_targets: 3");
    expect(result.stdout).toContain(`master: ${realpathSync(REPO_MASTER_DIR)}`);
    expect(result.stdout).toContain(`skill_sha256: ${sha256File(join(REPO_MASTER_DIR, "SKILL.md"))}`);
    expect(result.stdout).toContain(`ABSENT native target: ${join(targets[0], "SKILL.md")}`);
    expect(result.stdout).toContain(`ABSENT adapter: ${adapters[0]}`);
    expect(result.stdout).not.toContain("SCP skill sync verified");
    expect(readdirSync(home)).toEqual([]);
  });

  it("refuses mutually exclusive modes, unknown arguments, and prints help", () => {
    const fleet = makeFleet();
    expect(runScript(["--verify-only", "--dry-run"], fleet.env).status).toBe(2);
    expect(runScript(["--nope"], fleet.env).status).toBe(2);

    const help = runScript(["-h"], fleet.env);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: sync-installations.sh");
  });

  it("still writes the emitted report", () => {
    const fleet = makeFleet();
    const reportPath = join(fleet.root, "reports", "sync.txt");
    const result = runScript(["--emit-report", reportPath], fleet.env);

    expect(result.status).toBe(0);
    expect(readFileSync(reportPath, "utf8")).toContain("native_targets: 2");
    expect(result.stdout).toContain(`report: ${reportPath}`);
  });
});

// ---------------------------------------------------------------------------
// Functional 11 - deterministic adapter generation.
// ---------------------------------------------------------------------------

describe("deterministic adapter generation", () => {
  it("produces byte-identical adapters across two consecutive generations", () => {
    const first = makeFleet();
    expect(runScript([], first.env).status).toBe(0);
    const firstHashes = first.adapters.map((adapter) => sha256File(adapter));

    const second = makeFleet();
    cpSync(join(first.master, "SKILL.md"), join(second.master, "SKILL.md"));
    expect(runScript([], second.env).status).toBe(0);
    const secondHashes = second.adapters.map((adapter) => sha256File(adapter));

    expect(secondHashes).toEqual(firstHashes);
    expect(new Set(firstHashes).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Functional 12 - exact content verification replaces marker presence.
// ---------------------------------------------------------------------------

describe("exact content verification", () => {
  it("fails a native target that kept every marker but drifted by one line", () => {
    const fleet = makeFleet();
    expect(runScript([], fleet.env).status).toBe(0);

    const drifted = join(fleet.targets[0], "SKILL.md");
    writeFileSync(drifted, `${readFileSync(drifted, "utf8")}\nlocally appended drift\n`);

    const result = runScript(["--verify-only"], fleet.env);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(`DRIFTED native target: ${drifted}`);
    expect(result.stdout).not.toContain("SCP skill sync verified");
  });

  it("fails an adapter that kept every marker but drifted by one line", () => {
    const fleet = makeFleet();
    expect(runScript([], fleet.env).status).toBe(0);

    const adapter = fleet.adapters[0];
    writeFileSync(adapter, `${readFileSync(adapter, "utf8")}\nlocally appended drift\n`);

    const result = runScript(["--verify-only"], fleet.env);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(`DRIFTED adapter: ${adapter}`);
    expect(result.stdout).not.toContain("SCP skill sync verified");
  });
});

// ---------------------------------------------------------------------------
// Functional 13 - ABSENT is reported honestly and is never a PASS.
// ---------------------------------------------------------------------------

describe("absent installations", () => {
  it("names every absent target and adapter, classifies them apart from drift, and creates nothing", () => {
    const fleet = makeFleet(["present", "drifted", "absent"], ["present.md", "absent.md"]);
    expect(runScript([], fleet.env).status).toBe(0);

    const driftedSkill = join(fleet.targets[1], "SKILL.md");
    writeFileSync(driftedSkill, `${readFileSync(driftedSkill, "utf8")}\ndrift\n`);
    rmSync(fleet.targets[2], { recursive: true, force: true });
    rmSync(fleet.adapters[1], { force: true });

    const before = snapshot(fleet.fleetRoot);
    const result = runScript(["--verify-only"], fleet.env);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(`ABSENT native target: ${join(fleet.targets[2], "SKILL.md")}`);
    expect(result.stdout).toContain(`ABSENT adapter: ${fleet.adapters[1]}`);
    expect(result.stdout).toContain(`DRIFTED native target: ${driftedSkill}`);
    expect(result.stdout).not.toContain("SCP skill sync verified");

    // An absent installation is never counted as verified.
    expect(result.stdout).toContain("native_verified: 1");
    expect(result.stdout).toContain("native_absent: 1");
    expect(result.stdout).toContain("native_drifted: 1");
    expect(result.stdout).toContain("adapter_verified: 1");
    expect(result.stdout).toContain("adapter_absent: 1");

    expect(snapshot(fleet.fleetRoot)).toEqual(before);
  });

  it("still reports the full native target picture when an adapter is missing", () => {
    const fleet = makeFleet(["present"], ["absent.md"]);
    expect(runScript([], fleet.env).status).toBe(0);
    rmSync(fleet.adapters[0], { force: true });

    const result = runScript(["--verify-only"], fleet.env);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("native_targets: 1");
    expect(result.stdout).toContain("native_verified: 1");
    expect(result.stdout).toContain(`ABSENT adapter: ${fleet.adapters[0]}`);
  });
});

// ---------------------------------------------------------------------------
// Functional 14 - --dry-run writes nothing.
// ---------------------------------------------------------------------------

describe("dry run", () => {
  it("creates no directory and no file and modifies no byte", () => {
    const fleet = makeFleet();
    const before = snapshot(fleet.fleetRoot);
    expect(before).toEqual([]);

    const result = runScript(["--dry-run"], fleet.env);

    expect(snapshot(fleet.fleetRoot)).toEqual(before);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SCP skill sync verified");
    expect(result.stdout).toContain(`ABSENT native target: ${join(fleet.targets[0], "SKILL.md")}`);
  });

  it("leaves an already synced fleet byte-identical and exits zero when nothing drifted", () => {
    const fleet = makeFleet();
    expect(runScript([], fleet.env).status).toBe(0);

    const before = snapshot(fleet.fleetRoot);
    const result = runScript(["--dry-run"], fleet.env);

    expect(snapshot(fleet.fleetRoot)).toEqual(before);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("mode: dry-run");
  });
});

// ---------------------------------------------------------------------------
// Functional 15 - write mode never modifies the master.
// ---------------------------------------------------------------------------

describe("master safety", () => {
  it("skips a target that resolves to master and leaves the master tree byte-identical", () => {
    const fleet = makeFleet(["alpha"], ["one.md"]);
    writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[0]}\n${fleet.master}\n`);

    const masterBefore = snapshot(fleet.master);
    const result = runScript([], fleet.env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`skipping target that resolves to master (nothing ever writes back into master): ${fleet.master}`);
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(sha256File(join(fleet.targets[0], "SKILL.md"))).toBe(sha256File(join(fleet.master, "SKILL.md")));
  });

  it("leaves the master tree byte-identical after an ordinary write-mode sync", () => {
    const fleet = makeFleet();
    const masterBefore = snapshot(fleet.master);
    expect(runScript([], fleet.env).status).toBe(0);
    expect(snapshot(fleet.master)).toEqual(masterBefore);
  });

  // Physical-overlap guard (STORY-SYNCGUARD-001): the skip must follow the
  // PHYSICAL location a write would land on, not compare path strings. The
  // pre-fix failure mode for a symlinked adapter is unbounded self-append
  // growth of master SKILL.md by a `cat` child, which a spawn timeout alone
  // would not stop, so each case caps file size for the script and every child
  // it spawns (ulimit -f, 1024-byte units: 20 MiB) and also carries a timeout.
  const runBounded = (args: string[], env: Record<string, string>) => {
    const baseEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("SCP_"))
    ) as Record<string, string>;
    return spawnSync("bash", ["-c", 'ulimit -f 20480 && exec bash "$0" "$@"', SCRIPT_PATH, ...args], {
      encoding: "utf8",
      env: { ...baseEnv, ...env },
      timeout: 20_000
    });
  };

  it("skips an adapter symlinked to master SKILL.md and leaves master byte-identical", () => {
    const fleet = makeFleet(["alpha"], ["one.md", "linked.md"]);
    mkdirSync(dirname(fleet.adapters[1]), { recursive: true });
    symlinkSync(join(fleet.master, "SKILL.md"), fleet.adapters[1]);

    const masterBefore = snapshot(fleet.master);
    const result = runBounded([], fleet.env);

    expect(result.error).toBeUndefined();
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(result.stdout).toContain(`skipping adapter that resolves into master (nothing ever writes back into master): ${fleet.adapters[1]}`);
    expect(result.stdout).toContain(`DRIFTED adapter: ${fleet.adapters[1]}`);
    expect(result.stdout).toContain("adapter_verified: 1");
    expect(readFileSync(fleet.adapters[0], "utf8")).toBe(expectedAdapterBytes(fleet.master));
  });

  it("skips an adapter whose dangling symlink points at a new file inside master", () => {
    const fleet = makeFleet(["alpha"], ["dangling.md"]);
    mkdirSync(dirname(fleet.adapters[0]), { recursive: true });
    symlinkSync(join(fleet.master, "not-yet-there", "odin-scp.md"), fleet.adapters[0]);

    const masterBefore = snapshot(fleet.master);
    const result = runBounded([], fleet.env);

    expect(result.error).toBeUndefined();
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(result.stdout).toContain(`skipping adapter that resolves into master (nothing ever writes back into master): ${fleet.adapters[0]}`);
  });

  it("skips native targets that are a symlink to master, inside master, or an ancestor of master", () => {
    const fleet = makeFleet(["alpha", "linked"], ["one.md"]);
    mkdirSync(dirname(fleet.targets[1]), { recursive: true });
    symlinkSync(fleet.master, fleet.targets[1]);
    const inside = join(fleet.master, "references", "nested-target");
    const ancestor = fleet.root;
    writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[0]}\n${fleet.targets[1]}\n${inside}\n${ancestor}\n`);

    const masterBefore = snapshot(fleet.master);
    const rootListingBefore = readdirSync(fleet.root).sort();
    const result = runBounded([], fleet.env);

    expect(result.error).toBeUndefined();
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(readdirSync(fleet.root).sort()).toEqual(rootListingBefore);
    for (const skipped of [fleet.targets[1], inside, ancestor]) {
      expect(result.stdout).toContain(`skipping target that resolves to master (nothing ever writes back into master): ${skipped}`);
    }
    expect(sha256File(join(fleet.targets[0], "SKILL.md"))).toBe(sha256File(join(fleet.master, "SKILL.md")));
  });

  it("reports every overlapping target and adapter as a skip in dry-run and writes nothing", () => {
    const fleet = makeFleet(["alpha"], ["linked.md"]);
    mkdirSync(dirname(fleet.adapters[0]), { recursive: true });
    symlinkSync(join(fleet.master, "SKILL.md"), fleet.adapters[0]);
    const inside = join(fleet.master, "references", "nested-target");
    writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[0]}\n${inside}\n`);

    const masterBefore = snapshot(fleet.master);
    const result = runBounded(["--dry-run"], fleet.env);

    expect(result.error).toBeUndefined();
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(result.stdout).toContain(`DRY-RUN would skip target that resolves to master: ${inside}`);
    expect(result.stdout).toContain(`DRY-RUN would skip adapter that resolves into master: ${fleet.adapters[0]}`);
    expect(result.stdout).toContain(`DRY-RUN would sync native target: ${fleet.targets[0]}`);
  });

  it("resolves link/.. by the filesystem, not lexically, for adapters and native targets", () => {
    const fleet = makeFleet(["alpha", "dotdot"], ["one.md", "dotdot.md"]);
    const adapterDir = dirname(fleet.adapters[1]);
    mkdirSync(adapterDir, { recursive: true });
    // `s` points INTO master/references, so `s/../SKILL.md` is master/SKILL.md on
    // disk while a lexical reading would place it in the adapter directory.
    symlinkSync(join(fleet.master, "references"), join(adapterDir, "s"));
    symlinkSync("s/../SKILL.md", fleet.adapters[1]);
    const targetDir = dirname(fleet.targets[1]);
    mkdirSync(join(targetDir, "scripts"), { recursive: true });
    symlinkSync(join(fleet.master, "references"), join(targetDir, "t"));
    symlinkSync("t/../scripts", fleet.targets[1]);

    const masterBefore = snapshot(fleet.master);
    const result = runBounded([], fleet.env);

    expect(result.error).toBeUndefined();
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(result.stdout).toContain(`skipping adapter that resolves into master (nothing ever writes back into master): ${fleet.adapters[1]}`);
    expect(result.stdout).toContain(`skipping target that resolves to master (nothing ever writes back into master): ${fleet.targets[1]}`);
  });

  it("skips a dangling native target link written with a trailing slash", () => {
    const fleet = makeFleet(["alpha", "dangling"], ["one.md"]);
    mkdirSync(dirname(fleet.targets[1]), { recursive: true });
    symlinkSync(join(fleet.master, "new-dir"), fleet.targets[1]);
    writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[1]}/\n${fleet.targets[0]}\n`);

    const masterBefore = snapshot(fleet.master);
    const dry = runBounded(["--dry-run"], fleet.env);
    expect(dry.stdout).toContain(`DRY-RUN would skip target that resolves to master: ${fleet.targets[1]}/`);

    const result = runBounded([], fleet.env);
    expect(result.error).toBeUndefined();
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(result.stdout).toContain(`skipping target that resolves to master (nothing ever writes back into master): ${fleet.targets[1]}/`);
    expect(sha256File(join(fleet.targets[0], "SKILL.md"))).toBe(sha256File(join(fleet.master, "SKILL.md")));
  });

  it("skips an adapter hard-linked to a master file", () => {
    const fleet = makeFleet(["alpha"], ["hardlinked.md"]);
    mkdirSync(dirname(fleet.adapters[0]), { recursive: true });
    linkSync(join(fleet.master, "SKILL.md"), fleet.adapters[0]);

    const masterBefore = snapshot(fleet.master);
    const result = runBounded([], fleet.env);

    expect(result.error).toBeUndefined();
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(result.stdout).toContain(`skipping adapter that resolves into master (nothing ever writes back into master): ${fleet.adapters[0]}`);
    expect(result.stdout).toContain(`DRIFTED adapter: ${fleet.adapters[0]}`);
  });

  it("matches master by identity, not spelling, on a case-insensitive filesystem", () => {
    const fleet = makeFleet(["alpha"], ["one.md", "case.md"]);
    const upper = fleet.master.replace(/master$/, "MASTER");
    if (!existsSync(upper)) {
      // Case-sensitive filesystem: a case variant is a different, absent path; nothing to guard.
      return;
    }
    mkdirSync(dirname(fleet.adapters[1]), { recursive: true });
    symlinkSync(join(upper, "SKILL.md"), fleet.adapters[1]);
    writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[0]}\n${join(upper, "references", "new")}\n`);

    const masterBefore = snapshot(fleet.master);
    const result = runBounded([], fleet.env);

    expect(result.error).toBeUndefined();
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(result.stdout).toContain(`skipping adapter that resolves into master (nothing ever writes back into master): ${fleet.adapters[1]}`);
    expect(result.stdout).toContain(`skipping target that resolves to master (nothing ever writes back into master): ${join(upper, "references", "new")}`);
  });
});
