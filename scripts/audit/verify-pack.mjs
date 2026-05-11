import { execFileSync } from "node:child_process";

const output = execFileSync("pnpm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});

// pnpm 11 writes JSON directly to stdout (no preamble); pnpm <=10 prefixed
// it with lifecycle logs. Handle both shapes: take from "\n{" if present, or
// from the start if output already begins with "{".
const newlineBrace = output.lastIndexOf("\n{");
const jsonStart = newlineBrace !== -1 ? newlineBrace + 1 : (output.trimStart().startsWith("{") ? output.indexOf("{") : -1);
if (jsonStart === -1) {
  throw new Error("pnpm pack did not return JSON metadata");
}

const pack = JSON.parse(output.slice(jsonStart));
const paths = new Set(pack.files.map((file) => file.path));

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

const requiredFiles = [
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
  "scripts/audit/public-surface.mjs",
  "scripts/audit/verify-pack.mjs",
  "README.md",
  "LICENSE",
  "package.json"
];

const missing = requiredFiles.filter((file) => !paths.has(file));
if (missing.length > 0) {
  throw new Error(`Package is missing required files: ${missing.join(", ")}`);
}

const staleFiles = [
  "dist/src/index.js",
  "dist/src/server.js",
  "dist/src/protocol.js",
  "dist/src/protocol-repository.js",
  "dist/src/validators.js"
].filter((file) => paths.has(file));

if (staleFiles.length > 0) {
  throw new Error(`Package includes stale build files: ${staleFiles.join(", ")}`);
}

console.log(`Package smoke PASS: ${pack.files.length} files included in ${pack.filename}`);
