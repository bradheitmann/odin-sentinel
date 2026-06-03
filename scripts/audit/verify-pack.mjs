import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  "protocol/bootstrap-skill.md"
];

const requiredTemplateFiles = [
  "templates/dev-slice-template.md",
  "templates/qa-slice-template.md",
  "templates/pm-role-template.md",
  "templates/team-manifest-template.yaml"
];

export const requiredPackageFiles = [
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
  ...requiredProtocolFiles,
  ...requiredTemplateFiles,
  "scripts/audit/public-surface.mjs",
  "scripts/audit/verify-pack.mjs",
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

const forbiddenPackagePrefixes = ["project/" + "planning" + "/", "." + "edge-" + "agentic" + "/local/"];
const forbiddenPackagedContentRules = [
  { name: "local evidence path", pattern: new RegExp(`\\.${"edge-" + "agentic"}/local`, "i") },
  { name: "local ODIN audit path", pattern: /\.odin\/local\//i },
  { name: "private planning path", pattern: new RegExp(`project/${"planning"}/`, "i") },
  { name: "macOS home path", pattern: new RegExp(`/${"Users"}/[A-Za-z0-9._-]+/`) },
  { name: "Linux home path", pattern: /\/home\/[A-Za-z0-9._-]+\// },
  { name: "secret-looking assignment", pattern: /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']+["']/i }
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
  for (const file of ["docs", "protocol", "templates", "AGENTS.md", "CLAUDE.md", "README.md", "LICENSE"]) {
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

export function validatePackFileList(pathsInput) {
  const paths = asPathSet(pathsInput);
  const errors = [];
  const missing = requiredPackageFiles.filter((file) => !paths.has(file));
  if (missing.length > 0) errors.push(`Package is missing required files: ${missing.join(", ")}`);

  const stale = staleBuildFiles.filter((file) => paths.has(file));
  if (stale.length > 0) errors.push(`Package includes stale build files: ${stale.join(", ")}`);

  const privatePaths = Array.from(paths).filter((file) => forbiddenPackagePrefixes.some((prefix) => file.startsWith(prefix)));
  if (privatePaths.length > 0) errors.push(`Package includes private local paths: ${privatePaths.join(", ")}`);

  return errors;
}

export function validatePackFileContents(fileTextByPath) {
  const findings = [];
  for (const [file, text] of Object.entries(fileTextByPath)) {
    for (const rule of forbiddenPackagedContentRules) {
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

  if (manifest.version !== currentVersion) {
    errors.push(`Claude plugin manifest version ${manifest.version ?? "<missing>"} must match package version ${currentVersion}`);
  }
  const server = manifest.mcpServers?.["odin-sentinel"];
  if (!server) {
    errors.push("Claude plugin manifest missing odin-sentinel MCP server");
  } else {
    if (server.command !== "npx") errors.push("Claude plugin odin-sentinel server must use npx");
    const args = Array.isArray(server.args) ? server.args : [];
    for (const requiredArg of ["-y", "-p", "@bradheitmann/odin-sentinel", "odin-sentinel-mcp"]) {
      if (!args.includes(requiredArg)) errors.push(`Claude plugin odin-sentinel args missing ${requiredArg}`);
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
    "protocol/SCP.md",
    "protocol/bootstrap-skill.md",
    "plugins/sentinel-coordination-protocol/.claude-plugin/plugin.json",
    "plugins/sentinel-coordination-protocol/skills/sentinel-coordination-protocol/SKILL.md",
    "plugins/sentinel-coordination-protocol/README.md"
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
    ...validatePublicProtocolSync({
      scpText: publicVersionFiles["protocol/SCP.md"],
      bootstrapText: publicVersionFiles["protocol/bootstrap-skill.md"],
      currentVersion: packageJson.version
    }),
    ...validatePluginSync({
      pluginManifestText: publicVersionFiles["plugins/sentinel-coordination-protocol/.claude-plugin/plugin.json"],
      pluginSkillText: publicVersionFiles["plugins/sentinel-coordination-protocol/skills/sentinel-coordination-protocol/SKILL.md"],
      pluginReadmeText: publicVersionFiles["plugins/sentinel-coordination-protocol/README.md"],
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
