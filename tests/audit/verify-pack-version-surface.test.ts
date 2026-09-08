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

// ---------------------------------------------------------------------------
// STORY-REL070-003 — a changelog release section describes the version it is
// named after. A version reference is HISTORICAL, and must not be reported,
// exactly when the nearest preceding `## ` heading names that same version.
// Everything else keeps current strictness. All fixtures here are in-memory
// strings, per the slice's fixture policy; no new fixture file or directory
// is introduced.
// ---------------------------------------------------------------------------

const CHANGELOG_FILE = "plugins/odin-scp/skills/odin-scp/CHANGELOG.md";
const FIXTURE_FILE = "fixture-changelog.md";

/**
 * A synthetic changelog using version numbers unrelated to the real package
 * version or the real minimum-compatible version, so this fixture proves the
 * structural rule on its own terms rather than piggybacking on the real
 * CHANGELOG's current-version coincidence.
 */
const CHANGELOG_STRUCTURE_FIXTURE = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "- server version 8.4.9 is still pending and must be reported.",
  "",
  "## 8.4.2 - 2026-01-01",
  "",
  "- Bump public version to 8.4.2 across doctrine headers; minimum compatible child mcp version 0.4.5 unchanged.",
  "- Earlier note: public version 8.4.1 was previously the minimum compatible child mcp version 0.4.5 baseline.",
  "",
  "## 8.4.1 - 2025-12-01",
  "",
  "- Bump public version to 8.4.1 across doctrine headers.",
  ""
].join("\n");

describe("changelog release-section historical version exemption (STORY-REL070-003)", () => {
  it("AC1: silences a version reference named by its own enclosing release heading, in two distinct sections", () => {
    const findings = verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: CHANGELOG_STRUCTURE_FIXTURE }, "0.6.0");
    // 8.4.2 appears only inside the `## 8.4.2` section it names -- fully silenced.
    expect(findings).not.toContain(`${FIXTURE_FILE}: stale version reference 8.4.2`);
    // 8.4.1 appears TWICE in the fixture: once as a foreign version inside the
    // `## 8.4.2` section (still reported, AC3) and once inside its OWN
    // `## 8.4.1` section (historical, silenced). Exactly one finding for it
    // proves the second occurrence was silenced without touching the first.
    expect(findings.filter((f: string) => f === `${FIXTURE_FILE}: stale version reference 8.4.1`)).toHaveLength(1);
  });

  it("AC1 (integration): the composed runVerifyPack pipeline exits 0 on a purely historical release section", () => {
    const historicalOnly = [
      "# Changelog",
      "",
      "## Unreleased",
      "",
      "## 8.4.2 - 2026-01-01",
      "",
      "- Bump public version to 8.4.2 across doctrine headers; minimum compatible child mcp version 0.4.5 unchanged.",
      ""
    ].join("\n");
    const result = runVerifyPackProcess({ [CHANGELOG_FILE]: historicalOnly });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("VERIFY_PACK_PASS");
  });

  it("AC2: `## Unreleased` is NOT historical -- a marker-bearing version there is still reported, by name", () => {
    const findings = verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: CHANGELOG_STRUCTURE_FIXTURE }, "0.6.0");
    expect(findings).toContain(`${FIXTURE_FILE}: stale version reference 8.4.9`);
  });

  it("AC3: only the section's OWN version is exempt -- a foreign version inside a named section is still reported, by name", () => {
    const findings = verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: CHANGELOG_STRUCTURE_FIXTURE }, "0.6.0");
    expect(findings).toContain(`${FIXTURE_FILE}: stale version reference 8.4.1`);
  });

  it("AC1/AC2/AC3 combined: the fixture produces exactly these two findings, in line order", () => {
    const findings = verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: CHANGELOG_STRUCTURE_FIXTURE }, "0.6.0");
    expect(findings).toEqual([
      `${FIXTURE_FILE}: stale version reference 8.4.9`,
      `${FIXTURE_FILE}: stale version reference 8.4.1`
    ]);
  });

  it("AC4: a `## <version>` heading line carries no marker phrase and stays unreported, exactly as before", () => {
    const headingOnly = "## 8.4.2 - 2026-01-01\n";
    expect(verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: headingOnly }, "1.0.0", "1.0.0")).toEqual([]);
  });

  it("AC5: identical marker-bearing text in a scanned file with no release headings is still reported", () => {
    const result = runVerifyPackProcess({
      "README.md": "Bump public version to 8.4.2 for internal tooling.\n"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("README.md: stale version reference 8.4.2");
  });

  it("AC8: the minimum compatible version stays allowed on every line, inside and outside a named section", () => {
    // CHANGELOG_STRUCTURE_FIXTURE embeds 0.4.5 (the real MINIMUM_COMPATIBLE_CHILD_MCP_VERSION)
    // once inside `## Unreleased` and once inside the `## 8.4.2` section; neither is reported.
    const findings = verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: CHANGELOG_STRUCTURE_FIXTURE }, "0.6.0");
    expect(findings.some((f: string) => f.includes("0.4.5"))).toBe(false);
  });

  it("Functional 9: adds no off-switch parameter or environment read to the exported scan", () => {
    const source = verifyPack.findStaleVersionReferences.toString();
    expect(source).not.toMatch(/process\.env/);
    const params = source
      .slice(source.indexOf("(") + 1, source.indexOf(")"))
      .split(",")
      .map((s: string) => s.trim());
    expect(params).toEqual([
      "fileTextByPath",
      "currentVersion",
      "minimumCompatibleVersion = MINIMUM_COMPATIBLE_CHILD_MCP_VERSION"
    ]);
    expect(verifyPack.releaseSectionVersionByLine.toString()).not.toMatch(/process\.env/);
    expect(verifyPack.releaseSectionVersionByLine.toString()).not.toMatch(/["']0\.6\.0["']/);
  });
});

// ---------------------------------------------------------------------------
// AC12 / Functional 12 -- simulated-bump proof against the REAL on-disk
// scanned files. The bumped version is derived from the package version at
// test time, never hardcoded. The same simulation at the pre-change baseline
// produced exactly one finding (the CHANGELOG's own 0.6.0 entry); after this
// story it must produce zero, while a genuinely stale reference injected into
// `## Unreleased` must still be caught.
// ---------------------------------------------------------------------------

describe("simulated-bump proof (STORY-REL070-003, AC12/Functional 12)", () => {
  it("turns the single baseline CHANGELOG finding into zero, while still catching a stale Unreleased reference", () => {
    const currentVersion: string = packageJson.version;
    const versionParts = currentVersion.split(".").map(Number);
    const bumpedVersion = `${versionParts[0]}.${versionParts[1] + 1}.0`;
    expect(bumpedVersion).not.toBe(currentVersion);

    const realFiles = publicVersionFilesFromDisk();
    const bumpedFiles = Object.fromEntries(
      Object.entries(realFiles).map(([file, text]) =>
        file === CHANGELOG_FILE ? [file, text] : [file, text.split(currentVersion).join(bumpedVersion)]
      )
    );

    expect(verifyPack.findStaleVersionReferences(bumpedFiles, bumpedVersion)).toEqual([]);

    const injectedLine = "- server version 4.2.1 is a deliberately injected stale reference for this test.";
    const changelogWithInjectedStale = bumpedFiles[CHANGELOG_FILE].replace(
      "## Unreleased\n",
      `## Unreleased\n\n${injectedLine}\n`
    );
    const bumpedFilesWithInjectedStale = { ...bumpedFiles, [CHANGELOG_FILE]: changelogWithInjectedStale };

    expect(verifyPack.findStaleVersionReferences(bumpedFilesWithInjectedStale, bumpedVersion)).toEqual([
      `${CHANGELOG_FILE}: stale version reference 4.2.1`
    ]);

    // The real CHANGELOG on disk is never written by this test.
    expect(readFileSync(new URL(CHANGELOG_FILE, REPO_ROOT), "utf8")).toBe(realFiles[CHANGELOG_FILE]);
  });
});

// ---------------------------------------------------------------------------
// Round-2 hardening -- two edge shapes that previously FAILED OPEN (granted an
// exemption a stricter reading would refuse). Both changes are strictly
// narrowing: a version reference that was already reported stays reported;
// only a previously-silenced case can newly become a finding.
// ---------------------------------------------------------------------------

describe("fenced code blocks never establish a changelog section heading (round 2, edge shape 1)", () => {
  it("does not let a `## <version>` line inside a fence exempt its own content, or content after the fence closes", () => {
    const text = [
      "# Changelog",
      "",
      "## Unreleased",
      "",
      "- server version 8.4.9 must be reported (outside any fence).",
      "",
      "```markdown",
      "## 0.7.5 - 2026-02-02",
      "- Bump public version to 0.7.5 across doctrine headers.",
      "```",
      "",
      "- public version 0.7.5 mentioned again, still inside Unreleased, still reported.",
      ""
    ].join("\n");

    // Under the pre-round-2 code this fixture produced exactly ONE finding
    // (8.4.9): the fenced example heading incorrectly exempted both 0.7.5
    // mentions. It must now produce all three.
    expect(verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: text }, "0.6.0")).toEqual([
      `${FIXTURE_FILE}: stale version reference 8.4.9`,
      `${FIXTURE_FILE}: stale version reference 0.7.5`,
      `${FIXTURE_FILE}: stale version reference 0.7.5`
    ]);
  });

  it("a closing fence must be the SAME character and AT LEAST the same length as the opener", () => {
    const shorterCloseDoesNotClose = [
      "# Changelog",
      "",
      "## Unreleased",
      "",
      "````",
      "## 0.5.1 - 2026-05-01",
      "``",
      "- public version 0.5.1 still inside the still-open longer fence.",
      "````",
      "",
      "- public version 0.5.1 after the fence closes, still Unreleased, still reported.",
      ""
    ].join("\n");
    expect(verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: shorterCloseDoesNotClose }, "0.6.0")).toEqual([
      `${FIXTURE_FILE}: stale version reference 0.5.1`,
      `${FIXTURE_FILE}: stale version reference 0.5.1`
    ]);

    const differentCharacterDoesNotClose = [
      "# Changelog",
      "",
      "## Unreleased",
      "",
      "```",
      "~~~",
      "## 0.5.2 - 2026-06-01",
      "- public version 0.5.2 still inside the backtick fence.",
      "```",
      "",
      "- public version 0.5.2 after fence closes, still reported.",
      ""
    ].join("\n");
    expect(verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: differentCharacterDoesNotClose }, "0.6.0")).toEqual([
      `${FIXTURE_FILE}: stale version reference 0.5.2`,
      `${FIXTURE_FILE}: stale version reference 0.5.2`
    ]);
  });

  it("a real heading after a closed fence resumes normal historical tracking", () => {
    const text = [
      "# Changelog",
      "",
      "## Unreleased",
      "",
      "```",
      "## 0.5.1 - 2026-05-01",
      "```",
      "",
      "## 6.6.6 - 2026-07-01",
      "",
      "- Bump public version to 6.6.6 across doctrine headers."
    ].join("\n");
    // The fenced fake heading changes nothing; the real `## 6.6.6` heading
    // after it still establishes a genuine, working historical exemption.
    expect(verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: text }, "0.6.0")).toEqual([]);
  });
});

describe("a pre-release or build-metadata heading version never exempts the bare version (round 2, edge shape 2)", () => {
  it("`## 0.9.3-rc.1` does not exempt a bare 0.9.3 reference inside its section", () => {
    const text = [
      "# Changelog",
      "",
      "## 0.9.3-rc.1 - 2026-03-01",
      "",
      "- Bump public version to 0.9.3 across doctrine headers.",
      ""
    ].join("\n");
    expect(verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: text }, "0.6.0")).toEqual([
      `${FIXTURE_FILE}: stale version reference 0.9.3`
    ]);
  });

  it("`## 2.1.0+build.7` (build metadata) does not exempt a bare 2.1.0 reference inside its section", () => {
    const text = [
      "# Changelog",
      "",
      "## 2.1.0+build.7 - 2026-04-01",
      "",
      "- server version 2.1.0 changed.",
      ""
    ].join("\n");
    expect(verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: text }, "0.6.0")).toEqual([
      `${FIXTURE_FILE}: stale version reference 2.1.0`
    ]);
  });

  it("contrasts with a bare (non-suffixed) heading, which still exempts its own version as before", () => {
    const text = [
      "# Changelog",
      "",
      "## 5.5.5-rc.1 - 2026-08-01",
      "",
      "- Bump public version to 5.5.5 across doctrine headers.",
      "",
      "## 5.5.4 - 2026-07-01",
      "",
      "- Bump public version to 5.5.4 across doctrine headers.",
      ""
    ].join("\n");
    const findings = verifyPack.findStaleVersionReferences({ [FIXTURE_FILE]: text }, "0.6.0");
    expect(findings).toContain(`${FIXTURE_FILE}: stale version reference 5.5.5`);
    expect(findings).not.toContain(`${FIXTURE_FILE}: stale version reference 5.5.4`);
  });
});
