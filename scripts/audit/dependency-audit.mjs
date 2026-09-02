import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, "..", "..");

export const SEVERITY_FLOOR = "high";
export const GATED_SEVERITIES = new Set(["high", "critical"]);
export const MAX_EXPIRY_HORIZON_DAYS = 90;
export const REQUIRED_EXCEPTION_FIELDS = ["advisory", "owner", "expires", "rationale"];
export const ADVISORY_ID_PATTERN = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;
export const DEFAULT_MANIFEST_PATH = join(SCRIPT_DIR, "audit-exceptions.json");
export const DEFAULT_WORKSPACE_FILE_NAME = "pnpm-workspace.yaml";
export const REPORT_FILE_ENV_VAR = "ODIN_DEPENDENCY_AUDIT_REPORT_FILE";

const MS_PER_DAY = 86_400_000;

const USAGE = [
  "Usage: node scripts/audit/dependency-audit.mjs [options]",
  "",
  "  --workspace <dir>     Directory to audit (default: package root). The audit runs there.",
  "                        The directory must exist and match the on-disk workspace name",
  "                        exactly (case-sensitive); an unattributable value fails the gate.",
  "                        The pnpm workspace file for override reconciliation is resolved",
  "                        relative to this directory (default: pnpm-workspace.yaml).",
  "  --report-file <path>  Consume a pnpm-audit-format JSON report instead of running an audit.",
  `                        Also settable via ${REPORT_FILE_ENV_VAR}; that form additionally`,
  "                        requires --allow-injected-report and is refused, before the named",
  "                        file is read, when the flag is absent. Test-injection seam only:",
  "                        absent input means a live `pnpm audit` run.",
  "  --allow-injected-report  Permit a report file supplied through the REPORT_FILE_ENV_VAR seam.",
  "                        Passing it alone injects nothing and enables nothing.",
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
 * Control-character-free rendering for manifest-derived text, mirroring the
 * rule `describeRoleSlotInput` applies to role slots: every character in
 * U+0000-U+001F plus U+007F becomes a space, whitespace runs collapse, and the
 * result is trimmed. Applied at every render site so a crafted manifest value
 * (for example an owner containing a newline and a "Dependency audit PASS"
 * sentence) can never forge an independent gate verdict line. Exit codes are
 * unaffected by rendering; this is a display-layer constraint only.
 */
export function sanitizeRendered(value) {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical workspace identity for pin linkage. Equivalent spellings of the
 * same workspace — ".", "./", an absolute path, a path containing ".."
 * segments — resolve to the same normalized relative label (""-derived "." for
 * the package root, "telemetry" for telemetry, and so on).
 */
export function normalizeWorkspaceLabel(label) {
  if (typeof label !== "string" || label.trim() === "") return ".";
  const resolved = resolve(PACKAGE_ROOT, label.trim());
  const rel = relative(PACKAGE_ROOT, resolved);
  return rel === "" ? "." : rel.replace(/\\/g, "/");
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
    const named = `${label} (${sanitizeRendered(advisory)})`;

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
      errors.push(
        `${named}: EXPIRED on ${sanitizeRendered(entry.expires)}, evaluated against ${formatUtcDate(now)} UTC${boundary}`
      );
      continue;
    }
    if (expires > horizon) {
      errors.push(
        `${named}: expiry ${sanitizeRendered(entry.expires)} is over-horizon — more than ${MAX_EXPIRY_HORIZON_DAYS} days in the future`
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
      if (entry.pin.workspace !== undefined && !isNonEmptyString(entry.pin.workspace)) {
        errors.push(`${named}: malformed pin — workspace must be a non-empty string when present`);
        continue;
      }
    }

    entries.push({
      advisory,
      owner: entry.owner.trim(),
      expires: entry.expires.trim(),
      rationale: entry.rationale.trim(),
      pin: entry.pin
        ? {
            package: entry.pin.package.trim(),
            range: entry.pin.range.trim(),
            workspace: isNonEmptyString(entry.pin.workspace) ? entry.pin.workspace.trim() : "."
          }
        : null
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
 *
 * Linkage is workspace-scoped: only a pin whose recorded workspace equals the
 * audited workspace is reconciled here. A pin belonging to another workspace is
 * not applicable to this run and is never counted as an absent or drifted
 * override.
 */
export function validateOverrideLinkage(entries, workspaceText, auditedWorkspace = ".") {
  if (typeof workspaceText !== "string") return [];
  const audited = normalizeWorkspaceLabel(auditedWorkspace);
  const overrides = parseOverridesBlock(workspaceText);
  const errors = [];
  for (const entry of entries) {
    if (!entry.pin) continue;
    if (normalizeWorkspaceLabel(entry.pin.workspace) !== audited) continue;
    const actual = overrides.get(entry.pin.package);
    if (actual === undefined) {
      errors.push(
        `${sanitizeRendered(entry.advisory)}: recorded pin ${sanitizeRendered(entry.pin.package)} is absent from the workspace overrides block`
      );
      continue;
    }
    if (actual !== entry.pin.range) {
      errors.push(
        `${sanitizeRendered(entry.advisory)}: recorded pin ${sanitizeRendered(entry.pin.package)} ${sanitizeRendered(entry.pin.range)} drifted — the workspace overrides it as ${sanitizeRendered(actual)}`
      );
    }
  }
  return errors;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Render the runtime type of a value for failure messages. */
function describeValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}

/** Detail string for a top-level `error` key, naming the code/message it carries. */
function describeErrorKey(error) {
  if (error === null) return "null";
  if (Array.isArray(error)) return "an array";
  if (typeof error === "object") {
    const code = isNonEmptyString(error?.code) ? error.code : "";
    const message = isNonEmptyString(error?.message) ? error.message : "";
    if (code && message) return `code ${code}: ${message}`;
    if (code) return `code ${code}`;
    if (message) return message;
    return "an empty object";
  }
  return String(error);
}

/**
 * Strict pnpm-audit-report validation. The report must be a single JSON
 * object: nothing is recovered from surrounding non-JSON output, so a
 * truncated report, a diagnostic wrapper, or an unrelated JSON document all
 * fail. A report carrying a top-level `error` key is refused BY NAME (key
 * presence, not truthiness). Independently, the report must positively prove
 * an audit ran — `advisories` as an object or array AND
 * `metadata.vulnerabilities` as an object. Either failure is the named
 * "audit could not be verified to have run" class; absence is never zero.
 */
export function validateAuditReport(text) {
  const raw = String(text ?? "");
  // The UTF-8 BOM (U+FEFF) is a byte-order prefix, not part of a JSON
  // document. trim() treats U+FEFF as whitespace and would normalize a
  // BOM-prefixed report into acceptable JSON; it must fail closed instead.
  if (/^\s*\uFEFF/.test(raw)) {
    return {
      ok: false,
      name: "REPORT_NOT_VERIFIED",
      message:
        "report text is prefixed by a UTF-8 BOM (U+FEFF) — a single JSON object is required with no prefix"
    };
  }
  const trimmed = raw.trim();
  let report;
  try {
    report = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      name: "REPORT_NOT_VERIFIED",
      message:
        "dependency audit report is not valid JSON — a single JSON object is required and no report is recovered from surrounding output"
    };
  }
  if (!isPlainObject(report)) {
    return {
      ok: false,
      name: "REPORT_NOT_VERIFIED",
      message: `dependency audit report is not a single JSON object — got ${describeValueType(report)} at the top level`
    };
  }
  if (Object.prototype.hasOwnProperty.call(report, "error")) {
    return {
      ok: false,
      name: "REPORT_CARRIES_ERROR_KEY",
      message:
        `report carries a top-level "error" key (${describeErrorKey(report.error)}) — ` +
        "the audit could not run, so the gate cannot verify that it ran"
    };
  }
  const advisoriesOk = Array.isArray(report.advisories) || isPlainObject(report.advisories);
  const vulnerabilitiesOk = isPlainObject(report?.metadata?.vulnerabilities);
  if (!advisoriesOk || !vulnerabilitiesOk) {
    return {
      ok: false,
      name: "REPORT_NOT_VERIFIED",
      message:
        "report lacks positive proof that an audit ran: expected " +
        `"advisories" as an object or array (got ${describeValueType(report?.advisories)}) and ` +
        `"metadata.vulnerabilities" as an object (got ${describeValueType(report?.metadata?.vulnerabilities)})`
    };
  }
  return { ok: true, name: "REPORT_VERIFIED", report };
}

/** Normalize a pnpm-audit-format JSON report into a flat advisory list. */
export function parseAuditReport(text) {
  const verdict = validateAuditReport(text);
  if (!verdict.ok) throw new Error(verdict.message);
  const raw = verdict.report.advisories;
  const list = Array.isArray(raw) ? raw : Object.values(raw);
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

/** Human-meaningful workspace-file name for failure messages. */
function workspaceFileDisplayName(auditedWorkspace) {
  const ws = normalizeWorkspaceLabel(auditedWorkspace);
  return ws === "." ? DEFAULT_WORKSPACE_FILE_NAME : `${ws}/${DEFAULT_WORKSPACE_FILE_NAME}`;
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
  workspaceLabel = ".",
  reportSource = "live pnpm audit",
  workspaceFile = null
}) {
  const lines = [
    `Dependency audit gate: workspace ${workspaceLabel} | severity floor ${SEVERITY_FLOOR} | report source: ${reportSource}`
  ];
  const { errors: manifestErrors, entries } = validateExceptionManifest(manifest, { now });
  const audited = normalizeWorkspaceLabel(workspaceLabel);

  let linkageError = null;
  let linkageErrors = [];
  if (manifestErrors.length === 0) {
    const applicablePins = entries.filter(
      (entry) => entry.pin && normalizeWorkspaceLabel(entry.pin.workspace) === audited
    );
    if (applicablePins.length > 0 && workspaceText === null) {
      // AC11: a missing or unreadable workspace file cannot skip linkage —
      // the gate FAILS and names the file it could not read.
      linkageError =
        `workspace file ${workspaceFile ?? workspaceFileDisplayName(audited)} is absent or unreadable, but ` +
        `${applicablePins.length} recorded pin(s) apply to audited workspace ${audited} — ` +
        "the gate cannot verify override linkage";
    } else {
      linkageErrors = validateOverrideLinkage(entries, workspaceText, audited);
    }
  }
  const errors = [...manifestErrors, ...(linkageError === null ? [] : [linkageError]), ...linkageErrors];

  if (errors.length > 0) {
    lines.push(`Manifest INVALID: ${errors.length} error(s) against ${formatUtcDate(now)} UTC`);
    for (const error of errors) lines.push(`  - ${error}`);
    return { ok: false, lines, errors, entries: [], accepted: [], unaccepted: [] };
  }

  lines.push(`Manifest OK: ${entries.length} exception(s) validated against ${formatUtcDate(now)} UTC`);

  let advisories;
  let reportFailure = null;
  try {
    advisories = parseAuditReport(reportText);
  } catch (error) {
    reportFailure = error instanceof Error ? error.message : String(error);
  }

  if (reportFailure !== null) {
    // AC3: a distinct, named failure class — the audit could not be verified
    // to have run — distinguishable from an unaccepted-advisory failure and
    // from a manifest-invalid failure. Absence of positive proof is never zero.
    lines.push(`Dependency audit FAIL: the audit could not be verified to have run — ${reportFailure}`);
    return { ok: false, lines, errors: [reportFailure], entries, accepted: [], unaccepted: [] };
  }

  const { gated, accepted, unaccepted } = reconcile({ advisories, entries });
  const liveByAdvisory = new Map(accepted.map(({ advisory, entry }) => [entry.advisory, advisory]));

  // Every accepted exception is named, owned, and dated here, on every run.
  // All manifest-derived text is control-character-stripped and whitespace-
  // collapsed (AC12), and a pin that belongs to another workspace is reported
  // as not applicable rather than silently dropped (AC10).
  for (const entry of entries) {
    const live = liveByAdvisory.get(entry.advisory);
    const pin = entry.pin
      ? ` | pin ${sanitizeRendered(entry.pin.package)} ${sanitizeRendered(entry.pin.range)} (workspace ${sanitizeRendered(entry.pin.workspace)})`
      : "";
    let state;
    if (entry.pin && normalizeWorkspaceLabel(entry.pin.workspace) !== audited) {
      state = `pin belongs to workspace ${sanitizeRendered(entry.pin.workspace)} — not applicable to this run (reconciled against that workspace's file)`;
    } else {
      state = live
        ? `ACCEPTING live ${live.severity} advisory in ${live.module}`
        : "no matching advisory in the current tree";
    }
    lines.push(
      `  - ${sanitizeRendered(entry.advisory)} | owner: ${sanitizeRendered(entry.owner)} | expires: ${sanitizeRendered(entry.expires)}${pin} | ${state}`
    );
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
    workspaceFile: join(PACKAGE_ROOT, DEFAULT_WORKSPACE_FILE_NAME),
    manifestPath: DEFAULT_MANIFEST_PATH,
    reportFile: null,
    reportFileFromEnv: false,
    allowInjectedReport: false,
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
      options.workspaceFile = join(options.workspace, DEFAULT_WORKSPACE_FILE_NAME);
    } else if (arg === "--report-file") {
      options.reportFile = next();
      options.reportFileFromEnv = false;
    } else if (arg === "--allow-injected-report") options.allowInjectedReport = true;
    else if (arg === "--manifest") options.manifestPath = resolve(PACKAGE_ROOT, next());
    else throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
  }

  if (options.reportFile === null && isNonEmptyString(env[REPORT_FILE_ENV_VAR])) {
    options.reportFile = env[REPORT_FILE_ENV_VAR].trim();
    options.reportFileFromEnv = true;
  }

  return options;
}

/**
 * The environment-variable seam requires explicit opt-in: a report file
 * supplied through REPORT_FILE_ENV_VAR is refused unless
 * --allow-injected-report is present in the argument vector, and the refusal
 * happens before the named file is read. The explicit --report-file argument
 * form is exempt. Passing --allow-injected-report alone injects nothing.
 */
export function assertReportFileAllowed(options) {
  if (options.reportFileFromEnv && !options.allowInjectedReport) {
    throw new Error(
      `${REPORT_FILE_ENV_VAR} is set but --allow-injected-report is missing: ` +
        "the environment-variable injection seam requires explicit opt-in. " +
        `Refusing to read ${options.reportFile}. ` +
        "Pass --allow-injected-report to use the seam, or --report-file <path> instead.\n\n" +
        USAGE
    );
  }
}

/**
 * Fail closed on --workspace values that cannot be attributed to a real
 * workspace. Refused by name:
 *  - a resolved directory that does not exist (including a wrong-case spelling
 *    on a case-sensitive filesystem),
 *  - a label whose spelling does not match the on-disk directory entry — a
 *    wrong-case value like "TELEMETRY" would otherwise resolve on a
 *    case-insensitive filesystem and silently become a different workspace
 *    with no applicable pins (never a PASS), and
 *  - a resolved path that escapes the package root (see the `rel.startsWith("..")`
 *    refusal below) — a bare `..`, or any `..` segment whose resolution lands
 *    outside the package root, is refused as a workspace error rather than
 *    silently auditing some other directory.
 * The package root (".", "./", an absolute path, and `..`-segment spellings
 * that resolve TO the package root, e.g. "sub/..") is always valid and skips
 * the entry-name check.
 */
export function validateWorkspaceDirectory({ workspaceDir, workspaceLabel, packageRoot = PACKAGE_ROOT }) {
  const resolved = resolve(workspaceDir);
  const rel = relative(packageRoot, resolved);
  if (rel === "") return; // package root — valid by construction
  if (rel.startsWith("..")) {
    throw new Error(`workspace error: --workspace ${workspaceLabel} resolves to ${resolved}, outside the package root`);
  }
  if (!existsSync(resolved)) {
    throw new Error(
      `workspace error: --workspace ${workspaceLabel} resolves to ${resolved}, which does not exist as a directory`
    );
  }
  const parent = dirname(resolved);
  const wanted = basename(resolved);
  let matched = null;
  try {
    matched = readdirSync(parent).find((name) => name === wanted) ?? null;
  } catch {
    matched = null;
  }
  if (matched === null) {
    throw new Error(
      `workspace error: --workspace ${workspaceLabel} does not match an on-disk workspace directory — ` +
        `no directory entry named ${wanted} exists under ${parent} (workspace names are case-sensitive)`
    );
  }
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
    // `pnpm audit` exits non-zero both when it cannot audit and when it finds
    // advisories; the report on stdout is always the input this gate
    // reconciles. The evaluator rejects an error-key report by name, so a
    // could-not-audit condition fails the gate instead of masquerading as a
    // PASS, while a well-formed advisory-bearing report is still reconciled
    // normally. Only a genuinely missing report is a hard execution failure.
    const output = error?.stdout;
    if (typeof output === "string" && output.trim() !== "") return output;
    throw new Error(`the dependency audit could not be executed in ${cwd}: ${error?.message ?? error}`);
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv, env);
  if (options.help) {
    console.log(USAGE);
    return;
  }

  assertReportFileAllowed(options);
  validateWorkspaceDirectory({
    workspaceDir: options.workspace,
    workspaceLabel: options.workspaceLabel
  });

  const manifest = JSON.parse(readFileSync(options.manifestPath, "utf8"));
  const workspaceText = existsSync(options.workspaceFile) ? readFileSync(options.workspaceFile, "utf8") : null;

  let reportText;
  let reportSource;
  if (options.reportFile) {
    reportText = readFileSync(resolve(PACKAGE_ROOT, options.reportFile), "utf8");
    reportSource = `injected report ${resolve(PACKAGE_ROOT, options.reportFile)}`;
  } else {
    reportText = await runLiveAudit(options.workspace);
    reportSource = "live pnpm audit";
  }

  const result = evaluateDependencyAudit({
    manifest,
    reportText,
    workspaceText,
    workspaceLabel: options.workspaceLabel,
    reportSource,
    workspaceFile: options.workspaceFile
  });

  for (const line of result.lines) console.log(line);
  if (!result.ok) throw new Error(`Dependency audit gate failed:\n${result.errors.join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
