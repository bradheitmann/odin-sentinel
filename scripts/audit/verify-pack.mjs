import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const MINIMUM_COMPATIBLE_CHILD_MCP_VERSION = "0.4.5";

const requiredProtocolFiles = [
  "protocol/SCP.md",
  "protocol/roles.yaml",
  "protocol/topology.yaml",
  "protocol/model-profiles.yaml",
  "protocol/closeout.yaml",
  "protocol/delegation.yaml",
  "protocol/receipts/boot-receipt.yaml",
  "protocol/receipts/team-manifest.yaml",
  "protocol/receipts/harness-probe-matrix.yaml",
  "protocol/resources/step-up-ladder.yaml",
  "protocol/resources/recipe-capture.yaml",
  "protocol/resources/qa-independence.yaml",
  "protocol/resources/commit-gate.yaml",
  "protocol/resources/harness-control-matrix.yaml",
  "protocol/resources/authority-chain.yaml",
  "protocol/resources/blocked-pod-rollover.yaml",
  "protocol/resources/slice-health-sentinels.yaml",
  "protocol/resources/pod-bringup.yaml",
  "protocol/resources/governance-overhead-budget.yaml",
  "protocol/resources/meta-governance-depth.yaml",
  "protocol/resources/proof-ttl.yaml",
  "protocol/bootstrap-skill.md",
  "protocol/skill-references/boot-receipt-examples.md",
  "protocol/skill-references/canonical-introduction-prompt.md",
  "protocol/skill-references/harness-skill-targets.md",
  "protocol/skill-references/team-bootstrap-runbook.md",
  "protocol/role-cards/exec-pm.md",
  "protocol/role-cards/team-pm.md",
  "protocol/role-cards/dev-worker.md",
  "protocol/role-cards/qa-worker.md",
  "protocol/role-cards/exec-asst.md",
  "protocol/role-cards/crush-stability.md",
  "protocol/role-cards/mission-droid.md",
  "protocol/role-cards/shadow.md",
  "protocol/mission-frontrun/orchestrator-contract.md",
  "protocol/mission-frontrun/worker-contract.md",
  "protocol/mission-frontrun/scrutiny-validator-contract.md",
  "protocol/mission-frontrun/scrutiny-feature-reviewer-contract.md",
  "protocol/mission-frontrun/droids-scrutiny-feature-reviewer.md"
];

const requiredTemplateFiles = [
  "templates/dev-slice-template.md",
  "templates/qa-slice-template.md",
  "templates/pm-role-template.md",
  "templates/team-manifest-template.yaml"
];

export const requiredPackageFiles = [
  ".claude-plugin/marketplace.json",
  "dist/src/bin/index.js",
  "dist/src/mcp/server.js",
  "dist/src/protocol/index.js",
  "dist/src/protocol/service.js",
  "dist/src/protocol/repository.js",
  "dist/src/protocol/schemas.js",
  "dist/src/protocol/validators.js",
  "dist/src/protocol/version.js",
  "docs/guides/quick-start.md",
  "docs/guides/quickstart-prompts.md",
  "docs/guides/recommended-starter-team.md",
  "docs/reference/client-compatibility.md",
  "docs/reference/cost-and-privacy.md",
  "docs/reference/distribution.md",
  "docs/reference/public-surface-audit.md",
  "docs/lattice/odin-lattice-design.md",
  "docs/adapters/cmux-adapter.md",
  "docs/adapters/tmux-adapter.md",
  "docs/adapters/minimux-adapter.md",
  "docs/adapters/herdr-adapter.md",
  "docs/adapters/plain-terminal.md",
  ...requiredProtocolFiles,
  "plugins/odin-scp/.claude-plugin/plugin.json",
  "plugins/odin-scp/skills/odin-scp/SKILL.md",
  "plugins/odin-scp/skills/odin-scp/CHANGELOG.md",
  "plugins/odin-scp/skills/odin-scp/agents/openai.yaml",
  "plugins/odin-scp/skills/odin-scp/references/boot-receipt-examples.md",
  "plugins/odin-scp/skills/odin-scp/references/canonical-introduction-prompt.md",
  "plugins/odin-scp/skills/odin-scp/references/harness-skill-targets.md",
  "plugins/odin-scp/skills/odin-scp/references/team-bootstrap-runbook.md",
  "plugins/odin-scp/skills/odin-scp/scripts/sync-installations.sh",
  "plugins/odin-scp/skills/bulk-migration/SKILL.md",
  "plugins/odin-scp/README.md",
  ...requiredTemplateFiles,
  "scripts/audit/audit-exceptions.json",
  "scripts/audit/dependency-audit.mjs",
  "scripts/audit/doctrine-currency-exceptions.json",
  "scripts/audit/doctrine-currency.mjs",
  "scripts/audit/generate-govdisp-baseline.mjs",
  "scripts/audit/public-surface.mjs",
  "scripts/audit/verify-pack.mjs",
  "scripts/protocol/cmux-send-governed.sh",
  "scripts/protocol/install-activation-hooks.mjs",
  "scripts/protocol/verify-governed-context.mjs",
  "scripts/protocol/verify-instruction-read.mjs",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "LICENSE",
  "package.json"
];

const staleBuildFiles = [
  "dist/src/index.js",
  "dist/src/server.js",
  "dist/src/protocol.js",
  "dist/src/protocol-repository.js",
  "dist/src/validators.js"
];

const protocolResourceVersionLockedFiles = new Set([
  "protocol/SCP.md",
  "protocol/closeout.yaml",
  "protocol/delegation.yaml",
  "protocol/model-profiles.yaml",
  "protocol/roles.yaml",
  "protocol/topology.yaml"
]);

const forbiddenPackagePrefixes = ["docs/handoffs/", "project/" + "planning" + "/", "." + "edge-" + "agentic" + "/local/"];
const AUDIT_SCRIPT_EXEMPTIONS = new Set(["scripts/audit/public-surface.mjs", "scripts/audit/verify-pack.mjs"]);
const INTERNAL_HANDOFF_REFERENCE_EXEMPTIONS = new Set([...AUDIT_SCRIPT_EXEMPTIONS, "docs/reference/distribution.md"]);
const forbiddenPackagedContentRules = [
  { name: "local evidence path", pattern: new RegExp(`\\.${"edge-" + "agentic"}/local`, "i") },
  { name: "local ODIN audit path", pattern: /\.odin\/local\//i },
  { name: "private planning path", pattern: new RegExp(`project/${"planning"}/`, "i") },
  { name: "internal handoff path reference", pattern: /docs\/handoffs\//i, exemptFiles: INTERNAL_HANDOFF_REFERENCE_EXEMPTIONS },
  { name: "macOS home path", pattern: new RegExp(`/${"Users"}/[A-Za-z0-9._-]+/`) },
  { name: "Linux home path", pattern: /\/home\/[A-Za-z0-9._-]+\// },
  { name: "secret-looking quoted assignment", pattern: /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']+["']/i },
  { name: "secret-looking unquoted assignment", pattern: /(api[_-]?key|secret|token|password)\s*[:=]\s*[A-Za-z0-9._~+/=-]{16,}/i },
  { name: "bearer token literal", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i },
  { name: "URI credential literal", pattern: /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/i }
];

function asPathSet(paths) {
  return new Set(Array.from(paths));
}

export function validatePackageMetadata(packageJson) {
  const errors = [];
  if (!packageJson.repository?.url) errors.push("package.json missing repository.url");
  if (!packageJson.homepage) errors.push("package.json missing homepage");
  if (!packageJson.bugs?.url) errors.push("package.json missing bugs.url");
  if (!packageJson.license) errors.push("package.json missing license");
  if (!packageJson.engines?.node) errors.push("package.json missing engines.node");
  if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) errors.push("package.json missing files allowlist");
  if (packageJson.scripts?.prepublishOnly !== "pnpm run validate") {
    errors.push("package.json prepublishOnly must run pnpm run validate");
  }
  for (const file of [".claude-plugin", "docs", "plugins", "protocol", "templates", "AGENTS.md", "CLAUDE.md", "README.md", "LICENSE"]) {
    if (!packageJson.files?.includes(file)) errors.push(`package.json files allowlist missing ${file}`);
  }
  if (packageJson.odin?.publicVersion !== packageJson.version) {
    errors.push("package.json odin.publicVersion must match package version");
  }
  if (packageJson.odin?.minimumCompatibleChildMcpVersion !== MINIMUM_COMPATIBLE_CHILD_MCP_VERSION) {
    errors.push("package.json odin.minimumCompatibleChildMcpVersion drifted");
  }
  for (const [name, version] of Object.entries(packageJson.dependencies ?? {})) {
    if (typeof version !== "string" || /^[~^]/.test(version) || /[<>=*x|]/i.test(version)) {
      errors.push(`package.json runtime dependency ${name} must be pinned exactly`);
    }
  }
  return errors;
}

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walkFiles(path) : [path];
  });
}

/**
 * Mechanically derive dist seed JSON paths from current source seeds only.
 * Each src/harness-pacing/seeds/<name>.json maps solely to
 * dist/src/harness-pacing/seeds/<name>.json — no hardcoded seed names.
 */
function expectedGeneratedDistSeedJsonFiles() {
  const expected = new Set();
  const seedDir = join("src", "harness-pacing", "seeds");
  if (!existsSync(seedDir)) return expected;
  for (const entry of readdirSync(seedDir)) {
    if (!entry.endsWith(".json")) continue;
    const srcPath = join(seedDir, entry);
    if (!statSync(srcPath).isFile()) continue;
    expected.add(`dist/src/harness-pacing/seeds/${entry}`);
  }
  return expected;
}

function expectedGeneratedDistFiles() {
  const expected = new Set();
  for (const file of walkFiles("src")) {
    if (!file.endsWith(".ts") || file.endsWith(".d.ts")) continue;
    const jsFile = file.replace(/^src\//, "dist/src/").replace(/\.ts$/, ".js");
    expected.add(jsFile);
    expected.add(`${jsFile}.map`);
    expected.add(jsFile.replace(/\.js$/, ".d.ts"));
  }
  for (const seedPath of expectedGeneratedDistSeedJsonFiles()) {
    expected.add(seedPath);
  }
  return expected;
}

function allowedGeneratedDistFiles() {
  return new Set([...requiredPackageFiles.filter((file) => file.startsWith("dist/")), ...expectedGeneratedDistFiles()]);
}

export function validatePackFileList(pathsInput) {
  const paths = asPathSet(pathsInput);
  const errors = [];
  const missing = requiredPackageFiles.filter((file) => !paths.has(file));
  if (missing.length > 0) errors.push(`Package is missing required files: ${missing.join(", ")}`);

  const stale = staleBuildFiles.filter((file) => paths.has(file));
  if (stale.length > 0) errors.push(`Package includes stale build files: ${stale.join(", ")}`);

  const privatePaths = Array.from(paths).filter((file) => forbiddenPackagePrefixes.some((prefix) => file.startsWith(prefix)));
  if (privatePaths.length > 0) errors.push(`Package includes private local paths: ${privatePaths.join(", ")}`);

  const allowed = new Set([...requiredPackageFiles, ...allowedGeneratedDistFiles()]);
  const unexpected = Array.from(paths).filter((file) => !allowed.has(file));
  if (unexpected.length > 0) errors.push(`Package includes unexpected files: ${unexpected.join(", ")}`);

  return errors;
}

export function validatePackFileContents(fileTextByPath) {
  const findings = [];
  for (const [file, text] of Object.entries(fileTextByPath)) {
    for (const rule of forbiddenPackagedContentRules) {
      if (rule.exemptFiles?.has(file)) continue;
      if (rule.pattern.test(text)) findings.push(`${file}: ${rule.name}`);
    }
  }
  return findings;
}

function isTextPackageFile(file) {
  return /\.(js|mjs|cjs|ts|json|md|ya?ml|txt|html|css|sh)$/.test(file) || !file.includes(".");
}

function readPackFileTexts(paths) {
  return Object.fromEntries(
    paths
      .filter(isTextPackageFile)
      .flatMap((file) => {
        try {
          return [[file, readFileSync(file, "utf8")]];
        } catch {
          return [];
        }
      })
  );
}

// A release section in any scanned file describes the version its own `## `
// heading names. This is a purely structural read of the document: the
// version bound to line N is whatever bare version appears in the nearest
// `## ` heading at or above line N, or null if that heading names no bare
// version (for example an unreleased/untitled section heading, or a heading
// whose version is qualified by a pre-release or build-metadata suffix) or
// no `## ` heading precedes the line at all. No file path, file name, or
// version literal is consulted here -- any file shaped this way gets the
// same read, and a file with no such heading yields null for every line,
// which is exactly today's behavior.
//
// A `## ` line that appears INSIDE a fenced code block is example text, not a
// real release heading, and must not establish or change the enclosing
// section. Fence state is tracked with the same open/close rule Markdown
// itself uses: a fence opens on a line (after up to 3 leading spaces) of 3+
// backticks or 3+ tildes, optionally followed by an info string, and closes
// only on a later line (after up to 3 leading spaces) consisting solely of
// the SAME fence character repeated at least as many times as the opener --
// a shorter or differently-charactered run of fence characters does not
// close it. Content lines inside a fence are otherwise scanned exactly as
// today; only heading recognition is suppressed there.
const RELEASE_HEADING_LINE_PATTERN = /^##[ \t]+/;
// The negative lookahead refuses to bind a heading's version when it is
// immediately followed by a pre-release or build-metadata delimiter: such a
// heading does not name the bare version, so no bare-version exemption may
// be derived from it. This is a structural read of the heading text itself,
// never a literal version comparison.
const RELEASE_HEADING_VERSION_PATTERN = /^##[ \t]+.*?\b(\d+\.\d+\.\d+)\b(?![-+])/;
const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_LINE_PATTERN = /^ {0,3}(`+|~+)[ \t]*$/;

export function releaseSectionVersionByLine(text) {
  const lines = text.split("\n");
  const sectionVersionByLine = new Array(lines.length).fill(null);
  let enclosingVersion = null;
  let openFence = null; // { char, length } while inside a fenced code block

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (openFence) {
      const closeMatch = line.match(FENCE_CLOSE_LINE_PATTERN);
      if (closeMatch && closeMatch[1][0] === openFence.char && closeMatch[1].length >= openFence.length) {
        openFence = null;
      }
      sectionVersionByLine[index] = enclosingVersion;
      continue;
    }

    const openMatch = line.match(FENCE_OPEN_PATTERN);
    if (openMatch) {
      openFence = { char: openMatch[1][0], length: openMatch[1].length };
      sectionVersionByLine[index] = enclosingVersion;
      continue;
    }

    if (RELEASE_HEADING_LINE_PATTERN.test(line)) {
      const headingMatch = line.match(RELEASE_HEADING_VERSION_PATTERN);
      enclosingVersion = headingMatch ? headingMatch[1] : null;
    }
    sectionVersionByLine[index] = enclosingVersion;
  }

  return sectionVersionByLine;
}

export function findStaleVersionReferences(fileTextByPath, currentVersion, minimumCompatibleVersion = MINIMUM_COMPATIBLE_CHILD_MCP_VERSION) {
  const allowed = new Set([currentVersion, minimumCompatibleVersion]);
  const findings = [];
  const versionPattern = /\b\d+\.\d+\.\d+\b/g;
  const relevantVersionLine = (line) => {
    const lower = line.toLowerCase();
    if (/\bnode\.?js\b/.test(lower) || /\bengines?\b/.test(lower)) return false;
    if (/^version:\s*\d+\.\d+\.\d+\s*$/.test(line.trim())) return false;
    return [
      "odin-sentinel",
      "serverinfo",
      "package/server",
      "public version",
      "minimum compatible",
      "compatible child mcp",
      "mcp version",
      "server version",
      "expected version",
      "stale mcp version",
      "confirm >=",
      "server "
    ].some((marker) => lower.includes(marker));
  };

  for (const [file, text] of Object.entries(fileTextByPath)) {
    const lines = text.split("\n");
    const sectionVersionByLine = releaseSectionVersionByLine(text);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!relevantVersionLine(line)) continue;
      const matches = line.match(versionPattern) ?? [];
      for (const version of matches) {
        if (allowed.has(version)) continue;
        if (version === sectionVersionByLine[index]) continue;
        findings.push(`${file}: stale version reference ${version}`);
      }
    }
  }

  return findings;
}

export function findUnpinnedInstallReferences(fileTextByPath, currentVersion) {
  const findings = [];
  const packageName = "@bradheitmann/odin-sentinel";
  const pinned = `${packageName}@${currentVersion}`;
  const commandMarkers = [
    "pnpm",
    "npx",
    "npm",
    "claude mcp",
    "--package",
    "installurl",
    "\"args\"",
    "args =",
    "command"
  ];

  for (const [file, text] of Object.entries(fileTextByPath)) {
    if (AUDIT_SCRIPT_EXEMPTIONS.has(file)) continue;
    const lines = text.split("\n");
    // A changelog's earlier release sections are history: they name the version
    // they shipped and never change afterwards, so only the section for the
    // current version (and any text above the first release heading) is checked.
    const isChangelog = file === "CHANGELOG.md" || file.endsWith("/CHANGELOG.md");
    let inPastRelease = false;
    for (const [index, line] of lines.entries()) {
      if (isChangelog) {
        const heading = /^## +v?(\d+\.\d+\.\d+\S*)/.exec(line);
        if (heading) inPastRelease = heading[1] !== currentVersion;
        if (inPastRelease) continue;
      }
      if (!line.includes(packageName)) continue;
      const windowText = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join(" ");
      const lowerWindow = windowText.toLowerCase();
      if (!commandMarkers.some((marker) => lowerWindow.includes(marker))) continue;
      if (windowText.includes(pinned)) continue;
      findings.push(`${file}:${index + 1}: install command must pin ${pinned}`);
    }
  }

  return findings;
}

export function validateRuntimeVersionConstants(versionText, currentVersion, minimumCompatibleVersion = MINIMUM_COMPATIBLE_CHILD_MCP_VERSION, file = "src/protocol/version.ts") {
  const errors = [];
  const required = [
    [`PROTOCOL_SCHEMA_VERSION`, currentVersion],
    [`PUBLIC_LATEST_VERSION`, currentVersion],
    [`MINIMUM_COMPATIBLE_MCP_VERSION`, minimumCompatibleVersion]
  ];

  for (const [constant, expected] of required) {
    const pattern = new RegExp(`\\b${constant}\\s*=\\s*["']${expected.replaceAll(".", "\\.")}["']`);
    if (!pattern.test(versionText)) {
      errors.push(`${file}: ${constant} must be ${expected}`);
    }
  }

  return errors;
}

export function validatePublicProtocolSync({ scpText, bootstrapText, currentVersion, minimumCompatibleVersion = MINIMUM_COMPATIBLE_CHILD_MCP_VERSION }) {
  const errors = [];
  const requiredMarkers = [
    `SCP_PUBLIC_VERSION: ${currentVersion}`,
    `MIN_COMPATIBLE_CHILD_MCP: ${minimumCompatibleVersion}`
  ];

  for (const marker of requiredMarkers) {
    if (!scpText.includes(marker)) errors.push(`protocol/SCP.md missing ${marker}`);
    if (!bootstrapText.includes(marker)) errors.push(`protocol/bootstrap-skill.md missing ${marker}`);
  }

  return errors;
}

export function extractToolCount(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/(\d+)\s+(?:`?odin\.\*`?\s+)?tools\b/i);
  return match ? Number(match[1]) : null;
}

export function validatePluginSync({ pluginManifestText, pluginSkillText, pluginReadmeText, currentVersion, minimumCompatibleVersion = MINIMUM_COMPATIBLE_CHILD_MCP_VERSION, expectedToolCount }) {
  const errors = [];
  let manifest;
  try {
    manifest = JSON.parse(pluginManifestText);
  } catch {
    errors.push("Claude plugin manifest must be valid JSON");
    manifest = {};
  }

  if (manifest.name !== "odin-scp") {
    errors.push(`Claude plugin manifest name ${manifest.name ?? "<missing>"} must be odin-scp`);
  }
  if (manifest.version !== currentVersion) {
    errors.push(`Claude plugin manifest version ${manifest.version ?? "<missing>"} must match package version ${currentVersion}`);
  }
  const server = manifest.mcpServers?.["odin-sentinel"];
  if (!server) {
    errors.push("Claude plugin manifest missing odin-sentinel MCP server");
  } else {
    if (server.command !== "pnpm") errors.push("Claude plugin odin-sentinel server must use pnpm");
    const args = Array.isArray(server.args) ? server.args : [];
    const expectedArgs = ["dlx", "--package", `@bradheitmann/odin-sentinel@${currentVersion}`, "odin-sentinel-mcp"];
    for (const requiredArg of expectedArgs) {
      if (!args.includes(requiredArg)) errors.push(`Claude plugin odin-sentinel args missing ${requiredArg}`);
    }
    if (JSON.stringify(args) !== JSON.stringify(expectedArgs)) {
      errors.push(`Claude plugin odin-sentinel args must exactly equal ${JSON.stringify(expectedArgs)}`);
    }
  }

  for (const marker of [`SCP_PUBLIC_VERSION: ${currentVersion}`, `MIN_COMPATIBLE_CHILD_MCP: ${minimumCompatibleVersion}`]) {
    if (!pluginSkillText.includes(marker)) errors.push(`Claude plugin skill missing ${marker}`);
  }
  const pluginToolCount = extractToolCount(pluginReadmeText);
  if (pluginToolCount === null) {
    errors.push("Claude plugin README must advertise its odin.* tool count");
  } else if (typeof expectedToolCount === "number" && pluginToolCount !== expectedToolCount) {
    errors.push(`Claude plugin README advertises ${pluginToolCount} odin.* tools but package.json describes ${expectedToolCount}`);
  }

  return errors;
}

export function validateMarketplaceSync({ marketplaceText, currentVersion }) {
  const errors = [];
  let marketplace;
  try {
    marketplace = JSON.parse(marketplaceText);
  } catch {
    errors.push("Claude marketplace manifest must be valid JSON");
    marketplace = {};
  }

  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const odinScp = plugins.find((plugin) => plugin?.name === "odin-scp");
  if (!odinScp) {
    errors.push("Claude marketplace manifest must advertise odin-scp");
  } else {
    if (odinScp.source !== "./plugins/odin-scp") {
      errors.push(`Claude marketplace odin-scp source ${odinScp.source ?? "<missing>"} must be ./plugins/odin-scp`);
    }
    if (odinScp.version !== currentVersion) {
      errors.push(`Claude marketplace odin-scp version ${odinScp.version ?? "<missing>"} must match package version ${currentVersion}`);
    }
  }

  const legacyName = `sentinel-${"coordination"}-${"protocol"}`;
  const legacySource = `./plugins/${legacyName}`;
  const staleLegacy = plugins.find((plugin) => plugin?.name === legacyName || plugin?.source === legacySource);
  if (staleLegacy) {
    errors.push("Claude marketplace manifest must not advertise the legacy long-name plugin");
  }

  return errors;
}

export function validatePackagedProtocolVersions(fileTextByPath, currentVersion) {
  const errors = [];
  for (const [file, text] of Object.entries(fileTextByPath)) {
    if (!protocolResourceVersionLockedFiles.has(file)) continue;
    const firstVersion = text.match(/^(?:version|Version):\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m);
    if (firstVersion && firstVersion[1] !== currentVersion) {
      errors.push(`${file}: protocol resource version ${firstVersion[1]} must match package version ${currentVersion}`);
    }
  }
  return errors;
}

export function validateBootstrapReadiness(bootstrapText) {
  const required = ["MCP server", "native skill", "full prompt fallback", "CMUX", "auth/account readiness", "local inference", "role compatibility"];
  return required.filter((term) => !bootstrapText.toLowerCase().includes(term.toLowerCase())).map((term) => `protocol/bootstrap-skill.md missing readiness term: ${term}`);
}

export function validateTelemetryWording(costPrivacyText) {
  const errors = [];
  if (/does not .*telemetry/i.test(costPrivacyText) && !/optional|user-invoked|not automatic/i.test(costPrivacyText)) {
    errors.push("Telemetry wording must explain optional/user-invoked behavior");
  }
  if (!/optional telemetry/i.test(costPrivacyText) || !/user-invoked/i.test(costPrivacyText)) {
    errors.push("Cost/privacy docs must describe optional user-invoked telemetry");
  }
  return errors;
}

/**
 * Version-surface convergence (STORY-REL070-002).
 *
 * The canonical skill and its whole-file mirror are one public surface with one
 * value: the frontmatter version, the body SCP_PUBLIC_VERSION marker, and the
 * package version must agree. Every rule below is fail-closed by construction —
 * an absent input is a NAMED refusal, never a skipped check — and every rule is
 * composed into runVerifyPack's error list, so a refusal reaches the operator as
 * a non-zero exit from the audit script, `test:package`, `validate`, and
 * `prepublishOnly` alike.
 */
export const SKILL_MIRROR_PAIR = ["plugins/odin-scp/skills/odin-scp/SKILL.md", "protocol/bootstrap-skill.md"];
export const INTRO_PROMPT_MIRROR_PAIR = [
  "plugins/odin-scp/skills/odin-scp/references/canonical-introduction-prompt.md",
  "protocol/skill-references/canonical-introduction-prompt.md"
];
export const MIRROR_PAIRS = [SKILL_MIRROR_PAIR, INTRO_PROMPT_MIRROR_PAIR];

/** Scanned for retired private-numbering wording. Replacement text is version-neutral. */
export const LEGACY_PROTOCOL_WORDING_SCANNED_FILES = [...SKILL_MIRROR_PAIR, ...INTRO_PROMPT_MIRROR_PAIR];

/**
 * Scanned for wording that grants a runtime skill copy permission to differ from
 * the canonical skill. Installed copies are synchronized snapshots; a copy that
 * differs is stale, not an intentional fork.
 */
export const FORK_PERMISSION_SCANNED_FILES = [...SKILL_MIRROR_PAIR, "protocol/SCP.md", ...INTRO_PROMPT_MIRROR_PAIR];

const LEGACY_PROTOCOL_WORDING_PATTERN = / *scp +v3(?:\.\d+)*/i;
const FORK_PERMISSION_PATTERN = /private +local +skill +copies +may +differ/i;
const FRONTMATTER_BLOCK_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const FRONTMATTER_VERSION_KEY_PATTERN = /^version:/;

/**
 * Invisible/format characters (Unicode Cf plus the soft hyphen and the
 * combining grapheme joiner). These render as nothing, so a reader cannot see
 * them, but they break a naive substring match.
 */
const INVISIBLE_FORMAT_PATTERN = /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;

/** Every Unicode whitespace form, folded to one ASCII space. */
const UNICODE_WHITESPACE_PATTERN = /[\t\n\v\f\r\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

/**
 * Folds scanned text before the wording checks so a disguise cannot smuggle the
 * prohibited wording past a literal match: NFKC collapses compatibility forms
 * (fullwidth letters, superscript digits, exotic spaces) onto their ordinary
 * equivalents, invisible format characters are removed, and every whitespace run
 * becomes a single ASCII space. The folded text is used for MATCHING ONLY and is
 * never written back to any file.
 *
 * Scope is disguise of the same wording, not paraphrase: a sentence that grants
 * divergence in different words is out of this check's declared reach and is
 * governed by review, not by this pattern.
 */
export function foldScannedText(text) {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE_FORMAT_PATTERN, "")
    .replace(UNICODE_WHITESPACE_PATTERN, " ");
}

export function parseSkillFrontmatterVersion(text, file) {
  if (typeof text !== "string") {
    return { errors: [`${file}: content unavailable for skill frontmatter version check`] };
  }
  const block = text.match(FRONTMATTER_BLOCK_PATTERN);
  if (!block) return { errors: [`${file}: skill frontmatter block is absent`] };

  // Collect EVERY version key, never just the first. A block carrying two
  // version keys has no single answer to "what version is this?", and YAML
  // prohibits duplicate keys outright, so it is refused rather than resolved by
  // match order. Keys outside the frontmatter block do not count: a version
  // relocated into the body leaves the frontmatter requirement unsatisfied.
  const versionLines = block[1].split(/\r?\n/).filter((line) => FRONTMATTER_VERSION_KEY_PATTERN.test(line));
  if (versionLines.length === 0) return { errors: [`${file}: skill frontmatter version key is absent`] };
  if (versionLines.length > 1) {
    return { errors: [`${file}: duplicate frontmatter version key (${versionLines.length} occurrences)`] };
  }

  const value = versionLines[0].slice("version:".length).trim().replace(/^["']|["']$/g, "");
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    return { errors: [`${file}: skill frontmatter version "${value}" is unparseable`] };
  }
  return { version: value, errors: [] };
}

export function validateSkillFrontmatterVersions({ skillText, bootstrapText, currentVersion }) {
  const [skillFile, bootstrapFile] = SKILL_MIRROR_PAIR;
  const errors = [];
  const parsed = {};

  for (const [file, text] of [[skillFile, skillText], [bootstrapFile, bootstrapText]]) {
    const result = parseSkillFrontmatterVersion(text, file);
    errors.push(...result.errors);
    if (result.version !== undefined) parsed[file] = result.version;
  }

  for (const file of SKILL_MIRROR_PAIR) {
    if (parsed[file] !== undefined && parsed[file] !== currentVersion) {
      errors.push(`${file}: skill frontmatter version ${parsed[file]} must match package version ${currentVersion}`);
    }
  }

  if (parsed[skillFile] !== undefined && parsed[bootstrapFile] !== undefined && parsed[skillFile] !== parsed[bootstrapFile]) {
    errors.push(`${skillFile} and ${bootstrapFile}: skill frontmatter versions disagree (${parsed[skillFile]} vs ${parsed[bootstrapFile]})`);
  }

  return errors;
}

export function findLegacyProtocolWording(fileTextByPath) {
  const findings = [];
  for (const file of LEGACY_PROTOCOL_WORDING_SCANNED_FILES) {
    const text = fileTextByPath[file];
    if (typeof text !== "string") {
      findings.push(`${file}: content unavailable for legacy protocol wording check`);
      continue;
    }
    const match = foldScannedText(text).match(LEGACY_PROTOCOL_WORDING_PATTERN);
    if (match) findings.push(`${file}: legacy protocol version wording "${match[0].trim()}" (matched in Unicode-folded text)`);
  }
  return findings;
}

export function findForkPermissionWording(fileTextByPath) {
  const findings = [];
  for (const file of FORK_PERMISSION_SCANNED_FILES) {
    const text = fileTextByPath[file];
    if (typeof text !== "string") {
      findings.push(`${file}: content unavailable for fork-permission check`);
      continue;
    }
    const match = foldScannedText(text).match(FORK_PERMISSION_PATTERN);
    if (match) findings.push(`${file}: fork-permission wording "${match[0]}" (matched in Unicode-folded text)`);
  }
  return findings;
}

export function validateMirrorPairParity(fileTextByPath) {
  const errors = [];
  for (const [left, right] of MIRROR_PAIRS) {
    const leftText = fileTextByPath[left];
    const rightText = fileTextByPath[right];
    let unavailable = false;
    for (const [file, text] of [[left, leftText], [right, rightText]]) {
      if (typeof text !== "string") {
        errors.push(`${file}: content unavailable for mirror parity check`);
        unavailable = true;
      }
    }
    if (unavailable) continue;
    if (leftText !== rightText) errors.push(`${left} and ${right}: mirror pair is not byte-identical`);
  }
  return errors;
}

export const PUBLIC_VERSION_FILES = [
  "README.md",
  "docs/guides/quick-start.md",
  "docs/guides/quickstart-prompts.md",
  "docs/reference/client-compatibility.md",
  "docs/reference/distribution.md",
  "docs/reference/public-surface-audit.md",
  "src/protocol/version.ts",
  ".claude-plugin/marketplace.json",
  "protocol/SCP.md",
  "protocol/bootstrap-skill.md",
  "protocol/skill-references/canonical-introduction-prompt.md",
  "plugins/odin-scp/.claude-plugin/plugin.json",
  "plugins/odin-scp/skills/odin-scp/SKILL.md",
  "plugins/odin-scp/skills/odin-scp/CHANGELOG.md",
  "plugins/odin-scp/skills/odin-scp/agents/openai.yaml",
  "plugins/odin-scp/skills/odin-scp/references/boot-receipt-examples.md",
  "plugins/odin-scp/skills/odin-scp/references/canonical-introduction-prompt.md",
  "plugins/odin-scp/skills/odin-scp/references/harness-skill-targets.md",
  "plugins/odin-scp/skills/odin-scp/references/team-bootstrap-runbook.md",
  "plugins/odin-scp/skills/odin-scp/scripts/sync-installations.sh",
  "plugins/odin-scp/README.md"
];

function readPublicVersionFiles() {
  return Object.fromEntries(PUBLIC_VERSION_FILES.map((file) => [file, readFileSync(file, "utf8")]));
}

function parsePackOutput(output) {
  const newlineBrace = output.lastIndexOf("\n{");
  const jsonStart = newlineBrace !== -1 ? newlineBrace + 1 : (output.trimStart().startsWith("{") ? output.indexOf("{") : -1);
  if (jsonStart === -1) throw new Error("pnpm pack did not return JSON metadata");
  return JSON.parse(output.slice(jsonStart));
}

export function runVerifyPack({ pack, packageJson, publicVersionFiles, costPrivacyText, packFileTextByPath }) {
  const packPaths = pack.files.map((file) => file.path);
  const packFileTexts = packFileTextByPath ?? readPackFileTexts(packPaths);

  // Version-surface convergence runs FIRST and short-circuits on an unavailable
  // input. An absent public-surface file is a named refusal in its own right;
  // it must never reach a downstream check that would dereference it and turn a
  // governance refusal into an incidental crash.
  const versionSurfaceErrors = [
    ...validateSkillFrontmatterVersions({
      skillText: publicVersionFiles[SKILL_MIRROR_PAIR[0]],
      bootstrapText: publicVersionFiles[SKILL_MIRROR_PAIR[1]],
      currentVersion: packageJson.version
    }),
    ...findLegacyProtocolWording(publicVersionFiles),
    ...findForkPermissionWording(publicVersionFiles),
    ...validateMirrorPairParity(publicVersionFiles)
  ];
  if (versionSurfaceErrors.some((error) => error.includes("content unavailable"))) {
    throw new Error(`Package release sync failed:\n${versionSurfaceErrors.join("\n")}`);
  }

  const errors = [
    ...validatePackageMetadata(packageJson),
    ...validatePackFileList(packPaths),
    ...validatePackFileContents(packFileTexts),
    ...validatePackagedProtocolVersions(packFileTexts, packageJson.version),
    ...findStaleVersionReferences(publicVersionFiles, packageJson.version),
    ...findUnpinnedInstallReferences(packFileTexts, packageJson.version),
    ...validateRuntimeVersionConstants(publicVersionFiles["src/protocol/version.ts"], packageJson.version),
    ...validateRuntimeVersionConstants(packFileTexts["dist/src/protocol/version.js"] ?? "", packageJson.version, MINIMUM_COMPATIBLE_CHILD_MCP_VERSION, "dist/src/protocol/version.js"),
    ...validatePublicProtocolSync({
      scpText: publicVersionFiles["protocol/SCP.md"],
      bootstrapText: publicVersionFiles["protocol/bootstrap-skill.md"],
      currentVersion: packageJson.version
    }),
    ...validateMarketplaceSync({
      marketplaceText: publicVersionFiles[".claude-plugin/marketplace.json"],
      currentVersion: packageJson.version
    }),
    ...validatePluginSync({
      pluginManifestText: publicVersionFiles["plugins/odin-scp/.claude-plugin/plugin.json"],
      pluginSkillText: publicVersionFiles["plugins/odin-scp/skills/odin-scp/SKILL.md"],
      pluginReadmeText: publicVersionFiles["plugins/odin-scp/README.md"],
      currentVersion: packageJson.version,
      expectedToolCount: extractToolCount(packageJson.description)
    }),
    ...versionSurfaceErrors,
    ...validateBootstrapReadiness(publicVersionFiles["protocol/bootstrap-skill.md"]),
    ...validateTelemetryWording(costPrivacyText)
  ];

  if (errors.length > 0) throw new Error(`Package release sync failed:\n${errors.join("\n")}`);
  return {
    fileCount: pack.files.length,
    filename: pack.filename,
    version: packageJson.version,
    minimumCompatibleChildMcpVersion: MINIMUM_COMPATIBLE_CHILD_MCP_VERSION
  };
}

export function main() {
  const output = execFileSync("pnpm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const pack = parsePackOutput(output);
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const publicVersionFiles = readPublicVersionFiles();
  const costPrivacyText = readFileSync("docs/reference/cost-and-privacy.md", "utf8");
  const result = runVerifyPack({ pack, packageJson, publicVersionFiles, costPrivacyText });

  console.log(`Package smoke PASS: ${result.fileCount} files included in ${result.filename}`);
  console.log(`Release sync PASS: public version ${result.version}; minimum compatible child MCP ${result.minimumCompatibleChildMcpVersion}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
