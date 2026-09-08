import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// @ts-ignore - audit scripts are ESM .mjs modules without declaration files.
const verifyPack = await import("../../scripts/audit/verify-pack.mjs");

const REPO_ROOT = new URL("../../", import.meta.url);
const VERIFY_PACK_URL = new URL("../../scripts/audit/verify-pack.mjs", import.meta.url).href;

const SKILL_FILE = "plugins/odin-scp/skills/odin-scp/SKILL.md";
const BOOTSTRAP_FILE = "protocol/bootstrap-skill.md";
const PLUGIN_PROMPT_FILE = "plugins/odin-scp/skills/odin-scp/references/canonical-introduction-prompt.md";
const PROTOCOL_PROMPT_FILE = "protocol/skill-references/canonical-introduction-prompt.md";
const SCP_FILE = "protocol/SCP.md";

/**
 * Independent anchor for the public-version scan set. Functional 8 requires the
 * previously unscanned protocol-side introduction-prompt mirror to be present.
 */
const expectedPublicVersionFiles = [
  "README.md",
  "docs/guides/quick-start.md",
  "docs/guides/quickstart-prompts.md",
  "docs/reference/client-compatibility.md",
  "docs/reference/distribution.md",
  "docs/reference/public-surface-audit.md",
  "src/protocol/version.ts",
  ".claude-plugin/marketplace.json",
  SCP_FILE,
  BOOTSTRAP_FILE,
  PROTOCOL_PROMPT_FILE,
  "plugins/odin-scp/.claude-plugin/plugin.json",
  SKILL_FILE,
  "plugins/odin-scp/skills/odin-scp/CHANGELOG.md",
  "plugins/odin-scp/skills/odin-scp/agents/openai.yaml",
  "plugins/odin-scp/skills/odin-scp/references/boot-receipt-examples.md",
  PLUGIN_PROMPT_FILE,
  "plugins/odin-scp/skills/odin-scp/references/harness-skill-targets.md",
  "plugins/odin-scp/skills/odin-scp/references/team-bootstrap-runbook.md",
  "plugins/odin-scp/skills/odin-scp/scripts/sync-installations.sh",
  "plugins/odin-scp/README.md"
];

function repoText(relativePath: string): string {
  return readFileSync(new URL(relativePath, REPO_ROOT), "utf8");
}

function publicVersionFilesFromDisk(): Record<string, string> {
  return Object.fromEntries(expectedPublicVersionFiles.map((file) => [file, repoText(file)]));
}

const packageJson = JSON.parse(repoText("package.json"));
const requiredPaths = verifyPack.requiredPackageFiles.map((path: string) => ({ path }));

const scratchDirs: string[] = [];

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "odin-version-surface-"));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Drives the REAL runVerifyPack composition in a child process so a refusal is
 * proven by a non-zero exit status rather than by reading the script.
 */
function runVerifyPackProcess(overrides: Record<string, string | null> = {}) {
  const publicVersionFiles = publicVersionFilesFromDisk();
  for (const [file, text] of Object.entries(overrides)) {
    if (text === null) delete publicVersionFiles[file];
    else publicVersionFiles[file] = text;
  }

  const payload = {
    pack: { files: requiredPaths, filename: `odin-sentinel-${packageJson.version}.tgz` },
    packageJson,
    publicVersionFiles,
    packFileTextByPath: {
      ...Object.fromEntries(requiredPaths.map((entry: { path: string }) => [entry.path, "safe packaged text"])),
      "dist/src/protocol/version.js": repoText("src/protocol/version.ts")
    },
    costPrivacyText: repoText("docs/reference/cost-and-privacy.md")
  };

  const payloadPath = join(scratchDir(), "payload.json");
  writeFileSync(payloadPath, JSON.stringify(payload));

  const script = [
    'import { readFileSync } from "node:fs";',
    `const payload = JSON.parse(readFileSync(${JSON.stringify(payloadPath)}, "utf8"));`,
    `const mod = await import(${JSON.stringify(VERIFY_PACK_URL)});`,
    "try {",
    "  mod.runVerifyPack(payload);",
    "} catch (error) {",
    "  process.stderr.write(String(error && error.message ? error.message : error));",
    "  process.exit(1);",
    "}",
    'process.stdout.write("VERIFY_PACK_PASS");'
  ].join("\n");

  return spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
}

function withAppendedLine(file: string, line: string): Record<string, string> {
  return { [file]: `${repoText(file)}\n${line}\n` };
}

/** Applies the same transform to both whole-file skill mirrors so they stay byte-identical. */
function bothSkillMirrors(transform: (text: string) => string): Record<string, string> {
  return {
    [SKILL_FILE]: transform(repoText(SKILL_FILE)),
    [BOOTSTRAP_FILE]: transform(repoText(BOOTSTRAP_FILE))
  };
}

const withDuplicateVersionKey = (text: string) =>
  text.replace(/^version: (.*)$/m, "version: $1\nversion: 0.60.0");

const withVersionKeyRelocatedToBody = (text: string) =>
  `${text.replace(/^version: .*\r?\n/m, "")}\nversion: 0.6.0\n`;

// ---------------------------------------------------------------------------
// POSITIVE CONTROL FIRST (Functional 1). A gate that refuses the shipped
// artifacts has broken the product, not hardened it.
// ---------------------------------------------------------------------------

describe("version surface positive control (real on-disk artifacts)", () => {
  it("accepts the real on-disk version surface through the composed runVerifyPack", () => {
    const result = runVerifyPackProcess();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("VERIFY_PACK_PASS");
  });

  it("finds both real skill frontmatters carrying the package version and agreeing", () => {
    expect(
      verifyPack.validateSkillFrontmatterVersions({
        skillText: repoText(SKILL_FILE),
        bootstrapText: repoText(BOOTSTRAP_FILE),
        currentVersion: packageJson.version
      })
    ).toEqual([]);
  });

  it("finds no legacy protocol version wording in the real skill and reference corpus", () => {
    expect(verifyPack.findLegacyProtocolWording(publicVersionFilesFromDisk())).toEqual([]);
  });

  it("finds no fork-permission wording in any real doctrine or reference copy", () => {
    expect(verifyPack.findForkPermissionWording(publicVersionFilesFromDisk())).toEqual([]);
  });

  it("finds both real mirror pairs whole-file byte-identical", () => {
    expect(verifyPack.validateMirrorPairParity(publicVersionFilesFromDisk())).toEqual([]);
  });

  it("scans the protocol-side introduction-prompt mirror and stays green (Functional 8)", () => {
    expect(verifyPack.PUBLIC_VERSION_FILES).toContain(PROTOCOL_PROMPT_FILE);
    expect(verifyPack.PUBLIC_VERSION_FILES).toEqual(expectedPublicVersionFiles);
    expect(verifyPack.findStaleVersionReferences(publicVersionFilesFromDisk(), packageJson.version)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Functional 3 - frontmatter refusal, by name, each proven by exit code.
// ---------------------------------------------------------------------------

describe("frontmatter version refusals", () => {
  it("(a) refuses a skill frontmatter version that differs from the package version", () => {
    const result = runVerifyPackProcess({
      [SKILL_FILE]: repoText(SKILL_FILE).replace(/^version: .*$/m, "version: 9.9.9")
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${SKILL_FILE}: skill frontmatter version 9.9.9 must match package version ${packageJson.version}`);
  });

  it("(b) refuses a bootstrap frontmatter version that differs from the package version", () => {
    const result = runVerifyPackProcess({
      [BOOTSTRAP_FILE]: repoText(BOOTSTRAP_FILE).replace(/^version: .*$/m, "version: 9.9.9")
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${BOOTSTRAP_FILE}: skill frontmatter version 9.9.9 must match package version ${packageJson.version}`);
  });

  it("(c) refuses two frontmatter versions that disagree while one still matches the package", () => {
    const result = runVerifyPackProcess({
      [BOOTSTRAP_FILE]: repoText(BOOTSTRAP_FILE).replace(/^version: .*$/m, "version: 0.7.1")
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `${SKILL_FILE} and ${BOOTSTRAP_FILE}: skill frontmatter versions disagree (${packageJson.version} vs 0.7.1)`
    );
  });

  it("(d) refuses an absent frontmatter block", () => {
    const result = runVerifyPackProcess({
      [SKILL_FILE]: repoText(SKILL_FILE).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${SKILL_FILE}: skill frontmatter block is absent`);
  });

  it("(e) refuses an absent version key inside an otherwise well-formed frontmatter", () => {
    const result = runVerifyPackProcess({
      [SKILL_FILE]: repoText(SKILL_FILE).replace(/^version: .*\r?\n/m, "")
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${SKILL_FILE}: skill frontmatter version key is absent`);
  });

  it("(e) refuses an unparseable version value", () => {
    const result = runVerifyPackProcess({
      [SKILL_FILE]: repoText(SKILL_FILE).replace(/^version: .*$/m, "version: three-point-six")
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${SKILL_FILE}: skill frontmatter version "three-point-six" is unparseable`);
  });

  it("refuses a missing skill mirror input rather than skipping the check", () => {
    const result = runVerifyPackProcess({ [BOOTSTRAP_FILE]: null });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${BOOTSTRAP_FILE}: content unavailable for skill frontmatter version check`);
  });
});

// ---------------------------------------------------------------------------
// Functional 4 - legacy wording refusal, per file, case and spacing tolerant.
// ---------------------------------------------------------------------------

describe("legacy protocol version wording refusals", () => {
  const cases: Array<[string, string]> = [
    [SKILL_FILE, "Use when introducing SCP v3.5 in a new repository."],
    [BOOTSTRAP_FILE, "Use when introducing scp v3.6 in a new repository."],
    [PLUGIN_PROMPT_FILE, "Load SCP  V3 before the preflight."],
    [PROTOCOL_PROMPT_FILE, "Load SCP v3 before the preflight."]
  ];

  for (const [file, injected] of cases) {
    it(`refuses legacy wording in ${file}`, () => {
      const result = runVerifyPackProcess(withAppendedLine(file, injected));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`${file}: legacy protocol version wording`);
      expect(result.stderr).toMatch(new RegExp(`${file.replaceAll(".", "\\.")}: legacy protocol version wording "`));
    });
  }

  it("refuses a missing scanned file rather than skipping the legacy wording check", () => {
    const result = runVerifyPackProcess({ [PROTOCOL_PROMPT_FILE]: null });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${PROTOCOL_PROMPT_FILE}: content unavailable for legacy protocol wording check`);
  });
});

// ---------------------------------------------------------------------------
// Functional 6 - fork-permission refusal across all three doctrine copies.
// ---------------------------------------------------------------------------

describe("fork-permission wording refusals", () => {
  const forkSentence = "Private local skill copies may differ intentionally.";

  for (const file of [SKILL_FILE, BOOTSTRAP_FILE, SCP_FILE]) {
    it(`refuses surviving fork-permission wording in ${file}`, () => {
      const result = runVerifyPackProcess(withAppendedLine(file, forkSentence));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`${file}: fork-permission wording`);
    });
  }

  it("also scans the reference mirrors for fork-permission wording", () => {
    const result = runVerifyPackProcess(withAppendedLine(PLUGIN_PROMPT_FILE, forkSentence));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${PLUGIN_PROMPT_FILE}: fork-permission wording`);
  });

  it("refuses a missing doctrine copy rather than skipping the fork-permission check", () => {
    const result = runVerifyPackProcess({ [SCP_FILE]: null });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${SCP_FILE}: content unavailable for fork-permission check`);
  });
});

// ---------------------------------------------------------------------------
// Functional 7 - mirror parity is asserted, not assumed.
// ---------------------------------------------------------------------------

describe("mirror pair parity refusals", () => {
  it("refuses a one-byte divergence in the skill mirror pair", () => {
    const result = runVerifyPackProcess({ [BOOTSTRAP_FILE]: `${repoText(BOOTSTRAP_FILE)} ` });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${SKILL_FILE} and ${BOOTSTRAP_FILE}: mirror pair is not byte-identical`);
  });

  it("refuses a one-byte divergence in the introduction-prompt mirror pair", () => {
    const result = runVerifyPackProcess({ [PROTOCOL_PROMPT_FILE]: `${repoText(PROTOCOL_PROMPT_FILE)} ` });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${PLUGIN_PROMPT_FILE} and ${PROTOCOL_PROMPT_FILE}: mirror pair is not byte-identical`);
  });

  it("refuses a missing side of the introduction-prompt mirror pair, never skipping", () => {
    const result = runVerifyPackProcess({ [PLUGIN_PROMPT_FILE]: null });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${PLUGIN_PROMPT_FILE}: content unavailable for mirror parity check`);
  });
});

// ---------------------------------------------------------------------------
// Duplicate and misplaced frontmatter version keys. A first-match parser
// accepted a block carrying two version keys; YAML prohibits duplicate keys and
// so does this gate.
// ---------------------------------------------------------------------------

describe("duplicate and misplaced frontmatter version keys", () => {
  it("refuses a duplicate version key in one skill mirror", () => {
    const result = runVerifyPackProcess({ [SKILL_FILE]: withDuplicateVersionKey(repoText(SKILL_FILE)) });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("VERIFY_PACK_PASS");
    expect(result.stderr).toContain(`${SKILL_FILE}: duplicate frontmatter version key`);
  });

  it("refuses a duplicate version key present in BOTH mirrors while they stay byte-identical", () => {
    const overrides = bothSkillMirrors(withDuplicateVersionKey);
    expect(overrides[SKILL_FILE]).toBe(overrides[BOOTSTRAP_FILE]);

    const result = runVerifyPackProcess(overrides);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("VERIFY_PACK_PASS");
    expect(result.stderr).toContain(`${SKILL_FILE}: duplicate frontmatter version key`);
    expect(result.stderr).toContain(`${BOOTSTRAP_FILE}: duplicate frontmatter version key`);
    // The first-match value must not be trusted as a satisfied requirement.
    expect(result.stderr).not.toContain("VERIFY_PACK_PASS");
  });

  it("refuses a version key relocated out of the frontmatter into the body", () => {
    const overrides = bothSkillMirrors(withVersionKeyRelocatedToBody);
    expect(overrides[SKILL_FILE]).toBe(overrides[BOOTSTRAP_FILE]);
    expect(overrides[SKILL_FILE]).toContain("version: 0.6.0");

    const result = runVerifyPackProcess(overrides);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("VERIFY_PACK_PASS");
    expect(result.stderr).toContain(`${SKILL_FILE}: skill frontmatter version key is absent`);
    expect(result.stderr).toContain(`${BOOTSTRAP_FILE}: skill frontmatter version key is absent`);
  });
});

// ---------------------------------------------------------------------------
// Unicode folding before the wording scans. Scope is disguise of the SAME
// wording (invisible characters, exotic spaces, compatibility digits), not
// paraphrase.
// ---------------------------------------------------------------------------

describe("Unicode-folded wording scans", () => {
  const disguisedLegacy: Array<[string, string]> = [
    ["no-break space between the tokens", "Load SCP\u00A0v3.5 before the preflight."],
    ["thin space between the tokens", "Load SCP\u2009v3.5 before the preflight."],
    ["zero-width joiner inside a word", "Load SC\u200DP v3.5 before the preflight."],
    ["zero-width space inside a word", "Load S\u200BCP v3.5 before the preflight."],
    ["fullwidth letters and digits", "Load \uFF33\uFF23\uFF30 \uFF56\uFF13 before the preflight."],
    ["superscript digit", "Load SCP v\u00B3 before the preflight."]
  ];

  for (const [label, injected] of disguisedLegacy) {
    it(`refuses legacy wording disguised with a ${label}`, () => {
      const result = runVerifyPackProcess(withAppendedLine(SKILL_FILE, injected));
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("VERIFY_PACK_PASS");
      expect(result.stderr).toContain(`${SKILL_FILE}: legacy protocol version wording`);
    });
  }

  it("refuses fork-permission wording disguised with a zero-width joiner inside a word", () => {
    const result = runVerifyPackProcess(
      withAppendedLine(SCP_FILE, "Private local sk\u200Dill copies may differ intentionally.")
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("VERIFY_PACK_PASS");
    expect(result.stderr).toContain(`${SCP_FILE}: fork-permission wording`);
  });

  it("refuses fork-permission wording disguised with no-break spaces between the words", () => {
    const result = runVerifyPackProcess(
      withAppendedLine(BOOTSTRAP_FILE, "Private\u00A0local\u00A0skill\u00A0copies\u00A0may\u00A0differ intentionally.")
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("VERIFY_PACK_PASS");
    expect(result.stderr).toContain(`${BOOTSTRAP_FILE}: fork-permission wording`);
  });

  it("folds invisible characters, exotic whitespace, and compatibility forms", () => {
    expect(verifyPack.foldScannedText("SCP\u00A0v\u00B3")).toBe("SCP v3");
    expect(verifyPack.foldScannedText("SC\u200DP\u2009v3")).toBe("SCP v3");
    expect(verifyPack.foldScannedText("\uFF33\uFF23\uFF30 \uFF56\uFF13")).toBe("SCP v3");
    expect(verifyPack.foldScannedText("a\u3000\u205F\u202Fb")).toBe("a b");
    expect(verifyPack.foldScannedText("a\uFEFF\u200B\u200Cb")).toBe("ab");
  });

  it("leaves the shipped files clean under folding", () => {
    const folded = publicVersionFilesFromDisk();
    for (const file of verifyPack.FORK_PERMISSION_SCANNED_FILES) {
      expect(verifyPack.foldScannedText(folded[file])).not.toMatch(/private local skill copies may differ/i);
    }
    for (const file of verifyPack.LEGACY_PROTOCOL_WORDING_SCANNED_FILES) {
      expect(verifyPack.foldScannedText(folded[file])).not.toMatch(/scp +v3/i);
    }
  });
});
