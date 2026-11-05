import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_ROOTS = [
  "README.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "CLAUDE.md",
  "LICENSE",
  "package.json",
  ".claude-plugin/",
  "docs/",
  "protocol/",
  "templates/",
  "plugins/",
  "charter/",
  "crates/",
  "scripts/audit/"
];

const EXCLUDED_PREFIXES = [".git/", "dist/", "node_modules/", "project/" + "planning" + "/", "." + "edge-" + "agentic" + "/local/", "tests/"];
export const FORBIDDEN_PUBLIC_PREFIXES = ["docs/handoffs/"];

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
      .filter((file) => existsSync(file))
      .filter((file) => file !== "pnpm-lock.yaml")
      .filter(isPublicAuditFile);
  } catch {
    return walk(".").filter(isPublicAuditFile);
  }
}

function forbiddenPublicPathFindings() {
  return FORBIDDEN_PUBLIC_PREFIXES.flatMap((prefix) => {
    if (!existsSync(prefix)) return [];
    return walk(prefix).map((file) => `${file}: internal handoff files must not exist under public docs`);
  });
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

// A value that is a plain dotted identifier path with no digits is member-access code,
// not a literal secret (typed reason: EXEC-PM ruling 2026-11-01, false positive on
// property-access code). Every other value the rule matched before still matches; the
// exemption requires the WHOLE value run to be such a path (a path followed by more
// value characters, a digit, or a non-identifier character is still flagged).
export const SECRET_UNQUOTED_ASSIGNMENT_RULE = /(api[_-]?key|secret|token|password)\s*[:=]\s*(?![A-Za-z_$]+(?:\.[A-Za-z_$]+)+(?![A-Za-z0-9._~+/=-]))[A-Za-z0-9._~+/=-]{16,}/i;

// EXEC-PM ruling 2026-11-03 (option A): the "private planning path" rule gets ONE JSON-aware
// exemption, because a mister-clean retirement record must name each retired directory in its
// top-level `roots` list. The directory name is already public in the tracked .gitignore (outside
// the audited roots), and .gitignore stays audited, so the allowance makes no new disclosure. The
// control stays in force everywhere else: only the exact `roots` value span of a
// charter/retirements/<date>-<slug>.json whose record_type is `mister-clean.retirement` is exempt,
// and only from this one rule. Every other field of that record, every other charter file, a
// malformed or non-retirement JSON, a .md under charter/retirements/, and every other rule still
// fail on that file. Reopen: tests/audit/public-surface-retirement-roots.test.ts.
export const RETIREMENT_RECORD_TYPE = "mister-clean.retirement";
export const PRIVATE_PLANNING_RULE = "private planning path";
const RETIREMENT_RECORD_PATH = /^charter\/retirements\/[^/]+\.json$/;

/** Skip one JSON value starting at `i`; returns the index just past it (whitespace tolerated). */
function skipJsonValue(text, i) {
  while (i < text.length && /\s/.test(text[i])) i += 1;
  const first = text[i];
  if (first === '"') return skipJsonString(text, i);
  if (first === "{" || first === "[") {
    let depth = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        i = skipJsonString(text, i);
        continue;
      }
      if (ch === "{" || ch === "[") depth += 1;
      else if (ch === "}" || ch === "]") {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
    return i;
  }
  while (i < text.length && !/[\s,}\]]/.test(text[i])) i += 1;
  return i;
}

function skipJsonString(text, i) {
  let j = i + 1;
  while (j < text.length) {
    const ch = text[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === '"') return j + 1;
    j += 1;
  }
  return j;
}

/**
 * Character span of the TOP-LEVEL `roots` value, or null when the document is not a single
 * object. A nested `roots` (for example `ruling.roots`) is not top level and is never returned.
 */
export function topLevelValueSpan(text, key) {
  let i = 0;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (text[i] !== "{") return null;
  i += 1;
  let span = null;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] === "}" || i >= text.length) return span;
    if (text[i] !== '"') return span;
    const keyEnd = skipJsonString(text, i);
    let name;
    try {
      name = JSON.parse(text.slice(i, keyEnd));
    } catch {
      return span;
    }
    i = keyEnd;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] !== ":") return span;
    i += 1;
    const valueStart = (() => {
      while (i < text.length && /\s/.test(text[i])) i += 1;
      return i;
    })();
    const valueEnd = skipJsonValue(text, valueStart);
    if (name === key) span = [valueStart, valueEnd];
    i = valueEnd;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] === ",") {
      i += 1;
      continue;
    }
    return span;
  }
  return span;
}

/**
 * Mask the exemption span for the private planning rule: the top-level `roots` array of a
 * well-formed retirement record. Returns `text` unchanged for every other file and record.
 */
export function maskRetirementRoots(file, text) {
  if (!RETIREMENT_RECORD_PATH.test(file)) return text;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return text;
  if (parsed.record_type !== RETIREMENT_RECORD_TYPE) return text;
  if (!Array.isArray(parsed.roots)) return text;
  // Every entry must itself be a string: a roots list carrying objects or numbers is not the
  // record shape this exemption was ruled for, so it fails closed and keeps the rule in force.
  if (!parsed.roots.every((root) => typeof root === "string")) return text;
  const span = topLevelValueSpan(text, "roots");
  if (!span) return text;
  // The span must be the array JSON.parse read as `roots` (guards a duplicated key).
  if (text[span[0]] !== "[") return text;
  return `${text.slice(0, span[0])}${" ".repeat(span[1] - span[0])}${text.slice(span[1])}`;
}

const forbidden = [
  { name: "macOS home path", pattern: new RegExp(`/${"Users"}/[A-Za-z0-9._-]+/`) },
  { name: "Linux home path", pattern: /\/home\/[A-Za-z0-9._-]+\// },
  { name: "tilde home path", pattern: /~\//, exemptFiles: BUNDLED_DOC },
  { name: "local agent config path", pattern: new RegExp(`\\.(?:${"codex"}|${"claude"}|${"agents"})(?:/|$)`, "i"), exemptFiles: BUNDLED_DOC },
  { name: "local evidence path", pattern: new RegExp(`\\.${"edge-" + "agentic"}/local`, "i") },
  { name: PRIVATE_PLANNING_RULE, pattern: new RegExp(`project/${"planning"}/`, "i") },
  {
    name: "private project or account marker",
    pattern: new RegExp(
      `\\b(edge-${"agentic"}|Edu${"gentic"}|${"OK" + "OA"}|open_${"protocols"})\\b`,
      "i"
    )
  },
  { name: "secret-looking quoted assignment", pattern: /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']+["']/i },
  { name: "secret-looking unquoted assignment", pattern: SECRET_UNQUOTED_ASSIGNMENT_RULE },
  { name: "bearer token literal", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i },
  { name: "URI credential literal", pattern: /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/i }
];

export function auditPublicSurface(fileTextByPath) {
  const findings = [];
  for (const [file, text] of Object.entries(fileTextByPath)) {
    if (!isPublicAuditFile(file)) continue;
    if (FORBIDDEN_PUBLIC_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      findings.push(`${file}: internal handoff files must not exist under public docs`);
      continue;
    }
    for (const rule of forbidden) {
      if (rule.exemptFiles?.has(file)) continue;
      // Only the private planning rule has the retirement-roots exemption, and only over the
      // `roots` span (a roots string repeated elsewhere in the record is still the same text and
      // still fails, because only that span is masked).
      const subject = rule.name === PRIVATE_PLANNING_RULE ? maskRetirementRoots(file, text) : text;
      if (rule.pattern.test(subject)) findings.push(`${file}: ${rule.name}`);
    }
  }
  return findings;
}

export function main() {
  const publicFiles = filesToAudit();
  const forbiddenPublicFiles = publicFiles.filter((file) => FORBIDDEN_PUBLIC_PREFIXES.some((prefix) => file.startsWith(prefix)));
  const forbiddenPathFindings = forbiddenPublicPathFindings();
  if (forbiddenPublicFiles.length > 0) {
    throw new Error(`Public surface audit failed: internal handoff files are public:\n${forbiddenPublicFiles.join("\n")}`);
  }
  if (forbiddenPathFindings.length > 0) {
    throw new Error(`Public surface audit failed:\n${forbiddenPathFindings.join("\n")}`);
  }

  const findings = auditPublicSurface(Object.fromEntries(publicFiles.map((file) => [file, readFileSync(file, "utf8")])));

  if (findings.length > 0) {
    throw new Error(`Public surface audit failed:\n${findings.join("\n")}`);
  }

  console.log(`Public surface audit PASS: ${publicFiles.length} files checked`);
}

// Run main() only when this file is the invoked entry point. Real paths are compared, as
// src/bin/index.ts does, so a symlinked invocation still runs main() instead of exiting 0.
function isMain(metaUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}


if (isMain(import.meta.url)) {
  main();
}
