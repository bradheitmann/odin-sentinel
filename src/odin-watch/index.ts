#!/usr/bin/env node
import { parseArgs } from "node:util";
import { CmuxBackend } from "./backends/cmux.js";
import { classify } from "./classifier.js";
import { writeWakeFiles } from "./writers.js";
import { execFileNoThrow } from "../utils/execFileNoThrow.js";
import type {
  SubstrateType,
  WakeState,
  WakeVerdict,
} from "../protocol/schemas.js";

const VALID_SUBSTRATES: SubstrateType[] = [
  "cmux",
  "tmux",
  "minimux",
  "herdr",
  "plain",
];

function isValidSubstrate(s: string): s is SubstrateType {
  return (VALID_SUBSTRATES as string[]).includes(s);
}

function parseCliArgs(): {
  surface: string;
  substrate: SubstrateType;
  writeScope: string[];
  intervalSeconds: number;
  mandatoryAuditSeconds: number;
  flagDir: string;
  archiveDir: string;
  label: string;
} {
  const { values } = parseArgs({
    options: {
      surface: { type: "string" },
      substrate: { type: "string" },
      "write-scope": { type: "string", multiple: true },
      interval: { type: "string", default: "120" },
      "mandatory-audit": { type: "string", default: "600" },
      "flag-dir": {
        type: "string",
        default: ".odin/monitor/wake/",
      },
      "archive-dir": {
        type: "string",
        default: ".odin/monitor/cmux/",
      },
      label: { type: "string" },
    },
    strict: true,
  });

  const surface = values["surface"];
  const substrate = values["substrate"];
  const label = values["label"];

  if (!surface) {
    console.error("Error: --surface <id> is required");
    process.exit(1);
  }
  if (!substrate) {
    console.error("Error: --substrate <type> is required");
    process.exit(1);
  }
  if (!isValidSubstrate(substrate)) {
    console.error(
      `Error: --substrate must be one of: ${VALID_SUBSTRATES.join(", ")}`
    );
    process.exit(1);
  }
  if (!label) {
    console.error("Error: --label <name> is required");
    process.exit(1);
  }

  const intervalSeconds = parseInt(values["interval"] ?? "120", 10);
  const mandatoryAuditSeconds = parseInt(
    values["mandatory-audit"] ?? "600",
    10
  );

  if (isNaN(intervalSeconds) || intervalSeconds <= 0) {
    console.error("Error: --interval must be a positive integer");
    process.exit(1);
  }
  if (isNaN(mandatoryAuditSeconds) || mandatoryAuditSeconds <= 0) {
    console.error("Error: --mandatory-audit must be a positive integer");
    process.exit(1);
  }

  return {
    surface,
    substrate,
    writeScope: (values["write-scope"] as string[] | undefined) ?? [],
    intervalSeconds,
    mandatoryAuditSeconds,
    flagDir: values["flag-dir"] ?? ".odin/monitor/wake/",
    archiveDir: values["archive-dir"] ?? ".odin/monitor/cmux/",
    label,
  };
}

async function getDirtyPaths(): Promise<string[]> {
  const result = await execFileNoThrow("git", [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRT",
  ]);
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

async function getCurrentBranch(): Promise<string | undefined> {
  const result = await execFileNoThrow("git", [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  return result.status === 0 ? result.stdout.trim() : undefined;
}

async function getCurrentHead(): Promise<string | undefined> {
  const result = await execFileNoThrow("git", ["rev-parse", "--short", "HEAD"]);
  return result.status === 0 ? result.stdout.trim() : undefined;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const {
    surface,
    substrate,
    writeScope,
    intervalSeconds,
    mandatoryAuditSeconds,
    flagDir,
    archiveDir,
    label,
  } = parseCliArgs();

  const intervalMs = intervalSeconds * 1000;
  const mandatoryAuditIntervalMs = mandatoryAuditSeconds * 1000;

  // Only cmux substrate is currently supported; others fallback gracefully
  const snapshotter = new CmuxBackend(archiveDir);

  let prevHash: string | null = null;
  let lastVerdictState: WakeVerdict | null = null;
  let lastMandatoryAuditTs: number | null = null;
  const startTs = Date.now();

  console.error(
    `odin-watch starting: surface=${surface} substrate=${substrate} label=${label} interval=${intervalSeconds}s`
  );

  while (true) {
    const loopStart = Date.now();
    const elapsed = loopStart - startTs;

    try {
      // Capture
      const snapshot = await snapshotter.capture(surface);

      // Gather dirty paths and git metadata
      const [dirtyPaths, branch, head] = await Promise.all([
        getDirtyPaths(),
        getCurrentBranch(),
        getCurrentHead(),
      ]);

      // Classify
      const result = classify({
        text: snapshot.text,
        hash: snapshot.hash,
        prev_hash: prevHash,
        elapsed_ms: elapsed,
        now_ms: Date.now(),
        mandatory_audit_interval_ms: mandatoryAuditIntervalMs,
        stale_threshold_ms: intervalMs * 3, // stale after 3 missed polls
        write_scope: writeScope,
        dirty_paths: dirtyPaths,
        last_verdict: lastVerdictState,
        last_mandatory_audit_ts: lastMandatoryAuditTs,
      });

      // If mandatory audit triggered, reset the audit clock
      if (result.reason_codes.includes("MANDATORY_AUDIT interval elapsed")) {
        lastMandatoryAuditTs = loopStart;
      }

      // Build WakeState
      const wakeState: WakeState = {
        schema_version: "1.0",
        ts: new Date(loopStart).toISOString(),
        surface,
        pane_id: surface,
        substrate: substrate as SubstrateType,
        state: result.verdict,
        wake: result.wake,
        reason_codes: result.reason_codes,
        dirty_paths: dirtyPaths,
        dirty_out_of_scope: result.dirty_out_of_scope,
        screen_hash: snapshot.hash,
        screen_changed: prevHash !== null && prevHash !== snapshot.hash,
        last_marker: result.last_marker,
        prompt_budget_class: result.prompt_budget_class,
        next_mandatory_audit_due: new Date(
          loopStart + mandatoryAuditIntervalMs
        ).toISOString(),
        head,
        branch,
      };

      // Write output files
      writeWakeFiles(flagDir, label, wakeState);

      prevHash = snapshot.hash;
      lastVerdictState = result.verdict;

      console.error(
        `[${wakeState.ts}] verdict=${result.verdict} wake=${result.wake} hash=${snapshot.hash.slice(0, 8)}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`odin-watch poll error: ${msg}`);
    }

    // Sleep until next interval
    const elapsed2 = Date.now() - loopStart;
    const remaining = intervalMs - elapsed2;
    if (remaining > 0) {
      await sleep(remaining);
    }
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`odin-watch fatal: ${msg}`);
  process.exitCode = 1;
});
