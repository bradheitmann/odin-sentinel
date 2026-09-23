import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { closeSync, constants as fsConstants, lstatSync, openSync } from "node:fs";
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

  it("guards the physical master when SCP_SKILL_MASTER spells it through link/..", () => {
    const fleet = makeFleet(["alpha"], ["one.md", "linked.md"]);
    // `a/s` points at `<root>/sub`, so the kernel reads `<root>/a/s/../master` as
    // the real master while a lexical reading names the decoy `<root>/a/master`.
    mkdirSync(join(fleet.root, "sub"), { recursive: true });
    mkdirSync(join(fleet.root, "a", "master"), { recursive: true });
    symlinkSync(join(fleet.root, "sub"), join(fleet.root, "a", "s"));
    const spelled = join(fleet.root, "a", "s") + "/../master";
    mkdirSync(dirname(fleet.adapters[1]), { recursive: true });
    symlinkSync(join(fleet.master, "SKILL.md"), fleet.adapters[1]);
    const inside = join(fleet.master, "references", "nested-target");
    writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[0]}\n${inside}\n`);

    const masterBefore = snapshot(fleet.master);
    const result = runBounded([], { ...fleet.env, SCP_SKILL_MASTER: spelled });

    expect(result.error).toBeUndefined();
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(result.stdout).toContain(`skipping adapter that resolves into master (nothing ever writes back into master): ${fleet.adapters[1]}`);
    expect(result.stdout).toContain(`skipping target that resolves to master (nothing ever writes back into master): ${inside}`);
    expect(sha256File(join(fleet.targets[0], "SKILL.md"))).toBe(sha256File(join(fleet.master, "SKILL.md")));
  });

  it("guards the physical master for a relative SCP_SKILL_MASTER run from a symlinked cwd", () => {
    const fleet = makeFleet(["alpha"], ["one.md", "linked.md"]);
    // The shell's logical PWD is `<home>/wd` (a link to master/scripts), so a
    // logical `cd ..` lands in `<home>` while the kernel reads `..` as master.
    const wd = join(fleet.home, "wd");
    symlinkSync(join(fleet.master, "scripts"), wd);
    mkdirSync(dirname(fleet.adapters[1]), { recursive: true });
    symlinkSync(join(fleet.master, "SKILL.md"), fleet.adapters[1]);

    const baseEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("SCP_"))
    ) as Record<string, string>;
    const masterBefore = snapshot(fleet.master);
    const result = spawnSync("bash", ["-c", 'ulimit -f 20480 && exec bash "$0" "$@"', SCRIPT_PATH], {
      cwd: wd,
      encoding: "utf8",
      env: { ...baseEnv, ...fleet.env, SCP_SKILL_MASTER: "..", PWD: wd },
      timeout: 20_000
    });

    expect(result.error).toBeUndefined();
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(result.stdout).toContain(`skipping adapter that resolves into master (nothing ever writes back into master): ${fleet.adapters[1]}`);
    expect(readFileSync(fleet.adapters[0], "utf8")).toBe(expectedAdapterBytes(fleet.master));
  });

  it("skips a native target whose link text ends in a newline instead of misattributing it", () => {
    const fleet = makeFleet(["alpha", "nl"], ["one.md"]);
    const targetDir = dirname(fleet.targets[1]);
    mkdirSync(targetDir, { recursive: true });
    // `nl` -> "t\n", and "t\n" -> master/references. Stripping the newline would
    // attribute the write to the absent `t` beside it; the kernel writes into master.
    symlinkSync("t\n", fleet.targets[1]);
    symlinkSync(join(fleet.master, "references"), join(targetDir, "t\n"));

    const masterBefore = snapshot(fleet.master);
    const dry = runBounded(["--dry-run"], fleet.env);
    expect(dry.stdout).toContain(`DRY-RUN would skip target that resolves to master: ${fleet.targets[1]}`);

    const result = runBounded([], fleet.env);
    expect(result.error).toBeUndefined();
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(result.stdout).toContain(`skipping target that resolves to master (nothing ever writes back into master): ${fleet.targets[1]}`);
    expect(sha256File(join(fleet.targets[0], "SKILL.md"))).toBe(sha256File(join(fleet.master, "SKILL.md")));
  });

  it("skips an adapter whose link text ends in a newline and never counts it verified", () => {
    const fleet = makeFleet(["alpha"], ["one.md", "nl.md"]);
    const adapterDir = dirname(fleet.adapters[1]);
    mkdirSync(adapterDir, { recursive: true });
    symlinkSync("d\n", fleet.adapters[1]);
    symlinkSync(join(fleet.master, "new.md"), join(adapterDir, "d\n"));

    const masterBefore = snapshot(fleet.master);
    const result = runBounded([], fleet.env);

    expect(result.error).toBeUndefined();
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(existsSync(join(fleet.master, "new.md"))).toBe(false);
    expect(result.stdout).toContain(`skipping adapter that resolves into master (nothing ever writes back into master): ${fleet.adapters[1]}`);
    expect(result.stdout).toContain("adapter_verified: 1");
  });
});

// ---------------------------------------------------------------------------
// STORY-SYNCVERIFY-001 - a native install is verified as a whole-tree snapshot.
// ---------------------------------------------------------------------------

describe("full-tree verification", () => {
  function syncedFleet(): Fleet {
    const fleet = makeFleet();
    expect(runScript([], fleet.env).status).toBe(0);
    return fleet;
  }

  function expectTreeDrift(result: ReturnType<typeof runScript>, target: string) {
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(`DRIFTED native target: ${target}\n`);
    expect(result.stdout).toContain("tree differs from master");
    expect(result.stdout).toContain("native_verified: 1");
    expect(result.stdout).toContain("native_drifted: 1");
    expect(result.stdout).not.toContain("SCP skill sync verified");
  }

  it("fails a target whose SKILL.md matches but another file changed", () => {
    const fleet = syncedFleet();
    const script = join(fleet.targets[0], "scripts", "sync-installations.sh");
    writeFileSync(script, `${readFileSync(script, "utf8")}\n# locally appended drift\n`);

    const before = snapshot(fleet.root);
    const result = runScript(["--verify-only"], fleet.env);
    expectTreeDrift(result, fleet.targets[0]);
    expect(snapshot(fleet.root)).toEqual(before);
  });

  it("fails a target that carries an extra file", () => {
    const fleet = syncedFleet();
    writeFileSync(join(fleet.targets[1], "references", "stale-extra.md"), "stale\n");

    expectTreeDrift(runScript(["--verify-only"], fleet.env), fleet.targets[1]);
  });

  it("fails a target that is missing a file, in dry-run too, and writes nothing", () => {
    const fleet = syncedFleet();
    rmSync(join(fleet.targets[0], "CHANGELOG.md"));

    expectTreeDrift(runScript(["--verify-only"], fleet.env), fleet.targets[0]);

    const before = snapshot(fleet.root);
    expectTreeDrift(runScript(["--dry-run"], fleet.env), fleet.targets[0]);
    expect(snapshot(fleet.root)).toEqual(before);
  });

  it("fails a target where a file became a directory or a directory became a file", () => {
    const fleet = syncedFleet();
    rmSync(join(fleet.targets[0], "CHANGELOG.md"));
    mkdirSync(join(fleet.targets[0], "CHANGELOG.md"));
    rmSync(join(fleet.targets[1], "agents"), { recursive: true });
    writeFileSync(join(fleet.targets[1], "agents"), "not a directory\n");

    const result = runScript(["--verify-only"], fleet.env);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(`DRIFTED native target: ${fleet.targets[0]}\n`);
    expect(result.stdout).toContain(`DRIFTED native target: ${fleet.targets[1]}\n`);
    expect(result.stdout).toContain("native_verified: 0");
    expect(result.stdout).not.toContain("SCP skill sync verified");
  });

  it("fails a target where a file was replaced by a dangling symlink", () => {
    const fleet = syncedFleet();
    const replaced = join(fleet.targets[0], "references", "boot-receipt-examples.md");
    rmSync(replaced);
    symlinkSync(join(fleet.root, "does-not-exist.md"), replaced);

    expectTreeDrift(runScript(["--verify-only"], fleet.env), fleet.targets[0]);
  });

  it("reports a write-mode skipped target inside master as drifted when its tree differs", () => {
    const fleet = makeFleet(["alpha"]);
    const inside = join(fleet.master, "references", "nested");
    mkdirSync(inside, { recursive: true });
    cpSync(join(fleet.master, "SKILL.md"), join(inside, "SKILL.md"));
    writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[0]}\n${inside}\n`);

    const masterBefore = snapshot(fleet.master);
    const result = runScript([], fleet.env);
    expect(snapshot(fleet.master)).toEqual(masterBefore);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(`DRIFTED native target: ${inside}\n`);
    expect(result.stdout).toContain("native_verified: 1");
    expect(result.stdout).not.toContain("SCP skill sync verified");
  });

  it("repairs tree drift in write mode and then verifies with a zero exit", () => {
    const fleet = syncedFleet();
    writeFileSync(join(fleet.targets[0], "references", "stale-extra.md"), "stale\n");
    rmSync(join(fleet.targets[1], "CHANGELOG.md"));

    const sync = runScript([], fleet.env);
    expect(sync.status).toBe(0);
    expect(sync.stdout).toContain("SCP skill sync verified");
    expect(existsSync(join(fleet.targets[0], "references", "stale-extra.md"))).toBe(false);

    const verify = runScript(["--verify-only"], fleet.env);
    expect(verify.status).toBe(0);
    expect(verify.stdout).toContain("native_verified: 2");
    expect(verify.stdout).not.toContain("DRIFTED");
  });
});

// ---------------------------------------------------------------------------
// STORY-SYNCTILDE-001 - a leading "~/" in a targets file expands to $HOME/.
// ---------------------------------------------------------------------------

describe("targets-file tilde expansion", () => {
  /** A fleet whose targets and adapters files name every path as "~/...". */
  function tildeFleet() {
    const fleet = makeFleet(["alpha"], ["one.md"]);
    const cwd = join(fleet.root, "cwd");
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(fleet.root, "targets.txt"),
      "# native targets\n\n~/skills/alpha\n~/skills/beta\n"
    );
    writeFileSync(join(fleet.root, "adapters.txt"), "~/prompts/one.md\n");
    return { fleet, cwd };
  }

  function runIn(cwd: string, args: string[], env: Record<string, string>) {
    const baseEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("SCP_"))
    ) as Record<string, string>;
    return spawnSync("bash", [SCRIPT_PATH, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...baseEnv, ...env }
    });
  }

  it("writes every ~/ target and adapter under $HOME, never under the working directory", () => {
    const { fleet, cwd } = tildeFleet();

    const sync = runIn(cwd, [], fleet.env);
    expect(sync.status).toBe(0);
    expect(sync.stdout).toContain("SCP skill sync verified");
    expect(readdirSync(cwd)).toEqual([]);

    const masterHash = sha256File(join(fleet.master, "SKILL.md"));
    for (const name of ["alpha", "beta"]) {
      expect(sha256File(join(fleet.home, "skills", name, "SKILL.md"))).toBe(masterHash);
    }
    expect(readFileSync(join(fleet.home, "prompts", "one.md"), "utf8")).toBe(expectedAdapterBytes(fleet.master));

    const verify = runIn(cwd, ["--verify-only"], fleet.env);
    expect(verify.status).toBe(0);
    expect(verify.stdout).toContain("native_verified: 2");
    expect(verify.stdout).toContain("adapter_verified: 1");
  });

  it("reports an absent ~/ install by its expanded $HOME path and writes nothing", () => {
    const { fleet, cwd } = tildeFleet();

    const before = snapshot(fleet.root);
    const result = runIn(cwd, ["--verify-only"], fleet.env);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(`ABSENT native target: ${join(fleet.home, "skills", "alpha")}/SKILL.md`);
    expect(result.stdout).toContain(`ABSENT adapter: ${join(fleet.home, "prompts", "one.md")}`);
    expect(result.stdout).not.toContain("~/");
    expect(snapshot(fleet.root)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// STORY-SYNCHARDEN-001 - special files fail closed, digests ignore path
// spelling, and a $HOME or / target is refused.
// ---------------------------------------------------------------------------

describe("sync hardening: special files, backslash paths, HOME targets", () => {
  /**
   * Every run here is bounded: the pre-fix script blocks forever in write mode
   * on a FIFO, so a timeout turns that hang into a test failure. SIGKILL goes to
   * bash only; any rsync child left blocked opening a FIFO is released by
   * releaseFifo() in the test's finally block.
   */
  function runTimed(args: string[], env: Record<string, string>, cwd?: string) {
    const baseEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("SCP_"))
    ) as Record<string, string>;
    return spawnSync("bash", [SCRIPT_PATH, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...baseEnv, ...env },
      timeout: 20_000,
      killSignal: "SIGKILL"
    });
  }

  function makeFifo(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    const made = spawnSync("mkfifo", [path]);
    expect(made.status).toBe(0);
  }

  /** Opening read-write never blocks and unblocks any reader stuck in open(). */
  function releaseFifo(path: string) {
    try {
      if (lstatSync(path).isFIFO()) closeSync(openSync(path, fsConstants.O_RDWR | fsConstants.O_NONBLOCK));
    } catch {
      // already gone or replaced; nothing is blocked on it
    }
  }

  function isFifo(path: string): boolean {
    return lstatSync(path).isFIFO();
  }

  /** Listing of a tree by lstat only, so it never opens a FIFO. */
  function lsnapshot(dir: string): string[] {
    const lines: string[] = [];
    const walk = (current: string, rel: string) => {
      for (const entry of readdirSync(current).sort()) {
        const abs = join(current, entry);
        const relPath = rel ? `${rel}/${entry}` : entry;
        const st = lstatSync(abs);
        if (st.isDirectory()) {
          lines.push(`dir  ${relPath}`);
          walk(abs, relPath);
        } else if (st.isFile()) {
          lines.push(`file ${relPath} ${sha256File(abs)}`);
        } else {
          lines.push(`other ${relPath} fifo=${st.isFIFO()} link=${st.isSymbolicLink()}`);
        }
      }
    };
    walk(dir, "");
    return lines;
  }

  it("refuses a target holding a FIFO where master has a file, without hanging, and still syncs its sibling", () => {
    const fleet = makeFleet(["alpha", "beta"], ["one.md"]);
    const fifo = join(fleet.targets[0], "CHANGELOG.md");
    makeFifo(fifo);
    try {
      const result = runTimed([], fleet.env);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`REFUSED native target (holds a FIFO, socket, device, or non-directory; not written): ${fleet.targets[0]}: `);
      expect(result.stdout).toContain("native_refused: 1");
      expect(isFifo(fifo)).toBe(true);
      expect(readdirSync(fleet.targets[0])).toEqual(["CHANGELOG.md"]);
      expect(sha256File(join(fleet.targets[1], "SKILL.md"))).toBe(sha256File(join(fleet.master, "SKILL.md")));
      expect(readFileSync(fleet.adapters[0], "utf8")).toBe(expectedAdapterBytes(fleet.master));
    } finally {
      releaseFifo(fifo);
    }
  });

  it("refuses a synced target that gained a FIFO at an extra nested path, in write mode and dry-run", () => {
    const fleet = makeFleet(["alpha"], ["one.md"]);
    expect(runScript([], fleet.env).status).toBe(0);
    const fifo = join(fleet.targets[0], "references", "extra-pipe");
    makeFifo(fifo);
    try {
      const before = lsnapshot(fleet.root);
      const dry = runTimed(["--dry-run"], fleet.env);
      expect(dry.error).toBeUndefined();
      expect(dry.status).toBe(1);
      expect(dry.stdout).toContain(`DRY-RUN would refuse native target (holds a FIFO, socket, device, or non-directory): ${fleet.targets[0]}: `);
      expect(lsnapshot(fleet.root)).toEqual(before);

      const sync = runTimed([], fleet.env);
      expect(sync.error).toBeUndefined();
      expect(sync.status).toBe(1);
      expect(sync.stdout).toContain(`REFUSED native target (holds a FIFO, socket, device, or non-directory; not written): ${fleet.targets[0]}: `);
      expect(isFifo(fifo)).toBe(true);
    } finally {
      releaseFifo(fifo);
    }
  });

  it("refuses a native target path that is itself a FIFO and an adapter path that is a FIFO", () => {
    const fleet = makeFleet(["alpha", "piped"], ["one.md", "piped.md"]);
    makeFifo(fleet.targets[1]);
    makeFifo(fleet.adapters[1]);
    try {
      const result = runTimed([], fleet.env);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`REFUSED native target (holds a FIFO, socket, device, or non-directory; not written): ${fleet.targets[1]}: `);
      expect(result.stdout).toContain(`REFUSED adapter (exists and is not a regular file; not written): ${fleet.adapters[1]}`);
      expect(result.stdout).toContain("adapter_refused: 1");
      expect(isFifo(fleet.targets[1])).toBe(true);
      expect(isFifo(fleet.adapters[1])).toBe(true);
      expect(sha256File(join(fleet.targets[0], "SKILL.md"))).toBe(sha256File(join(fleet.master, "SKILL.md")));
      expect(readFileSync(fleet.adapters[0], "utf8")).toBe(expectedAdapterBytes(fleet.master));
    } finally {
      releaseFifo(fleet.targets[1]);
      releaseFifo(fleet.adapters[1]);
    }
  });

  it("verifies a target and an adapter whose paths contain a backslash", () => {
    const fleet = makeFleet(["back\\slash"], ["one\\two.md"]);

    const sync = runTimed([], fleet.env);
    expect(sync.status).toBe(0);
    expect(sync.stdout).toContain("SCP skill sync verified");

    const verify = runTimed(["--verify-only"], fleet.env);
    expect(verify.status).toBe(0);
    expect(verify.stdout).toContain("native_verified: 1");
    expect(verify.stdout).toContain("adapter_verified: 1");
    expect(verify.stdout).not.toContain("DRIFTED");
  });

  it("reports a plain 64-hex skill_sha256 for a master whose path contains a backslash", () => {
    const fleet = makeFleet(["alpha"], ["one.md"]);
    const master = join(fleet.root, "mas\\ter");
    cpSync(fleet.master, master, { recursive: true });
    const env = { ...fleet.env, SCP_SKILL_MASTER: master };

    const sync = runTimed([], env);
    expect(sync.status).toBe(0);
    expect(sync.stdout).toContain(`skill_sha256: ${sha256File(join(master, "SKILL.md"))}\n`);
    expect(sync.stdout).toMatch(/^skill_sha256: [0-9a-f]{64}$/m);
  });

  it("refuses a bare ~/ target line outright in every mode when master is outside HOME", () => {
    const fleet = makeFleet(["alpha"], ["one.md"]);
    writeFileSync(join(fleet.home, "sentinel.txt"), "keep me\n");
    writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[0]}\n~/\n`);

    for (const args of [["--verify-only"], ["--dry-run"], []]) {
      const before = snapshot(fleet.root);
      const result = runTimed(args, fleet.env);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`refusing native target that is $HOME or /: ${fleet.home}/`);
      expect(snapshot(fleet.root)).toEqual(before);
    }
    expect(readFileSync(join(fleet.home, "sentinel.txt"), "utf8")).toBe("keep me\n");
    expect(existsSync(fleet.targets[0])).toBe(false);
  });

  it("refuses the absolute HOME path outright even when master is inside HOME", () => {
    const fleet = makeFleet(["alpha"], ["one.md"]);
    const master = join(fleet.home, "skills", "odin-scp");
    cpSync(fleet.master, master, { recursive: true });
    writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[0]}\n${fleet.home}/\n`);
    const env = { ...fleet.env, SCP_SKILL_MASTER: master };

    const before = snapshot(fleet.root);
    const result = runTimed([], env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing native target that is $HOME or /: ${fleet.home}/`);
    expect(snapshot(fleet.root)).toEqual(before);
    expect(existsSync(fleet.targets[0])).toBe(false);
  });

  it("refuses / outright in verify-only and dry-run", () => {
    const fleet = makeFleet(["alpha"], ["one.md"]);
    writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[0]}\n/\n`);

    for (const args of [["--verify-only"], ["--dry-run"]]) {
      const result = runTimed(args, fleet.env);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("refusing native target that is $HOME or /: /\n");
      expect(result.stdout).not.toContain("DRY-RUN would sync native target: /\n");
    }
  });

  it("refuses an ancestor of HOME that is not an ancestor of master and still syncs the rest", () => {
    const fleet = makeFleet(["alpha"], ["one.md"]);
    const upper = join(fleet.root, "users");
    const home = join(upper, "operator");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "sentinel.txt"), "keep me\n");
    writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[0]}\n${upper}\n`);
    const env = { ...fleet.env, HOME: home };

    const upperBefore = snapshot(upper);
    const dry = runTimed(["--dry-run"], env);
    expect(dry.status).toBe(1);
    expect(dry.stdout).toContain(`DRY-RUN would refuse native target (an ancestor of $HOME): ${upper}\n`);

    const result = runTimed([], env);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`REFUSED native target (an ancestor of $HOME; not written): ${upper}\n`);
    expect(snapshot(upper)).toEqual(upperBefore);
    expect(sha256File(join(fleet.targets[0], "SKILL.md"))).toBe(sha256File(join(fleet.master, "SKILL.md")));
  });
});

describe("sync hardening: unexpanded home lines in the targets files", () => {
  // Only a leading ~/ is expanded. A bare ~ or a $HOME / ${HOME} line would be
  // used relative to the working directory, so it stops the run in every mode.
  const HOME_LINES = ["~", "$HOME", "$HOME/", "${HOME}", "${HOME}/skills/alpha"];

  function runIn(cwd: string, args: string[], env: Record<string, string>) {
    const baseEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("SCP_"))
    ) as Record<string, string>;
    return spawnSync("bash", [SCRIPT_PATH, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...baseEnv, ...env },
      timeout: 20_000,
      killSignal: "SIGKILL"
    });
  }

  it("refuses a bare ~ or an unexpanded $HOME native target line in every mode and writes nothing", () => {
    const fleet = makeFleet(["alpha"], ["one.md"]);
    const cwd = join(fleet.root, "cwd");
    mkdirSync(cwd);
    writeFileSync(join(fleet.home, "sentinel.txt"), "keep me\n");

    for (const line of HOME_LINES) {
      writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[0]}\n${line}\n`);
      for (const args of [["--verify-only"], ["--dry-run"], []]) {
        const before = snapshot(fleet.root);
        const result = runIn(cwd, args, fleet.env);
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`refusing unexpanded home line in ${join(fleet.root, "targets.txt")} (only a leading ~/ is expanded): ${line}\n`);
        expect(snapshot(fleet.root)).toEqual(before);
      }
    }
    expect(readdirSync(cwd)).toEqual([]);
    expect(existsSync(fleet.targets[0])).toBe(false);
    expect(readFileSync(join(fleet.home, "sentinel.txt"), "utf8")).toBe("keep me\n");
  });

  it("refuses an unexpanded $HOME adapter line before any native target is written", () => {
    const fleet = makeFleet(["alpha"], ["one.md"]);
    const cwd = join(fleet.root, "cwd");
    mkdirSync(cwd);
    writeFileSync(join(fleet.root, "adapters.txt"), `${fleet.adapters[0]}\n$HOME/prompts/two.md\n`);

    const before = snapshot(fleet.root);
    const result = runIn(cwd, [], fleet.env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`refusing unexpanded home line in ${join(fleet.root, "adapters.txt")} (only a leading ~/ is expanded): $HOME/prompts/two.md\n`);
    expect(snapshot(fleet.root)).toEqual(before);
    expect(readdirSync(cwd)).toEqual([]);
    expect(existsSync(fleet.targets[0])).toBe(false);
  });
});

describe("sync hardening: HOME reached through a symlink", () => {
  function runTimed(args: string[], env: Record<string, string>) {
    const baseEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("SCP_"))
    ) as Record<string, string>;
    return spawnSync("bash", [SCRIPT_PATH, ...args], {
      encoding: "utf8",
      env: { ...baseEnv, ...env },
      timeout: 20_000,
      killSignal: "SIGKILL"
    });
  }

  it("refuses a directory that physically contains a symlinked HOME, in dry-run and write mode", () => {
    const fleet = makeFleet(["alpha"], ["one.md"]);
    const real = join(fleet.root, "real");
    const realHome = join(real, "home");
    const links = join(fleet.root, "links");
    mkdirSync(realHome, { recursive: true });
    mkdirSync(links, { recursive: true });
    symlinkSync(realHome, join(links, "home"));
    writeFileSync(join(realHome, "sentinel.txt"), "keep me\n");
    writeFileSync(join(fleet.root, "targets.txt"), `${fleet.targets[0]}\n${real}\n`);
    const env = { ...fleet.env, HOME: join(links, "home") };

    const realBefore = snapshot(real);
    const dry = runTimed(["--dry-run"], env);
    expect(dry.status).toBe(1);
    expect(dry.stdout).toContain(`DRY-RUN would refuse native target (an ancestor of $HOME): ${real}\n`);

    const result = runTimed([], env);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`REFUSED native target (an ancestor of $HOME; not written): ${real}\n`);
    expect(snapshot(real)).toEqual(realBefore);
    expect(readFileSync(join(realHome, "sentinel.txt"), "utf8")).toBe("keep me\n");
    expect(sha256File(join(fleet.targets[0], "SKILL.md"))).toBe(sha256File(join(fleet.master, "SKILL.md")));
  });
});
