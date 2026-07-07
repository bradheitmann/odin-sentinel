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
  "protocol/resources/step-up-ladder.yaml",
  "protocol/resources/recipe-capture.yaml",
  "protocol/resources/qa-independence.yaml",
  "protocol/resources/commit-gate.yaml",
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
  "scripts/audit/public-surface.mjs",
  "scripts/audit/verify-pack.mjs",
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

function expectedGeneratedDistFiles() {
  const expected = new Set();
  for (const file of walkFiles("src")) {
    if (!file.endsWith(".ts") || file.endsWith(".d.ts")) continue;
    const jsFile = file.replace(/^src\//, "dist/src/").replace(/\.ts$/, ".js");
    expected.add(jsFile);
    expected.add(`${jsFile}.map`);
    expected.add(jsFile.replace(/\.js$/, ".d.ts"));
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
    for (const line of text.split("\n")) {
      if (!relevantVersionLine(line)) continue;
      const matches = line.match(versionPattern) ?? [];
      for (const version of matches) {
        if (!allowed.has(version)) findings.push(`${file}: stale version reference ${version}`);
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
    for (const [index, line] of lines.entries()) {
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

function readPublicVersionFiles() {
  return Object.fromEntries([
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
  ].map((file) => [file, readFileSync(file, "utf8")]));
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
