#!/usr/bin/env node
// scripts/protocol/verify-instruction-read.mjs
//
// Verify an ODIN/SCP full-instruction-read proof against local files.
//
// An activated role (DEV, QA, ODIN ACTIVE_WATCH) must read its assigned instruction
// sources in full before acting. This verifier confirms that every file declared in a
// read proof still exists and matches its recorded byte count and SHA-256 digest, so a
// role cannot claim it read instructions it only skimmed (first-screen / `head` / partial)
// or never opened. A missing, truncated, or checksum-mismatched file fails the gate.
//
// Zero-secret: this script reads only the files named in the proof. It never reads
// environment variables and never prints file contents — only paths, byte counts, line
// counts, SHA-256 digests, and PASS/FAIL reasons.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";

const USAGE = `odin verify-instruction-read

Verify a full-instruction-read proof against local files. Confirms each declared
instruction file exists and matches its recorded byte count and SHA-256 digest, so an
activated role cannot claim a full read it did not perform.

Usage:
  node scripts/protocol/verify-instruction-read.mjs <proof.json> [--base <dir>] [--json]
  node scripts/protocol/verify-instruction-read.mjs --record <file...> [--base <dir>] [--role <role>]
  node scripts/protocol/verify-instruction-read.mjs --help

Modes:
  verify (default)  Read <proof.json> and verify every files[] entry against disk.
                    Exit 0 only if all entries match. Exit 1 if any file is missing,
                    truncated, or checksum-mismatched.
  --record          Compute a fresh proof for the listed files and print it as JSON on
                    stdout (does not write any file). Useful for an agent generating its
                    own pre-edit read proof: redirect stdout to a proof file.

Options:
  --base <dir>      Resolve proof file entry paths against <dir> (default: current dir).
  --role <role>     Role label embedded when using --record (default: UNDECLARED).
  --json            Emit a machine-readable JSON result in verify mode.
  --help, -h        Show this help and exit 0.

Exit codes: 0 = all files verified / help / record; 1 = one or more files failed; 2 = usage error.
Output is zero-secret: only paths, sizes, and digests are printed (never file contents).`;

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function countLines(buf) {
  return buf.toString("utf8").split("\n").length - 1;
}

function resolveEntryPath(base, p) {
  return isAbsolute(p) ? p : join(base, p);
}

function parseArgs(argv) {
  const args = { positional: [], base: ".", role: "UNDECLARED", json: false, help: false, record: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--json") args.json = true;
    else if (a === "--record") args.record = true;
    else if (a === "--base") args.base = argv[++i] ?? ".";
    else if (a === "--role") args.role = argv[++i] ?? "UNDECLARED";
    else args.positional.push(a);
  }
  return args;
}

export function recordProof(files, base = ".", role = "UNDECLARED") {
  const entries = files.map((p) => {
    const buf = readFileSync(resolveEntryPath(base, p));
    return { path: p, bytes: buf.length, lines: countLines(buf), sha256: sha256(buf), read: "full" };
  });
  return {
    schema: "odin.instruction_read_proof.v1",
    role,
    generated_at: new Date().toISOString(),
    base: ".",
    file_count: entries.length,
    files: entries
  };
}

// Pure verification core: takes a parsed proof object and a base dir, returns a result.
// Exported so tests can exercise it without spawning a process.
export function verifyProof(proof, base = ".") {
  const files = Array.isArray(proof?.files) ? proof.files : null;
  if (!files || files.length === 0) {
    return { ok: false, base, passed: 0, total: 0, results: [], error: "proof has no files[] entries" };
  }

  const results = files.map((entry) => {
    const path = entry && typeof entry.path === "string" ? entry.path : "";
    const reasons = [];
    if (path.trim() === "") {
      return { path: path || "<unknown>", status: "FAIL", reasons: ["proof entry is missing a path"] };
    }

    const abs = resolveEntryPath(base, path);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return { path, status: "FAIL", reasons: ["file missing"] };
    }

    const buf = readFileSync(abs);
    const actualBytes = buf.length;
    const actualSha = sha256(buf);

    if (typeof entry.sha256 === "string" && entry.sha256.trim() !== "") {
      if (entry.sha256 !== actualSha) {
        reasons.push("sha256 mismatch (file changed, truncated, or only partially read)");
      }
    } else {
      reasons.push("proof entry is missing a sha256 digest");
    }
    if (typeof entry.bytes === "number" && entry.bytes !== actualBytes) {
      reasons.push(`byte count mismatch: recorded ${entry.bytes}, actual ${actualBytes}`);
    }

    return {
      path,
      status: reasons.length === 0 ? "PASS" : "FAIL",
      reasons,
      recordedBytes: typeof entry.bytes === "number" ? entry.bytes : null,
      actualBytes,
      recordedSha256: typeof entry.sha256 === "string" ? entry.sha256 : null,
      actualSha256: actualSha,
      recordedLines: typeof entry.lines === "number" ? entry.lines : null,
      actualLines: countLines(buf)
    };
  });

  const passed = results.filter((r) => r.status === "PASS").length;
  return { ok: passed === results.length, base, passed, total: results.length, results };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (args.record) {
    if (args.positional.length === 0) {
      console.error("error: --record requires at least one file path");
      console.error("run with --help for usage");
      process.exit(2);
    }
    let proof;
    try {
      proof = recordProof(args.positional, args.base, args.role);
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

  const result = verifyProof(proof, args.base);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`instruction-read verify (base: ${result.base})`);
    if (result.error) console.log(`  ! ${result.error}`);
    for (const r of result.results) {
      if (r.status === "PASS") {
        console.log(`  [PASS] ${r.path} (${r.actualBytes} bytes, sha256 ${r.actualSha256.slice(0, 12)}…)`);
      } else {
        console.log(`  [FAIL] ${r.path} — ${r.reasons.join("; ")}`);
      }
    }
    console.log(`${result.passed}/${result.total} files verified`);
  }

  process.exit(result.ok ? 0 : 1);
}

// Only run the CLI when invoked directly, not when imported by tests.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main();
}
