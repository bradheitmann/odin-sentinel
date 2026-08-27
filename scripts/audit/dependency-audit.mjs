import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, "..", "..");

export const SEVERITY_FLOOR = "high";
export const GATED_SEVERITIES = new Set(["high", "critical"]);
export const MAX_EXPIRY_HORIZON_DAYS = 90;
export const REQUIRED_EXCEPTION_FIELDS = ["advisory", "owner", "expires", "rationale"];
export const ADVISORY_ID_PATTERN = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;
export const DEFAULT_MANIFEST_PATH = join(SCRIPT_DIR, "audit-exceptions.json");
export const DEFAULT_WORKSPACE_FILE = join(PACKAGE_ROOT, "pnpm-workspace.yaml");
export const REPORT_FILE_ENV_VAR = "ODIN_DEPENDENCY_AUDIT_REPORT_FILE";

const MS_PER_DAY = 86_400_000;

const USAGE = [
  "Usage: node scripts/audit/dependency-audit.mjs [options]",
  "",
  "  --workspace <dir>     Directory to audit (default: package root). The audit runs there.",
  "  --report-file <path>  Consume a pnpm-audit-format JSON report instead of running an audit.",
  `                        Also settable via ${REPORT_FILE_ENV_VAR}. Test-injection seam only:`,
  "                        absent input means a live `pnpm audit` run.",
  "  --manifest <path>     Exception manifest (default: scripts/audit/audit-exceptions.json).",
  "  --help                Print this message."
].join("\n");

/** Parse an ISO-8601 calendar date (YYYY-MM-DD) as UTC midnight. Returns null when malformed. */
export function parseIsoUtcDate(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }
  return timestamp;
}

/** Truncate an instant to UTC midnight so expiry comparisons are calendar-date comparisons. */
export function utcDayStart(now) {
  const date = now instanceof Date ? now : new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function formatUtcDate(now) {
  return new Date(utcDayStart(now)).toISOString().slice(0, 10);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate the exception manifest. This runs BEFORE the audit: a malformed or
 * expired entry fails the gate on its own, whether or not the advisory it names
 * is present in the tree.
 */
export function validateExceptionManifest(manifest, { now = new Date() } = {}) {
  const errors = [];
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { errors: ["exception manifest must be a JSON object"], entries: [] };
  }
  if (!Array.isArray(manifest.exceptions)) {
    return { errors: ["exception manifest must declare an `exceptions` array"], entries: [] };
  }

  const today = utcDayStart(now);
  const horizon = today + MAX_EXPIRY_HORIZON_DAYS * MS_PER_DAY;
  const seen = new Set();
  const entries = [];

  for (const [index, entry] of manifest.exceptions.entries()) {
    const label = `exceptions[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${label}: entry must be an object`);
      continue;
    }

    const missing = REQUIRED_EXCEPTION_FIELDS.filter((field) => !isNonEmptyString(entry[field]));
    if (missing.length > 0) {
      errors.push(`${label}: malformed — missing or empty required field(s): ${missing.join(", ")}`);
      continue;
    }

    const advisory = entry.advisory.trim();
    const named = `${label} (${advisory})`;

    if (!ADVISORY_ID_PATTERN.test(advisory)) {
      errors.push(`${named}: malformed advisory id — must match GHSA-xxxx-xxxx-xxxx exactly (case-sensitive)`);
      continue;
    }
    if (seen.has(advisory)) {
      errors.push(`${named}: malformed — duplicate advisory id`);
      continue;
    }
    seen.add(advisory);

    const expires = parseIsoUtcDate(entry.expires);
    if (expires === null) {
      errors.push(`${named}: malformed expiry — must be an ISO-8601 calendar date (YYYY-MM-DD)`);
      continue;
    }
    if (expires <= today) {
      const boundary = expires === today ? " — an expiry equal to the current UTC date is expired" : "";
      errors.push(`${named}: EXPIRED on ${entry.expires.trim()}, evaluated against ${formatUtcDate(now)} UTC${boundary}`);
      continue;
    }
    if (expires > horizon) {
      errors.push(
        `${named}: expiry ${entry.expires.trim()} is over-horizon — more than ${MAX_EXPIRY_HORIZON_DAYS} days in the future`
      );
      continue;
    }

    if (entry.pin !== undefined) {
      if (entry.pin === null || typeof entry.pin !== "object" || Array.isArray(entry.pin)) {
        errors.push(`${named}: malformed pin — must be an object with package and range`);
        continue;
      }
      if (!isNonEmptyString(entry.pin.package) || !isNonEmptyString(entry.pin.range)) {
        errors.push(`${named}: malformed pin — package and range must both be non-empty`);
        continue;
      }
    }

    entries.push({
      advisory,
      owner: entry.owner.trim(),
      expires: entry.expires.trim(),
      rationale: entry.rationale.trim(),
      pin: entry.pin ? { package: entry.pin.package.trim(), range: entry.pin.range.trim() } : null
    });
  }

  return { errors, entries };
}

function unquote(value) {
  return value.replace(/^["']/, "").replace(/["']$/, "");
}

/** Minimal reader for the top-level `overrides:` block of a pnpm workspace file. */
export function parseOverridesBlock(text) {
  const overrides = new Map();
  if (typeof text !== "string") return overrides;
  let inBlock = false;
  for (const line of text.split("\n")) {
    if (/^overrides:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^\S/.test(line)) break;
    const match = /^\s+([^:#\s]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    overrides.set(unquote(match[1]), unquote(match[2]));
  }
  return overrides;
}

/**
 * A pin recorded against an exception must still be the pin the workspace
 * applies. This is what a free-text comment cannot assert: that the override is
 * still present and still resolving to the recorded range.
 */
export function validateOverrideLinkage(entries, workspaceText) {
  if (typeof workspaceText !== "string") return [];
  const overrides = parseOverridesBlock(workspaceText);
  const errors = [];
  for (const entry of entries) {
    if (!entry.pin) continue;
    const actual = overrides.get(entry.pin.package);
    if (actual === undefined) {
      errors.push(`${entry.advisory}: recorded pin ${entry.pin.package} is absent from the workspace overrides block`);
      continue;
    }
    if (actual !== entry.pin.range) {
      errors.push(
        `${entry.advisory}: recorded pin ${entry.pin.package} ${entry.pin.range} drifted — the workspace overrides it as ${actual}`
      );
    }
  }
  return errors;
}

function extractJsonObject(text) {
  const trimmed = String(text ?? "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("dependency audit report is not valid JSON");
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      throw new Error("dependency audit report is not valid JSON");
    }
  }
}

/** Normalize a pnpm-audit-format JSON report into a flat advisory list. */
export function parseAuditReport(text) {
  const report = extractJsonObject(text);
  const raw = report?.advisories;
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
  return list.map((advisory) => ({
    id: isNonEmptyString(advisory?.github_advisory_id)
      ? advisory.github_advisory_id.trim()
      : isNonEmptyString(advisory?.ghsaId)
        ? advisory.ghsaId.trim()
        : "",
    severity: String(advisory?.severity ?? "").trim().toLowerCase(),
    module: isNonEmptyString(advisory?.module_name) ? advisory.module_name.trim() : "unknown",
    title: isNonEmptyString(advisory?.title) ? advisory.title.trim() : ""
  }));
}

/** Split advisories at or above the severity floor into accepted and unaccepted. */
export function reconcile({ advisories, entries }) {
  const byAdvisory = new Map(entries.map((entry) => [entry.advisory, entry]));
  const gated = advisories.filter((advisory) => GATED_SEVERITIES.has(advisory.severity));
  const accepted = [];
  const unaccepted = [];
  for (const advisory of gated) {
    const entry = advisory.id ? byAdvisory.get(advisory.id) : undefined;
    if (entry) accepted.push({ advisory, entry });
    else unaccepted.push(advisory);
  }
  return { gated, accepted, unaccepted };
}

/**
 * Full gate evaluation over already-read inputs. Pure: no filesystem access and
 * no process spawning, so every failure state is provable from fixtures.
 */
export function evaluateDependencyAudit({
  manifest,
  reportText,
  workspaceText = null,
  now = new Date(),
  workspaceLabel = "."
}) {
  const lines = [`Dependency audit gate: workspace ${workspaceLabel} | severity floor ${SEVERITY_FLOOR}`];
  const { errors: manifestErrors, entries } = validateExceptionManifest(manifest, { now });
  const linkageErrors = manifestErrors.length === 0 ? validateOverrideLinkage(entries, workspaceText) : [];
  const errors = [...manifestErrors, ...linkageErrors];

  if (errors.length > 0) {
    lines.push(`Manifest INVALID: ${errors.length} error(s) against ${formatUtcDate(now)} UTC`);
    for (const error of errors) lines.push(`  - ${error}`);
    return { ok: false, lines, errors, entries: [], accepted: [], unaccepted: [] };
  }

  lines.push(`Manifest OK: ${entries.length} exception(s) validated against ${formatUtcDate(now)} UTC`);

  const advisories = parseAuditReport(reportText);
  const { gated, accepted, unaccepted } = reconcile({ advisories, entries });
  const liveByAdvisory = new Map(accepted.map(({ advisory, entry }) => [entry.advisory, advisory]));

  // Every accepted exception is named, owned, and dated here, on every run.
  for (const entry of entries) {
    const live = liveByAdvisory.get(entry.advisory);
    const pin = entry.pin ? ` | pin ${entry.pin.package} ${entry.pin.range}` : "";
    const state = live
      ? `ACCEPTING live ${live.severity} advisory in ${live.module}`
      : "no matching advisory in the current tree";
    lines.push(`  - ${entry.advisory} | owner: ${entry.owner} | expires: ${entry.expires}${pin} | ${state}`);
  }

  lines.push(
    `Advisories at or above ${SEVERITY_FLOOR}: ${gated.length} (accepted: ${accepted.length}, unaccepted: ${unaccepted.length})`
  );

  if (unaccepted.length > 0) {
    for (const advisory of unaccepted) {
      lines.push(
        `  - UNACCEPTED ${advisory.severity} ${advisory.id || "<no advisory id>"} in ${advisory.module}${advisory.title ? `: ${advisory.title}` : ""}`
      );
    }
    const failures = unaccepted.map(
      (advisory) => `unaccepted ${advisory.severity} advisory ${advisory.id || "<no advisory id>"} in ${advisory.module}`
    );
    lines.push(`Dependency audit FAIL: ${failures.length} unaccepted advisory/advisories at or above ${SEVERITY_FLOOR}`);
    return { ok: false, lines, errors: failures, entries, accepted, unaccepted };
  }

  lines.push(`Dependency audit PASS: 0 unaccepted advisories; ${entries.length} recorded exception(s)`);
  return { ok: true, lines, errors: [], entries, accepted, unaccepted };
}

export function parseArgs(argv = [], env = {}) {
  const options = {
    workspace: PACKAGE_ROOT,
    workspaceLabel: ".",
    manifestPath: DEFAULT_MANIFEST_PATH,
    reportFile: isNonEmptyString(env[REPORT_FILE_ENV_VAR]) ? env[REPORT_FILE_ENV_VAR].trim() : null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!isNonEmptyString(value)) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--workspace") {
      const value = next();
      options.workspace = resolve(PACKAGE_ROOT, value);
      options.workspaceLabel = value;
    } else if (arg === "--report-file") options.reportFile = next();
    else if (arg === "--manifest") options.manifestPath = resolve(PACKAGE_ROOT, next());
    else throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
  }

  return options;
}

/**
 * Live audit runner. Argument-vector invocation only — no shell, no
 * interpolation — matching the sibling gate scripts in this directory.
 */
async function runLiveAudit(cwd) {
  const { execFileSync } = await import("node:child_process");
  try {
    return execFileSync("pnpm", ["audit", "--json", "--audit-level", SEVERITY_FLOOR], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    // pnpm exits non-zero when advisories are found; the report on stdout is
    // still the input this gate reconciles. Only a missing report is fatal.
    const output = error?.stdout;
    if (typeof output === "string" && output.includes("{")) return output;
    throw new Error(`the dependency audit could not be executed in ${cwd}: ${error?.message ?? error}`);
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv, env);
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const manifest = JSON.parse(readFileSync(options.manifestPath, "utf8"));
  const workspaceText = existsSync(DEFAULT_WORKSPACE_FILE) ? readFileSync(DEFAULT_WORKSPACE_FILE, "utf8") : null;
  const reportText = options.reportFile
    ? readFileSync(resolve(PACKAGE_ROOT, options.reportFile), "utf8")
    : await runLiveAudit(options.workspace);

  const result = evaluateDependencyAudit({
    manifest,
    reportText,
    workspaceText,
    workspaceLabel: options.workspaceLabel
  });

  for (const line of result.lines) console.log(line);
  if (!result.ok) throw new Error(`Dependency audit gate failed:\n${result.errors.join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
