/**
 * EPIC-052 / STORY-GOVDISP-004 (GD-DEC-006): proof TTL compaction — the ONLY
 * sanctioned mutation of a registry log, living in its own module so the
 * append choke point in storage.ts stays append-only and untouched.
 *
 * Doctrine declaration: protocol/resources/proof-ttl.yaml. Raw proof events
 * older than their TTL compact into ONE terminal summary record per scope.
 * The summary is the existing TERMINAL event union member (no new event
 * type): event_type TERMINAL_COMPLETED, stable_objective_id bound to the
 * compacted scope, and content_hashes carrying the sha256 of every removed
 * JSONL line in file order (metadata-only — hashes, never raw proof bodies;
 * the prompt_text_stored:false precedent). The hash convention follows
 * scripts/audit/verify-pack.mjs (sha256 over exact bytes).
 *
 * Determinism: the compacted output is a pure function of (log content,
 * evaluation instant `now`, TTL policy) — kept events are re-emitted as their
 * original raw lines and the summary's event_id is derived from the digest
 * of the ordered removed-line hashes, so compacting the same log twice with
 * the same `now` yields byte-identical output, and re-compacting an already
 * compacted log at the same instant is a no-op (nothing is written).
 *
 * Replay verification: the terminal record preserves the hash of each
 * removed event in order; re-hash the removed lines (hashRegistryEventLine)
 * and compare against content_hashes.
 *
 * Write discipline: the compacted file is written atomically (temp file +
 * rename in the same directory) under the same mkdir lock discipline the
 * append path serializes on; the lock is always released, a failed write or
 * rename never leaves a partial events.jsonl, and unexpected fs errors
 * propagate (operator-visible halt, never a silent drop). TERMINAL-class
 * events are never compacted: they are outcomes and the replay anchor.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GOVDISP_EVENT_CLASSES,
  GOVDISP_EVENT_SCHEMA_VERSION,
  type GovdispEvent,
  type GovdispEventClass,
  type TerminalEvent
} from "./types.js";
import {
  isSafeRegistryScope,
  LOCAL_REGISTRY_BASE,
  REGISTRY_EVENTS_FILENAME,
  REGISTRY_LOCK_DIRNAME,
  validateGovdispEvent,
  type EventRejection
} from "./storage.js";

/**
 * Default proof TTL in days (doctrine: protocol/resources/proof-ttl.yaml).
 * Typed-constant fallback per the META_GOVERNANCE_DEPTH_CAP convention: the
 * canonical ProtocolData resource-loading surface was outside the authoring
 * slice's write scope, so the YAML file is the declaration and this constant
 * is the runtime value.
 */
export const GOVDISP_PROOF_TTL_DAYS_DEFAULT = 30;

/**
 * Per-event-class TTL overrides in days (doctrine allows them; none are
 * declared by default). Classes absent here use GOVDISP_PROOF_TTL_DAYS_DEFAULT.
 */
export const GOVDISP_PROOF_TTL_CLASS_OVERRIDES: Readonly<Partial<Record<GovdispEventClass, number>>> = Object.freeze({});

/** Event type of the compaction summary record (an existing TERMINAL union member). */
export const COMPACTION_SUMMARY_EVENT_TYPE = "TERMINAL_COMPLETED" as const;

/** Temp filename (same directory as the log) for the atomic temp + rename write. */
export const REGISTRY_COMPACT_TMP_FILENAME = "events.compact.tmp";

/** Event classes compaction never removes (outcomes and the replay anchor). */
export const COMPACTION_EXCLUDED_CLASSES: ReadonlySet<string> = new Set(["TERMINAL"]);

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_LOCK_ATTEMPTS = 50;
const DEFAULT_LOCK_RETRY_MS = 10;

/** A deterministic, replay-verifiable compaction report (also the CLI's stdout JSON). */
export interface RegistryCompactionReport {
  scope: string;
  path: string;
  dry_run: boolean;
  now: string;
  ttl_days_default: number;
  ttl_days_by_class: Record<string, number>;
  /** True when a non-empty compaction set exists (in dry-run: what WOULD compact). */
  compacted: boolean;
  removed_count: number;
  kept_count: number;
  removed_per_class: Record<string, number>;
  bytes_before: number;
  /** Projected size for dry-run (nothing is written); on-disk size otherwise. */
  bytes_after: number;
  summary_event: TerminalEvent | null;
}

export type CompactRegistryEventsResult =
  | { ok: true; report: RegistryCompactionReport }
  | { ok: false; rejections: EventRejection[] };

export interface CompactRegistryEventsOptions {
  /** Registry base; defaults to LOCAL_REGISTRY_BASE. */
  base?: string;
  /** Evaluation instant (ISO-8601); defaults to the current time. Injected for determinism. */
  now?: string;
  /** Default TTL in days; defaults to GOVDISP_PROOF_TTL_DAYS_DEFAULT. */
  ttlDays?: number;
  /** Per-event-class TTL overrides in days; defaults to GOVDISP_PROOF_TTL_CLASS_OVERRIDES. */
  ttlDaysByClass?: Partial<Record<GovdispEventClass, number>>;
  /** Report what WOULD compact; writes nothing (no lock, no temp, no rename). */
  dryRun?: boolean;
  /** Lock acquisition attempts before a named lock_unavailable rejection. */
  maxLockAttempts?: number;
  /** Backoff between lock attempts, milliseconds. */
  lockRetryMs?: number;
  fsExists?: typeof existsSync;
  fsRead?: typeof readFileSync;
  fsWrite?: typeof writeFileSync;
  fsRename?: typeof renameSync;
  fsRemove?: typeof rmSync;
  fsMkdir?: typeof mkdirSync;
  fsRmdir?: typeof rmdirSync;
}

/** sha256 (hex) of one JSONL line's exact utf8 bytes — the hash-chain convention. */
export function hashRegistryEventLine(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex");
}

function storeRejection(field: string, code: string, detail: string): EventRejection {
  return { field, event_class: "<store>", code, detail };
}

/** Same synchronous backoff the append path uses (Atomics.wait; main-thread safe in Node). */
function sleepSync(ms: number): void {
  if (ms <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, ms);
}

function isEexists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function splitLogLines(text: string): string[] {
  const lines = text.split("\n");
  // A well-formed log ends with exactly one trailing newline.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

interface ParsedRegistryLine {
  line: string;
  event: GovdispEvent;
  eventMs: number;
}

/**
 * The pure core of compaction: parse and validate every line, partition into
 * kept vs removed, and (when a compaction set exists) build the terminal
 * summary record and the exact new log text. No fs access, no clock access —
 * the plan is a function of the log text, `now`, and the TTL policy. A plan
 * with `removed.length === 0` carries summaryEvent null and newText null
 * (no-op; nothing is written). Fail-closed: any corrupt line, invalid event,
 * or unparseable ts is a named rejection and NOTHING is written.
 */
interface CompactionPlan {
  keptLines: string[];
  removed: ParsedRegistryLine[];
  summaryEvent: TerminalEvent | null;
  newText: string | null;
  bytesBefore: number;
  bytesAfter: number;
}

type PlanResult = { ok: true; plan: CompactionPlan } | { ok: false; rejections: EventRejection[] };

function validateTtlPolicy(ttlDays: number, overrides: Partial<Record<GovdispEventClass, number>>): EventRejection[] {
  const rejections: EventRejection[] = [];
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
    rejections.push(storeRejection("ttl_days", "invalid_ttl", `default TTL must be a positive finite number of days; rejected: ${JSON.stringify(ttlDays)}`));
  }
  for (const [eventClass, days] of Object.entries(overrides)) {
    if (!(GOVDISP_EVENT_CLASSES as readonly string[]).includes(eventClass)) {
      rejections.push(storeRejection(`ttl_days_by_class.${eventClass}`, "invalid_ttl", `TTL override names an unknown event class "${eventClass}"; allowed classes: ${GOVDISP_EVENT_CLASSES.join(" | ")}`));
    } else if (!Number.isFinite(days) || days <= 0) {
      rejections.push(storeRejection(`ttl_days_by_class.${eventClass}`, "invalid_ttl", `TTL override for class "${eventClass}" must be a positive finite number of days; rejected: ${JSON.stringify(days)}`));
    }
  }
  return rejections;
}

function planCompaction(
  scope: string,
  text: string,
  now: string,
  nowMs: number,
  ttlDays: number,
  overrides: Partial<Record<GovdispEventClass, number>>
): PlanResult {
  const lines = splitLogLines(text);

  const parsed: ParsedRegistryLine[] = [];
  const rejections: EventRejection[] = [];
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      rejections.push(storeRejection(
        `line[${lineNo}]`,
        "corrupt_line",
        `registry log line ${lineNo} is not valid JSON (${error instanceof Error ? error.message : String(error)}); compaction refuses to mutate a partially readable log`
      ));
      return;
    }
    const validation = validateGovdispEvent(value);
    if (!validation.valid) {
      for (const rejection of validation.rejections) {
        rejections.push({
          ...rejection,
          field: `line[${lineNo}].${rejection.field}`,
          detail: `registry log line ${lineNo}: ${rejection.detail}`
        });
      }
      return;
    }
    const eventMs = Date.parse(validation.event.ts);
    if (Number.isNaN(eventMs)) {
      rejections.push(storeRejection(
        `line[${lineNo}].ts`,
        "unparseable_ts",
        `registry log line ${lineNo} (event_id "${validation.event.event_id}") has a ts that does not parse as a date: ${JSON.stringify(validation.event.ts)}; compaction never guesses an event's age`
      ));
      return;
    }
    parsed.push({ line, event: validation.event, eventMs });
  });
  if (rejections.length > 0) {
    return { ok: false, rejections };
  }

  const kept: ParsedRegistryLine[] = [];
  const removed: ParsedRegistryLine[] = [];
  for (const entry of parsed) {
    // TERMINAL events are outcomes and the replay anchor; they NEVER compact.
    if (COMPACTION_EXCLUDED_CLASSES.has(entry.event.event_class)) {
      kept.push(entry);
      continue;
    }
    const ttl = overrides[entry.event.event_class] ?? ttlDays;
    const cutoffMs = nowMs - ttl * DAY_MS;
    // Boundary: strictly older than the cutoff compacts; at-cutoff survives.
    if (entry.eventMs < cutoffMs) {
      removed.push(entry);
    } else {
      kept.push(entry);
    }
  }

  const bytesBefore = Buffer.byteLength(text, "utf8");
  if (removed.length === 0) {
    return {
      ok: true,
      plan: { keptLines: kept.map((entry) => entry.line), removed, summaryEvent: null, newText: null, bytesBefore, bytesAfter: bytesBefore }
    };
  }

  // The terminal summary record: ordered sha256 hashes of the removed lines,
  // a deterministic content-derived event_id, and `now` as its ts.
  const contentHashes = removed.map((entry) => ({
    path: entry.event.event_id,
    sha256: hashRegistryEventLine(entry.line)
  }));
  const chainDigest = hashRegistryEventLine(contentHashes.map((hash) => `${hash.path}:${hash.sha256}`).join("\n"));
  const summaryEvent: TerminalEvent = {
    schema_version: GOVDISP_EVENT_SCHEMA_VERSION,
    event_id: `evt-compaction-${chainDigest.slice(0, 24)}`,
    ts: now,
    stable_objective_id: scope,
    event_class: "TERMINAL",
    event_type: COMPACTION_SUMMARY_EVENT_TYPE,
    content_hashes: contentHashes
  };
  // Defense in depth: the summary must pass the same canonical validation as
  // every other record, so a compacted log never becomes unreadable.
  const summaryValidation = validateGovdispEvent(summaryEvent);
  if (!summaryValidation.valid) {
    return { ok: false, rejections: summaryValidation.rejections };
  }

  // Kept events are re-emitted as their original raw lines (byte-exact);
  // the summary is the single appended record, last in the file.
  const summaryLine = JSON.stringify(summaryEvent);
  const newText = `${[...kept.map((entry) => entry.line), summaryLine].join("\n")}\n`;
  return {
    ok: true,
    plan: {
      keptLines: kept.map((entry) => entry.line),
      removed,
      summaryEvent,
      newText,
      bytesBefore,
      bytesAfter: Buffer.byteLength(newText, "utf8")
    }
  };
}

function buildReport(
  scope: string,
  path: string,
  dryRun: boolean,
  now: string,
  ttlDays: number,
  overrides: Partial<Record<GovdispEventClass, number>>,
  plan: CompactionPlan
): RegistryCompactionReport {
  const removedPerClass: Record<string, number> = {};
  for (const entry of plan.removed) {
    removedPerClass[entry.event.event_class] = (removedPerClass[entry.event.event_class] ?? 0) + 1;
  }
  return {
    scope,
    path,
    dry_run: dryRun,
    now,
    ttl_days_default: ttlDays,
    ttl_days_by_class: { ...overrides },
    compacted: plan.removed.length > 0,
    removed_count: plan.removed.length,
    kept_count: plan.keptLines.length,
    removed_per_class: removedPerClass,
    bytes_before: plan.bytesBefore,
    bytes_after: plan.bytesAfter,
    summary_event: plan.summaryEvent
  };
}

const EMPTY_PLAN: CompactionPlan = { keptLines: [], removed: [], summaryEvent: null, newText: null, bytesBefore: 0, bytesAfter: 0 };

/**
 * Compact one scope's registry log per the proof TTL policy.
 *
 * Dry-run is read-only: no lock is taken and nothing is written. A real run
 * takes the mkdir lock FIRST and re-reads the log inside the critical
 * section, so a concurrent append can never be silently lost between the
 * read and the atomic rename. Missing/empty logs and logs with nothing old
 * enough are a no-op (compacted: false; no write, not even a byte-identical
 * one). Fail-closed throughout: named rejections, no partial mutations.
 */
export function compactRegistryEvents(
  scope: string,
  options: CompactRegistryEventsOptions = {}
): CompactRegistryEventsResult {
  if (!isSafeRegistryScope(scope)) {
    return {
      ok: false,
      rejections: [storeRejection("scope", "unsafe_scope", `registry scope must be a single safe path segment (alphanumeric start, then alnum/. _ -); rejected: ${JSON.stringify(scope)}`)]
    };
  }

  const now = options.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    return {
      ok: false,
      rejections: [storeRejection("now", "invalid_now", `the evaluation instant must parse as a date (ISO-8601); rejected: ${JSON.stringify(now)}`)]
    };
  }

  const ttlDays = options.ttlDays ?? GOVDISP_PROOF_TTL_DAYS_DEFAULT;
  const overrides = options.ttlDaysByClass ?? GOVDISP_PROOF_TTL_CLASS_OVERRIDES;
  const ttlRejections = validateTtlPolicy(ttlDays, overrides);
  if (ttlRejections.length > 0) {
    return { ok: false, rejections: ttlRejections };
  }

  const base = options.base ?? LOCAL_REGISTRY_BASE;
  const dryRun = options.dryRun === true;
  const fsExists = options.fsExists ?? existsSync;
  const fsRead = options.fsRead ?? readFileSync;
  const fsWrite = options.fsWrite ?? writeFileSync;
  const fsRename = options.fsRename ?? renameSync;
  const fsRemove = options.fsRemove ?? rmSync;
  const fsMkdir = options.fsMkdir ?? mkdirSync;
  const fsRmdir = options.fsRmdir ?? rmdirSync;

  const dir = join(base, scope);
  const path = join(dir, REGISTRY_EVENTS_FILENAME);

  if (dryRun) {
    // Read-only report: no lock, no temp file, no rename — nothing is written.
    if (!fsExists(path)) {
      return { ok: true, report: buildReport(scope, path, true, now, ttlDays, overrides, EMPTY_PLAN) };
    }
    const text = fsRead(path, "utf8") as string;
    const planned = planCompaction(scope, text, now, nowMs, ttlDays, overrides);
    if (!planned.ok) return { ok: false, rejections: planned.rejections };
    return { ok: true, report: buildReport(scope, path, true, now, ttlDays, overrides, planned.plan) };
  }

  // Real run: the lock covers read → plan → write → rename, so no concurrent
  // append can be lost between the read and the atomic rename.
  fsMkdir(dir, { recursive: true });
  const lockDir = join(dir, REGISTRY_LOCK_DIRNAME);
  const maxAttempts = Math.max(1, options.maxLockAttempts ?? DEFAULT_MAX_LOCK_ATTEMPTS);
  const retryMs = Math.max(0, options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS);

  let locked = false;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      fsMkdir(lockDir);
      locked = true;
      break;
    } catch (error) {
      if (!isEexists(error)) throw error;
      sleepSync(retryMs);
    }
  }
  if (!locked) {
    return {
      ok: false,
      rejections: [storeRejection(
        REGISTRY_LOCK_DIRNAME,
        "lock_unavailable",
        `registry lock ${lockDir} held by another writer after ${maxAttempts} attempt(s); compaction fails closed instead of risking a lost append`
      )]
    };
  }

  try {
    if (!fsExists(path)) {
      return { ok: true, report: buildReport(scope, path, false, now, ttlDays, overrides, EMPTY_PLAN) };
    }
    const text = fsRead(path, "utf8") as string;
    const planned = planCompaction(scope, text, now, nowMs, ttlDays, overrides);
    if (!planned.ok) return { ok: false, rejections: planned.rejections };
    if (planned.plan.newText === null) {
      // Nothing old enough: no write, not even a byte-identical one.
      return { ok: true, report: buildReport(scope, path, false, now, ttlDays, overrides, planned.plan) };
    }

    const tmpPath = join(dir, REGISTRY_COMPACT_TMP_FILENAME);
    try {
      fsWrite(tmpPath, planned.plan.newText, "utf8");
      fsRename(tmpPath, path);
    } catch (error) {
      // Atomicity: events.jsonl is never partial. A failed write or rename
      // leaves the original untouched; the temp is removed best-effort and
      // the unexpected fs error propagates (operator-visible halt).
      try {
        fsRemove(tmpPath, { force: true });
      } catch {
        // best-effort cleanup; a stale temp is operator-visible, never auto-recovered
      }
      throw error;
    }
    return { ok: true, report: buildReport(scope, path, false, now, ttlDays, overrides, planned.plan) };
  } finally {
    fsRmdir(lockDir);
  }
}
