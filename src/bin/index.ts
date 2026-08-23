#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../mcp/server.js";

/**
 * odin-sentinel CLI. With no subcommand this is the MCP server over stdio
 * (unchanged). Subcommands:
 *
 *   compact-registry --scope <scope> [--base <dir>] [--now <iso>]
 *                      [--ttl-days <n>] [--dry-run]
 *
 * Compact one registry scope's log per the proof TTL policy (GD-DEC-006;
 * doctrine: protocol/resources/proof-ttl.yaml). --dry-run reports what WOULD
 * compact and writes nothing. Output is a machine-readable JSON compaction
 * report on stdout; refusals and failures go to stderr with a nonzero exit
 * code. No Markdown or human-view generation (DIS-001).
 *
 * The compaction module is loaded lazily via dynamic import: the MCP server
 * startup path never loads it, and the event-registry runtime-isolation
 * invariant (no static `from ...event-registry` coupling in runtime hosts)
 * holds.
 */

const COMPACT_REGISTRY_SUBCOMMAND = "compact-registry";

/** Stdout/stderr seams so tests can capture output without process mocking. */
export interface CompactRegistryCliIo {
  out?: (line: string) => void;
  err?: (line: string) => void;
}

/**
 * Run the compact-registry subcommand. Returns the exit code; never calls
 * process.exit (the caller owns the process). Fail-closed: argument faults,
 * named rejections, and unexpected fs errors all exit nonzero.
 */
export async function runCompactRegistryCli(argv: string[], io: CompactRegistryCliIo = {}): Promise<number> {
  const out = io.out ?? ((line: string) => console.log(line));
  const err = io.err ?? ((line: string) => console.error(line));

  let values: {
    scope?: string;
    base?: string;
    now?: string;
    "ttl-days"?: string;
    "dry-run"?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        scope: { type: "string" },
        base: { type: "string" },
        now: { type: "string" },
        "ttl-days": { type: "string" },
        "dry-run": { type: "boolean", default: false }
      },
      strict: true
    }));
  } catch (error) {
    err(`odin-sentinel compact-registry: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (values.scope === undefined || values.scope.trim() === "") {
    err("odin-sentinel compact-registry: --scope <scope> is required");
    return 1;
  }

  let ttlDays: number | undefined;
  if (values["ttl-days"] !== undefined) {
    ttlDays = Number(values["ttl-days"]);
    if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
      err(`odin-sentinel compact-registry: --ttl-days must be a positive number of days; rejected: ${JSON.stringify(values["ttl-days"])}`);
      return 1;
    }
  }

  // Lazy load: the MCP server path never pays for (or statically couples to)
  // the event-registry module.
  const { compactRegistryEvents } = await import("../protocol/event-registry/compact.js");

  let result;
  try {
    result = compactRegistryEvents(values.scope, {
      ...(values.base !== undefined ? { base: values.base } : {}),
      ...(values.now !== undefined ? { now: values.now } : {}),
      ...(ttlDays !== undefined ? { ttlDays } : {}),
      dryRun: values["dry-run"] === true
    });
  } catch (error) {
    err(`odin-sentinel compact-registry failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (!result.ok) {
    err(`odin-sentinel compact-registry refused: ${result.rejections.map((rejection) => `${rejection.code}(${rejection.field})`).join(", ")}`);
    err(JSON.stringify({ ok: false, rejections: result.rejections }, null, 2));
    return 1;
  }

  out(JSON.stringify({ ok: true, ...result.report }, null, 2));
  return 0;
}

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2);
  if (subcommand === COMPACT_REGISTRY_SUBCOMMAND) {
    process.exitCode = await runCompactRegistryCli(rest);
    return;
  }

  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

/**
 * Run main() only when this file is the invoked entry point, so tests can
 * import the subcommand runner without starting the MCP server. Realpath
 * comparison keeps bin shims and symlinks working.
 */
function isInvokedEntrypoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isInvokedEntrypoint()) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown startup failure";
    console.error(`odin-sentinel failed to start: ${message}`);
    process.exitCode = 1;
  }
}
