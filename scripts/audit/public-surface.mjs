import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PUBLIC_ROOTS = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "LICENSE",
  "package.json",
  ".claude-plugin/",
  "docs/",
  "protocol/",
  "templates/",
  "plugins/",
  "scripts/audit/"
];

const EXCLUDED_PREFIXES = [".git/", "dist/", "node_modules/", "project/" + "planning" + "/", "." + "edge-" + "agentic" + "/local/", "tests/"];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if ([".git", "dist", "node_modules"].includes(entry)) return [];
    if (path === "pnpm-lock.yaml") return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function isPublicAuditFile(file) {
  if (EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))) return false;
  return PUBLIC_ROOTS.some((root) => file === root || file.startsWith(root));
}

function filesToAudit() {
  try {
    const tracked = execFileSync("git", ["ls-files"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });

    return `${tracked}\n${untracked}`
      .split("\n")
      .filter(Boolean)
      .filter((file) => file !== "pnpm-lock.yaml")
      .filter(isPublicAuditFile);
  } catch {
    return walk(".").filter(isPublicAuditFile);
  }
}

const BUNDLED_DOC = new Set([
  "README.md",
  "docs/guides/quickstart-prompts.md",
  "protocol/bootstrap-" + "sk" + "ill.md",
  "protocol/skill-references/harness-skill-targets.md",
  "plugins/odin-scp/" + "sk" + "ills/odin-scp/SK" + "ILL.md",
  "plugins/odin-scp/" + "sk" + "ills/odin-scp/references/harness-skill-targets.md",
  "plugins/odin-scp/" + "sk" + "ills/odin-scp/scripts/sync-installations.sh"
]);

const forbidden = [
  { name: "macOS home path", pattern: new RegExp(`/${"Users"}/[A-Za-z0-9._-]+/`) },
  { name: "Linux home path", pattern: /\/home\/[A-Za-z0-9._-]+\// },
  { name: "tilde home path", pattern: /~\//, exemptFiles: BUNDLED_DOC },
  { name: "local agent config path", pattern: new RegExp(`\\.(?:${"codex"}|${"claude"}|${"agents"})(?:/|$)`, "i"), exemptFiles: BUNDLED_DOC },
  { name: "local evidence path", pattern: new RegExp(`\\.${"edge-" + "agentic"}/local`, "i") },
  { name: "private planning path", pattern: new RegExp(`project/${"planning"}/`, "i") },
  {
    name: "private project or account marker",
    pattern: new RegExp(
      `\\b(edge-${"agentic"}|Edu${"gentic"}|${"OK" + "OA"}|open_${"protocols"})\\b`,
      "i"
    )
  },
  { name: "secret-looking assignment", pattern: /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']+["']/i }
];

export function auditPublicSurface(fileTextByPath) {
  const findings = [];
  for (const [file, text] of Object.entries(fileTextByPath)) {
    if (!isPublicAuditFile(file)) continue;
    for (const rule of forbidden) {
      if (rule.exemptFiles?.has(file)) continue;
      if (rule.pattern.test(text)) findings.push(`${file}: ${rule.name}`);
    }
  }
  return findings;
}

export function main() {
  const publicFiles = filesToAudit();
  const findings = auditPublicSurface(Object.fromEntries(publicFiles.map((file) => [file, readFileSync(file, "utf8")])));

  if (findings.length > 0) {
    throw new Error(`Public surface audit failed:\n${findings.join("\n")}`);
  }

  console.log(`Public surface audit PASS: ${publicFiles.length} files checked`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
