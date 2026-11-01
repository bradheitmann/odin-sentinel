#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveMcpCapabilities, type McpCapability } from "../mcp/capabilities.js";
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
const LEASE_SUBCOMMAND = "lease";

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


/** Stdout/stderr seams so tests can capture output without process mocking. */
export interface LeaseCliIo {
  out?: (line: string) => void;
  err?: (line: string) => void;
}

/**
 * Run the `lease` subcommand:
 *
 *   odin-sentinel lease <acquire|renew|release|check|status> --dir <dir> --slot <id>
 *                       [--holder <id>] [--ttl <seconds>] [--token <n>]
 *
 * Prints exactly one JSON object on stdout and exits 0 on success, 1 on a typed refusal.
 * The lease module is loaded lazily, so the MCP server startup path never loads it (the
 * runtime-isolation invariant holds).
 */
export async function runLeaseCli(argv: string[], io: LeaseCliIo = {}): Promise<number> {
  const out = io.out ?? ((line: string) => console.log(line));
  const err = io.err ?? ((line: string) => console.error(line));

  let values: {
    dir?: string;
    slot?: string;
    slots?: string;
    holder?: string;
    ttl?: string;
    token?: string;
  };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        dir: { type: "string" },
        slot: { type: "string" },
        slots: { type: "string" },
        holder: { type: "string" },
        ttl: { type: "string" },
        token: { type: "string" }
      },
      allowPositionals: true,
      strict: true
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (error) {
    out(JSON.stringify({ ok: false, code: "invalid_args", detail: error instanceof Error ? error.message : String(error) }, null, 2));
    return 1;
  }

  const operation = positionals[0];
  if (values.slot !== undefined && values.slots !== undefined) {
    out(JSON.stringify({ ok: false, code: "invalid_args", detail: "--slot and --slots are mutually exclusive; use one of them" }, null, 2));
    return 1;
  }
  if (operation !== undefined && operation !== "acquire" && values.slots !== undefined) {
    out(JSON.stringify({ ok: false, code: "invalid_args", detail: "--slots is only valid for acquire; use --slot for this operation" }, null, 2));
    return 1;
  }
  if (operation === undefined) {
    out(JSON.stringify({ ok: false, code: "invalid_args", detail: "operation is required: acquire|renew|release|check|status" }, null, 2));
    return 1;
  }
  if (values.dir === undefined || values.dir.trim() === "") {
    out(JSON.stringify({ ok: false, code: "invalid_args", detail: "--dir <dir> is required (there is no default lease directory)" }, null, 2));
    return 1;
  }
  const hasSlot = values.slot !== undefined && values.slot.trim() !== "";
  const hasSlots = values.slots !== undefined && values.slots.trim() !== "";
  if (operation !== "acquire" && !hasSlot) {
    out(JSON.stringify({ ok: false, code: "invalid_args", detail: `--slot <id> is required for ${operation}` }, null, 2));
    return 1;
  }
  if (operation === "acquire" && !hasSlot && !hasSlots) {
    out(JSON.stringify({ ok: false, code: "invalid_args", detail: "--slot <id>, or --slots a,b for any-of acquire, is required" }, null, 2));
    return 1;
  }

  const ttl = values.ttl === undefined ? undefined : Number(values.ttl);
  if (ttl !== undefined && (!Number.isFinite(ttl) || ttl <= 0)) {
    out(JSON.stringify({ ok: false, code: "invalid_ttl", detail: `--ttl must be a positive number of seconds; rejected: ${JSON.stringify(values.ttl)}` }, null, 2));
    return 1;
  }
  const token = values.token === undefined ? undefined : Number(values.token);
  if (token !== undefined && (!Number.isInteger(token) || token < 0)) {
    out(JSON.stringify({ ok: false, code: "stale_token", detail: `--token must be a non-negative integer; rejected: ${JSON.stringify(values.token)}` }, null, 2));
    return 1;
  }

  const dir = values.dir;
  const slot = values.slot ?? "";
  const holder = values.holder;

  function requireHolder(): string | null {
    if (holder === undefined || holder.trim() === "") {
      out(JSON.stringify({ ok: false, code: "invalid_holder", detail: `--holder <id> is required for ${operation}` }, null, 2));
      return null;
    }
    return holder;
  }
  function requireToken(): number | null {
    if (token === undefined) {
      out(JSON.stringify({ ok: false, code: "stale_token", detail: `--token <n> is required for ${operation}` }, null, 2));
      return null;
    }
    return token;
  }

  // Lazy load: the MCP server path never pays for (or statically couples to) the lease module.
  const lease = await import("../protocol/lease/index.js");

  let result;
  try {
    switch (operation) {
      case "acquire": {
        const who = requireHolder();
        if (who === null) return 1;
        if (values.slots !== undefined) {
          const requested = values.slots
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry !== "");
          if (requested.length === 0) {
            out(JSON.stringify({ ok: false, code: "invalid_args", detail: "--slots needs at least one slot id, comma-separated" }, null, 2));
            return 1;
          }
          result = lease.acquireAnyLease(dir, requested, who, ttl ?? lease.DEFAULT_LEASE_TTL_SECONDS);
        } else {
          result = lease.acquireLease(dir, slot, who, ttl ?? lease.DEFAULT_LEASE_TTL_SECONDS);
        }
        break;
      }
      case "renew": {
        const who = requireHolder();
        if (who === null) return 1;
        const presented = requireToken();
        if (presented === null) return 1;
        result = lease.renewLease(dir, slot, who, presented, ttl ?? lease.DEFAULT_LEASE_TTL_SECONDS);
        break;
      }
      case "release": {
        const who = requireHolder();
        if (who === null) return 1;
        const presented = requireToken();
        if (presented === null) return 1;
        result = lease.releaseLease(dir, slot, who, presented);
        break;
      }
      case "check": {
        const who = requireHolder();
        if (who === null) return 1;
        const presented = requireToken();
        if (presented === null) return 1;
        result = lease.checkLease(dir, slot, who, presented);
        break;
      }
      case "status": {
        result = lease.leaseStatus(dir, slot);
        break;
      }
      default:
        out(JSON.stringify({ ok: false, code: "invalid_args", detail: `unknown lease operation "${operation}"; expected acquire|renew|release|check|status` }, null, 2));
        return 1;
    }
  } catch (error) {
    err(`odin-sentinel lease failed: ${error instanceof Error ? error.message : String(error)}`);
    out(JSON.stringify({ ok: false, code: "lease_error", detail: error instanceof Error ? error.message : String(error) }, null, 2));
    return 1;
  }

  out(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2);
  if (subcommand === COMPACT_REGISTRY_SUBCOMMAND) {
    process.exitCode = await runCompactRegistryCli(rest);
    return;
  }
  if (subcommand === LEASE_SUBCOMMAND) {
    process.exitCode = await runLeaseCli(rest);
    return;
  }

  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { capabilities: { type: "string" } },
    strict: true
  });
  const capabilities = values.capabilities === undefined ? undefined
    : [...resolveMcpCapabilities(values.capabilities.split(","))] as McpCapability[];
  // Registry default-ON with the shipped filesystem store: bind the store into
  // the server at CLI startup so the compatibility surface works out of the
  // box. The import is dynamic (same posture as compact-registry above): the
  // runtime host never statically couples to the event-registry module, so the
  // Wave-0 runtime-isolation invariant still holds. The base resolves from the
  // process launch cwd's `.odin/registry` — the existing storage contract — with
  // no global/shared scope path and no invented env flag. The store also
  // exposes the asynchronous append, so a contended lock never blocks the MCP
  // event loop (registry-lock-async). createServer() itself keeps its
  // zero-argument fail-closed behavior for absent stores, and the explicit
  // ODIN_GOVDISP_REGISTRY_MCP opt-out is unaffected: it is read inside the
  // server from the env, not here.
  const { LOCAL_REGISTRY_BASE, appendRegistryEvent, appendRegistryEventAsync, queryRegistryEvents } =
    await import("../protocol/event-registry/storage.js");
  const server = createServer({
    capabilities,
    govdispRegistry: {
      store: { appendRegistryEvent, appendRegistryEventAsync, queryRegistryEvents },
      base: resolve(process.cwd(), LOCAL_REGISTRY_BASE)
    }
  });
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
