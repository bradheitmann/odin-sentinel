#!/usr/bin/env node
// scripts/protocol/install-activation-hooks.mjs
//
// Install (or preview) the ODIN/SCP activation-gate hook that forces full-instruction-read
// proof before an activated role begins implementation, QA acceptance, or ACTIVE_WATCH work.
//
// The hook is intentionally a small, dependency-free shell wrapper that runs the
// instruction-read verifier against a declared proof file and refuses to proceed unless the
// verifier exits 0. This makes "did the agent actually read its instructions?" a
// machine-checkable gate instead of an honor-system claim.
//
// Safety: default mode is a dry-run that prints the plan and the hook body. Files are only
// written when --install --target <dir> is given explicitly. Zero-secret: no environment
// values are read or printed.

import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";

const HOOK_FILENAME = "odin-activation-precheck.sh";

const USAGE = `odin install-activation-hooks

Install or preview the SCP activation-gate precheck hook. The hook runs the
instruction-read verifier before an activated role acts, and blocks activation unless a
full-instruction-read proof verifies against local files.

Usage:
  node scripts/protocol/install-activation-hooks.mjs               # dry-run: print plan + hook
  node scripts/protocol/install-activation-hooks.mjs --print-hook  # print hook body only
  node scripts/protocol/install-activation-hooks.mjs --install --target <dir>
  node scripts/protocol/install-activation-hooks.mjs --help

Options:
  --install         Write the hook file. Requires --target.
  --target <dir>    Directory to write ${HOOK_FILENAME} into (created if absent).
  --print-hook      Print the hook script body to stdout and exit 0.
  --force           Overwrite an existing hook file when installing.
  --help, -h        Show this help and exit 0.

Exit codes: 0 = help / dry-run / print / successful install; 2 = usage error;
3 = refused to overwrite without --force.
Zero-secret: this installer reads no environment variables and prints no secrets.`;

// The activation precheck hook body. Pure POSIX sh; calls the sibling verifier.
export function renderHookScript() {
  return `#!/bin/sh
# odin-activation-precheck.sh — installed by scripts/protocol/install-activation-hooks.mjs
#
# Block an activated SCP role from acting until its full-instruction-read proof verifies.
# Usage: odin-activation-precheck.sh <proof.json> [--base <dir>]
#
# Wire this into a harness pre-activation step, a git pre-commit hook, or a launch runbook
# so implementation / QA / ACTIVE_WATCH work cannot start on a skimmed instruction set.
set -eu

PROOF="\${1:-}"
if [ -z "\$PROOF" ]; then
  echo "odin-activation-precheck: missing <proof.json> argument" >&2
  echo "an activated role must declare and verify a full-instruction-read proof first" >&2
  exit 2
fi
shift || true

SCRIPT_DIR=\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)
VERIFIER="\$SCRIPT_DIR/verify-instruction-read.mjs"
if [ ! -f "\$VERIFIER" ]; then
  # Fall back to the repo-relative protocol script location.
  VERIFIER="scripts/protocol/verify-instruction-read.mjs"
fi

echo "odin-activation-precheck: verifying full-instruction-read proof \$PROOF"
if node "\$VERIFIER" "\$PROOF" "\$@"; then
  echo "odin-activation-precheck: PASS — instruction-read proof verified; activation allowed"
  exit 0
else
  echo "odin-activation-precheck: FAIL — instruction-read proof did not verify; activation blocked" >&2
  echo "read the declared instruction files in full and regenerate the proof before acting" >&2
  exit 1
fi
`;
}

export function planInstall(target) {
  return {
    action: "install-activation-hooks",
    hookFile: target ? join(target, HOOK_FILENAME) : `<target>/${HOOK_FILENAME}`,
    verifier: "scripts/protocol/verify-instruction-read.mjs",
    gates: [
      "An activated role must produce a full-instruction-read proof before implementation, QA acceptance, or ACTIVE_WATCH work.",
      "The precheck hook runs verify-instruction-read.mjs and blocks activation unless it exits 0.",
      "CMUX dispatch must additionally satisfy delivery proof: submitted=true plus verified processing on the target surface."
    ],
    mcp: ["odin.get_activation_gates", "odin.validate_instruction_read_proof", "odin.validate_cmux_delivery_proof"],
    wiring: [
      "harness pre-activation step (preferred)",
      "git pre-commit / pre-push hook",
      "launch runbook checklist step"
    ]
  };
}

function parseArgs(argv) {
  const args = { install: false, printHook: false, force: false, help: false, target: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--install") args.install = true;
    else if (a === "--print-hook") args.printHook = true;
    else if (a === "--force") args.force = true;
    else if (a === "--target") args.target = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (args.printHook) {
    process.stdout.write(renderHookScript());
    process.exit(0);
  }

  if (!args.install) {
    // Dry-run: show the plan and the hook body without writing anything.
    console.log("odin install-activation-hooks (dry-run; no files written)");
    console.log(JSON.stringify(planInstall(args.target), null, 2));
    console.log("");
    console.log(`Run with --install --target <dir> to write ${HOOK_FILENAME}.`);
    console.log("--- hook body ---");
    process.stdout.write(renderHookScript());
    process.exit(0);
  }

  if (!args.target) {
    console.error("error: --install requires --target <dir>");
    console.error("run with --help for usage");
    process.exit(2);
  }

  const targetDir = resolve(process.cwd(), args.target);
  const hookPath = join(targetDir, HOOK_FILENAME);
  if (existsSync(hookPath) && !args.force) {
    console.error(`refused: ${hookPath} already exists (use --force to overwrite)`);
    process.exit(3);
  }

  mkdirSync(targetDir, { recursive: true });
  writeFileSync(hookPath, renderHookScript());
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // chmod is best-effort on platforms that do not support it.
  }
  console.log(`installed activation precheck hook: ${hookPath}`);
  console.log("wire it into a harness pre-activation step, git hook, or launch runbook.");
  process.exit(0);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main();
}
