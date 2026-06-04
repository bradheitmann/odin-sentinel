#!/usr/bin/env node
// scripts/protocol/verify-governed-context.mjs
//
// Verify an ODIN/SCP governed-context proof: proof that a target agent's SCP control layer
// (native skill, static control file, or MCP bootstrap resource) is not merely PRESENT but was
// actually LOADED and taken up, with a stable, machine-checkable source marker.
//
// This is the fail-closed companion to verify-instruction-read.mjs. "MCP configured" or "skill
// file on disk" is never enough for governed authority: a governed-context proof must declare a
// control source with a stable marker, prove that marker on disk when a path is given (sha256),
// and carry an uptake receipt whose evidence marker matches the control source. A self-asserted
// boolean with no stable source marker is rejected.
//
// Zero-secret: this script reads only the declared control-source file. It never reads
// environment variables and never prints file contents — only paths, byte counts, digests,
// markers, freshness, and PASS/FAIL reasons. Any secret-looking value inside the proof itself
// is a hard failure.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";

const SCHEMA_ID = "odin.governed_context_proof.v1";
const SOURCE_TYPES = ["native_skill", "static_control_file", "mcp_bootstrap"];
const DEFAULT_MAX_AGE_SECONDS = 86_400; // 24h: a governed-context proof must be fresh.

const USAGE = `odin verify-governed-context

Verify a governed-context proof: prove the SCP control layer was loaded and taken up, not just
present. "MCP configured" or "skill on disk" alone never qualifies — a stable source marker,
a disk checksum when a path is given, and a matching uptake receipt are required.

Usage:
  node scripts/protocol/verify-governed-context.mjs <proof.json> [--base <dir>] [--now <iso>] [--max-age-seconds <n>] [--json]
  node scripts/protocol/verify-governed-context.mjs --record --source <file> --marker <text> [--source-type <type>] [--harness <name>] [--harness-category <cat>] [--role <role>] [--version <v>] [--base <dir>]
  node scripts/protocol/verify-governed-context.mjs --help

Modes:
  verify (default)  Read <proof.json> and validate schema, control source (disk checksum when a
                    path is present), source marker, uptake receipt, freshness, and zero-secret.
                    Exit 0 only if everything verifies; exit 1 on any failure.
  --record          Compute a governed-context proof skeleton for the declared control source and
                    print it as JSON on stdout (does not write any file).

Options:
  --base <dir>          Resolve control-source paths against <dir> (default: current dir).
  --now <iso>           Treat this ISO-8601 instant as "now" for freshness (default: system clock).
  --max-age-seconds <n> Maximum proof age before it is stale (default: ${DEFAULT_MAX_AGE_SECONDS}).
  --source <file>       (record) Control-source file to checksum and mark.
  --marker <text>       (record) Stable source marker that must exist in the control source.
  --source-type <type>  (record) One of: ${SOURCE_TYPES.join(", ")} (default: native_skill).
  --harness <name>      (record) Harness name label.
  --harness-category <cat> (record) Harness category label.
  --role <role>         (record) Role label (default: UNDECLARED).
  --version <v>         (record) Control-source version label.
  --json                (verify) Emit machine-readable JSON result.
  --help, -h            Show this help and exit 0.

Exit codes: 0 = verified / help / record; 1 = proof failed; 2 = usage error.
Output is zero-secret: only paths, sizes, digests, markers, and reasons are printed.`;

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function resolveEntryPath(base, p) {
  return isAbsolute(p) ? p : join(base, p);
}

// Zero-secret guard: flag values that look like tokens/keys/secrets. Mirrors the redaction
// patterns used by the protocol validators so a proof can never smuggle a credential through.
const SECRET_PATTERNS = [
  /(sk|pk|ghp|gho|ghu|github_pat|xox[baprs])-?[A-Za-z0-9_=-]{8,}/i,
  /[A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*=[^\s"']+/i,
  /Bearer\s+[A-Za-z0-9._=-]{8,}/i
];

export function containsSecretLikeValue(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ageSeconds(iso, nowMs) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (nowMs - t) / 1000;
}

// Pure verification core: takes a parsed proof object, returns { ok, reasons, ... }.
// Exported so tests can exercise it without spawning a process.
export function verifyGovernedContextProof(proof, opts = {}) {
  const base = opts.base ?? ".";
  const maxAgeSeconds = Number.isFinite(opts.maxAgeSeconds) ? opts.maxAgeSeconds : DEFAULT_MAX_AGE_SECONDS;
  const nowMs = opts.now !== undefined && opts.now !== null ? new Date(opts.now).getTime() : Date.now();
  const reasons = [];

  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    return { ok: false, base, reasons: ["proof is not an object"] };
  }

  // Zero-secret: reject any secret-looking value anywhere in the proof.
  if (containsSecretLikeValue(proof)) {
    reasons.push("proof contains a secret-looking value (tokens/keys must never appear in a proof)");
  }

  if (proof.schema !== SCHEMA_ID) {
    reasons.push(`schema must be "${SCHEMA_ID}"`);
  }
  for (const field of ["role", "harness", "source_type", "generated_at"]) {
    if (typeof proof[field] !== "string" || proof[field].trim() === "") {
      reasons.push(`missing or empty field: ${field}`);
    }
  }
  if (typeof proof.source_type === "string" && !SOURCE_TYPES.includes(proof.source_type)) {
    reasons.push(`source_type must be one of: ${SOURCE_TYPES.join(", ")}`);
  }

  // Control source: a stable marker is mandatory; a declared path is checksum-gated against disk.
  const controlSource = asObject(proof.control_source);
  const marker = typeof controlSource.marker === "string" ? controlSource.marker.trim() : "";
  if (marker === "") {
    reasons.push("control_source.marker is missing (a stable source marker is required)");
  }
  let diskBytes = null;
  let diskSha = null;
  const declaredPath = typeof controlSource.path === "string" && controlSource.path.trim() !== "" ? controlSource.path : null;
  if (declaredPath) {
    const abs = resolveEntryPath(base, declaredPath);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      reasons.push(`control_source.path missing on disk: ${declaredPath}`);
    } else {
      const buf = readFileSync(abs);
      diskBytes = buf.length;
      diskSha = sha256(buf);
      if (typeof controlSource.sha256 === "string" && controlSource.sha256.trim() !== "") {
        if (controlSource.sha256 !== diskSha) {
          reasons.push("control_source.sha256 mismatch (control file changed, truncated, or wrong file)");
        }
      } else {
        reasons.push("control_source.sha256 is required when control_source.path is present");
      }
      if (marker !== "" && !buf.toString("utf8").includes(marker)) {
        reasons.push("control_source.marker not found in the control file (source not actually present)");
      }
    }
  }

  // Uptake receipt: proves the marker was actually observed from the loaded control layer.
  // A bare observed:true with no marker linkage is a self-assertion and is rejected.
  const uptake = asObject(proof.uptake_receipt);
  if (!proof.uptake_receipt || typeof proof.uptake_receipt !== "object" || Array.isArray(proof.uptake_receipt)) {
    reasons.push("missing uptake_receipt");
  } else {
    if (uptake.observed !== true) {
      reasons.push("uptake_receipt.observed must be true (protocol uptake not proven)");
    }
    const evidenceMarker = typeof uptake.evidence_marker === "string" ? uptake.evidence_marker.trim() : "";
    if (evidenceMarker === "") {
      reasons.push("uptake_receipt.evidence_marker is missing (self-asserted uptake without a stable source marker is not accepted)");
    } else if (marker !== "" && evidenceMarker !== marker) {
      reasons.push("uptake_receipt.evidence_marker does not match control_source.marker (uptake not linked to the control source)");
    }
    if (typeof uptake.method !== "string" || uptake.method.trim() === "") {
      reasons.push("uptake_receipt.method is missing");
    }
    if (typeof uptake.observed_at === "string" && uptake.observed_at.trim() !== "") {
      const age = ageSeconds(uptake.observed_at, nowMs);
      if (age === null) reasons.push("uptake_receipt.observed_at is not a valid timestamp");
      else if (age > maxAgeSeconds) reasons.push(`stale uptake: observed_at is older than ${maxAgeSeconds}s`);
    } else {
      reasons.push("uptake_receipt.observed_at is missing");
    }
  }

  // Freshness of the proof itself.
  if (typeof proof.generated_at === "string" && proof.generated_at.trim() !== "") {
    const age = ageSeconds(proof.generated_at, nowMs);
    if (age === null) reasons.push("generated_at is not a valid timestamp");
    else if (age > maxAgeSeconds) reasons.push(`stale proof: generated_at is older than ${maxAgeSeconds}s`);
  }

  return {
    ok: reasons.length === 0,
    base,
    schema: proof.schema,
    role: typeof proof.role === "string" ? proof.role : null,
    harness: typeof proof.harness === "string" ? proof.harness : null,
    sourceType: typeof proof.source_type === "string" ? proof.source_type : null,
    marker: marker || null,
    declaredPath,
    diskBytes,
    diskSha,
    reasons
  };
}

export function recordGovernedContextProof(options = {}) {
  const {
    sourcePath,
    marker,
    sourceType = "native_skill",
    harness = "unknown",
    harnessCategory = "unknown",
    role = "UNDECLARED",
    version,
    base = ".",
    now
  } = options;

  if (typeof marker !== "string" || marker.trim() === "") {
    throw new Error("--marker is required and must be a stable, non-secret source marker");
  }
  if (containsSecretLikeValue(marker)) {
    throw new Error("--marker looks like a secret; markers must be non-secret protocol identifiers");
  }
  const generatedAt = (now !== undefined && now !== null ? new Date(now) : new Date()).toISOString();
  const controlSource = { marker };
  if (typeof version === "string" && version.trim() !== "") controlSource.version = version;

  if (typeof sourcePath === "string" && sourcePath.trim() !== "") {
    const abs = resolveEntryPath(base, sourcePath);
    const buf = readFileSync(abs);
    if (!buf.toString("utf8").includes(marker)) {
      throw new Error(`marker not found in control source ${sourcePath}; cannot record a valid proof`);
    }
    controlSource.path = sourcePath;
    controlSource.bytes = buf.length;
    controlSource.sha256 = sha256(buf);
  }

  return {
    schema: SCHEMA_ID,
    role,
    harness,
    harness_category: harnessCategory,
    source_type: sourceType,
    control_source: controlSource,
    uptake_receipt: {
      method: "quoted_marker",
      evidence_marker: marker,
      observed: true,
      observed_at: generatedAt
    },
    generated_at: generatedAt
  };
}

function parseArgs(argv) {
  const args = {
    positional: [],
    base: ".",
    role: "UNDECLARED",
    json: false,
    help: false,
    record: false,
    source: undefined,
    marker: undefined,
    sourceType: "native_skill",
    harness: "unknown",
    harnessCategory: "unknown",
    version: undefined,
    now: undefined,
    maxAgeSeconds: undefined
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--json") args.json = true;
    else if (a === "--record") args.record = true;
    else if (a === "--base") args.base = argv[++i] ?? ".";
    else if (a === "--role") args.role = argv[++i] ?? "UNDECLARED";
    else if (a === "--source") args.source = argv[++i];
    else if (a === "--marker") args.marker = argv[++i];
    else if (a === "--source-type") args.sourceType = argv[++i] ?? "native_skill";
    else if (a === "--harness") args.harness = argv[++i] ?? "unknown";
    else if (a === "--harness-category") args.harnessCategory = argv[++i] ?? "unknown";
    else if (a === "--version") args.version = argv[++i];
    else if (a === "--now") args.now = argv[++i];
    else if (a === "--max-age-seconds") args.maxAgeSeconds = Number(argv[++i]);
    else args.positional.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (args.record) {
    let proof;
    try {
      proof = recordGovernedContextProof({
        sourcePath: args.source,
        marker: args.marker,
        sourceType: args.sourceType,
        harness: args.harness,
        harnessCategory: args.harnessCategory,
        role: args.role,
        version: args.version,
        base: args.base,
        now: args.now
      });
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }
    console.log(JSON.stringify(proof, null, 2));
    process.exit(0);
  }

  const proofPath = args.positional[0];
  if (!proofPath) {
    console.error("error: missing <proof.json> argument");
    console.error("run with --help for usage");
    process.exit(2);
  }

  let proof;
  try {
    proof = JSON.parse(readFileSync(resolve(process.cwd(), proofPath), "utf8"));
  } catch (err) {
    console.error(`error: cannot read or parse proof file: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const result = verifyGovernedContextProof(proof, { base: args.base, now: args.now, maxAgeSeconds: args.maxAgeSeconds });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`governed-context verify (base: ${result.base})`);
    console.log(`  harness: ${result.harness ?? "<unknown>"}  source_type: ${result.sourceType ?? "<unknown>"}  marker: ${result.marker ?? "<none>"}`);
    if (result.declaredPath) {
      console.log(`  control source: ${result.declaredPath} (${result.diskBytes ?? "?"} bytes, sha256 ${result.diskSha ? result.diskSha.slice(0, 12) + "…" : "n/a"})`);
    }
    if (result.ok) {
      console.log("  [PASS] governed-context proof verified; control layer loaded and uptake proven");
    } else {
      for (const reason of result.reasons) console.log(`  [FAIL] ${reason}`);
    }
  }

  process.exit(result.ok ? 0 : 1);
}

// Only run the CLI when invoked directly, not when imported by tests.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main();
}
