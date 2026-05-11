import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if ([".git", "dist", "node_modules"].includes(entry)) return [];
    if (path === "pnpm-lock.yaml") return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
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
      .filter((file) => !file.startsWith("pnpm-lock.yaml"));
  } catch {
    return walk(".");
  }
}

const publicFiles = filesToAudit();

// Install and protocol documentation legitimately references agent harness
// config directories and tilde home paths. The path-style rules below skip
// these files; the rest of the rules still apply.
const BUNDLED_DOC = new Set([
  "README.md",
  "docs/guides/quickstart-prompts.md",
  "protocol/bootstrap-" + "sk" + "ill.md",
  "plugins/sentinel-coordination-protocol/" + "sk" + "ills/sentinel-coordination-protocol/SK" + "ILL.md"
]);

const forbidden = [
  { name: "macOS home path", pattern: new RegExp(`/${"Users"}/[A-Za-z0-9._-]+/`) },
  { name: "Linux home path", pattern: /\/home\/[A-Za-z0-9._-]+\// },
  { name: "tilde home path", pattern: /~\//, exemptFiles: BUNDLED_DOC },
  { name: "local agent config path", pattern: new RegExp(`\\.${"codex"}|\\.${"claude"}|\\.${"agents"}`, "i"), exemptFiles: BUNDLED_DOC },
  {
    name: "private project or account marker",
    pattern: new RegExp(
      `\\b(edge-${"agentic"}|Edu${"gentic"}|${"OK" + "OA"}|open_${"protocols"})\\b`,
      "i"
    )
  },
  { name: "secret-looking assignment", pattern: /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']+["']/i }
];

const findings = [];

for (const file of publicFiles) {
  const text = readFileSync(file, "utf8");
  for (const rule of forbidden) {
    if (rule.exemptFiles?.has(file)) continue;
    if (rule.pattern.test(text)) {
      findings.push(`${file}: ${rule.name}`);
    }
  }
}

if (findings.length > 0) {
  throw new Error(`Public surface audit failed:\n${findings.join("\n")}`);
}

console.log(`Public surface audit PASS: ${publicFiles.length} files checked`);
