#!/usr/bin/env node
// scripts/protocol/install-activation-hooks.mjs
//
// Install (or preview) the ODIN/SCP activation-gate hook that forces full-instruction-read
// proof — and, when supplied, governed-context proof — before an activated role begins
// implementation, QA acceptance, or ACTIVE_WATCH work.
//
// The hook is intentionally a small, dependency-free shell wrapper that runs the
// instruction-read verifier (and, when a governed-context proof is passed, the governed-context
// verifier) against declared proof files and refuses to proceed unless they exit 0. This makes
// "did the agent actually read its instructions?" AND "did the harness actually load and take
// up the SCP control layer?" machine-checkable gates instead of honor-system claims. Presence
// of MCP config or a skill file on disk is never sufficient for governed authority.
//
// Safety: default mode is a dry-run that prints the plan and the hook body. Files are only
// written when --install --target <dir> is given explicitly. Zero-secret: no environment
// values are read or printed.

import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";

const HOOK_FILENAME = "odin-activation-precheck.sh";

const USAGE = `odin install-activation-hooks

Install or preview the SCP activation-gate precheck hook. The hook runs the instruction-read
verifier before an activated role acts, and — when a governed-context proof is supplied — the
governed-context verifier (scripts/protocol/verify-governed-context.mjs). It blocks activation
unless the declared proofs verify against local files. Governed authority is fail-closed: MCP
being configured or a skill existing on disk is never enough; protocol uptake must be verified.

Usage:
  node scripts/protocol/install-activation-hooks.mjs               # dry-run: print plan + hook
  node scripts/protocol/install-activation-hooks.mjs --print-hook  # print hook body only
  node scripts/protocol/install-activation-hooks.mjs --install --target <dir>
  node scripts/protocol/install-activation-hooks.mjs --help

The installed hook accepts: <instruction-read-proof.json> [--governed-context <proof.json>] [--base <dir>].

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
# Block an activated SCP role from acting until its activation proofs verify:
#   1. full-instruction-read proof (verify-instruction-read.mjs) — always.
#   2. governed-context proof (verify-governed-context.mjs) — when --governed-context is given.
# Governed authority is fail-closed: MCP being configured or a skill on disk is NOT enough;
# protocol uptake must be verified before a governed occupant acts.
#
# Usage: odin-activation-precheck.sh <instruction-read-proof.json> [--governed-context <proof.json>] [--base <dir>]
#
# Wire this into a harness pre-activation step, a git pre-commit hook, or a launch runbook
# so implementation / QA / ACTIVE_WATCH work cannot start on a skimmed instruction set or
# without proven SCP control-layer uptake.
set -eu

PROOF="\${1:-}"
if [ -z "\$PROOF" ]; then
  echo "odin-activation-precheck: missing <instruction-read-proof.json> argument" >&2
  echo "an activated role must declare and verify a full-instruction-read proof first" >&2
  exit 2
fi
shift || true

GOVERNED_PROOF=""
BASE_DIR=""
while [ \$# -gt 0 ]; do
  case "\$1" in
    --governed-context) GOVERNED_PROOF="\${2:-}"; shift 2 || true ;;
    --base) BASE_DIR="\${2:-}"; shift 2 || true ;;
    *) shift || true ;;
  esac
done

SCRIPT_DIR=\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)
IR_VERIFIER="\$SCRIPT_DIR/verify-instruction-read.mjs"
[ -f "\$IR_VERIFIER" ] || IR_VERIFIER="scripts/protocol/verify-instruction-read.mjs"
GC_VERIFIER="\$SCRIPT_DIR/verify-governed-context.mjs"
[ -f "\$GC_VERIFIER" ] || GC_VERIFIER="scripts/protocol/verify-governed-context.mjs"

echo "odin-activation-precheck: verifying full-instruction-read proof \$PROOF"
if [ -n "\$BASE_DIR" ]; then
  node "\$IR_VERIFIER" "\$PROOF" --base "\$BASE_DIR" || { echo "odin-activation-precheck: FAIL — instruction-read proof did not verify; activation blocked" >&2; exit 1; }
else
  node "\$IR_VERIFIER" "\$PROOF" || { echo "odin-activation-precheck: FAIL — instruction-read proof did not verify; activation blocked" >&2; exit 1; }
fi

if [ -n "\$GOVERNED_PROOF" ]; then
  echo "odin-activation-precheck: verifying governed-context proof \$GOVERNED_PROOF"
  if [ -n "\$BASE_DIR" ]; then
    node "\$GC_VERIFIER" "\$GOVERNED_PROOF" --base "\$BASE_DIR" || { echo "odin-activation-precheck: FAIL — governed-context proof did not verify; governed activation blocked" >&2; exit 1; }
  else
    node "\$GC_VERIFIER" "\$GOVERNED_PROOF" || { echo "odin-activation-precheck: FAIL — governed-context proof did not verify; governed activation blocked" >&2; exit 1; }
  fi
fi

echo "odin-activation-precheck: PASS — activation proofs verified; activation allowed"
exit 0
`;
}

export function planInstall(target) {
  return {
    action: "install-activation-hooks",
    hookFile: target ? join(target, HOOK_FILENAME) : `<target>/${HOOK_FILENAME}`,
    verifier: "scripts/protocol/verify-instruction-read.mjs",
    governedContextVerifier: "scripts/protocol/verify-governed-context.mjs",
    gates: [
      "An activated role must produce a full-instruction-read proof before implementation, QA acceptance, or ACTIVE_WATCH work.",
      "A governed-role occupant must additionally produce a governed-context proof: presence of MCP config or a skill file on disk is not authority; protocol uptake must be verified.",
      "The precheck hook runs verify-instruction-read.mjs (and verify-governed-context.mjs when --governed-context is given) and blocks activation unless they exit 0.",
      "CMUX dispatch must additionally satisfy delivery proof: submitted=true plus verified processing on the target surface."
    ],
    mcp: ["odin.get_activation_gates", "odin.validate_instruction_read_proof", "odin.validate_cmux_delivery_proof"],
    governedContext: {
      note: "Governed readiness is fail-closed (GOVERNED_READY / FIXABLE_BLOCKED / NON_GOVERNED_ONE_SHOT_ONLY / UNSUPPORTED). The installer never writes into harness skill/config directories; it only writes the precheck hook into the explicit --target dir.",
      verifier: "scripts/protocol/verify-governed-context.mjs",
      surfacedBy: ["odin.get_activation_gates", "odin.get_harness_probe_matrix", "odin.evaluate_readiness_gate", "odin.get_onboarding_plan"]
    },
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
