/**
 * EPIC-052 Wave-1: append-only governance event registry storage.
 *
 * Storage layout: .odin/registry/<scope>/events.jsonl — one JSON record per
 * line, append-only. `.odin/` is gitignored, so registry state never enters
 * version control.
 *
 * Fail-closed architecture, cloned from src/harness-pacing/storage.ts: ONE
 * validation choke point (validateGovdispEvent) must succeed before ANY mkdir
 * or append. Parse → validate → single reject path; no partial patches, no
 * silent drops. Unlike harness-pacing's whole-profile rewrite, this store is
 * JSONL append-only, so the write path never reads or rewrites existing
 * content; persisted corruption is reported fail-closed on the READ path
 * (named rejection citing the line) instead of blocking new valid appends.
 *
 * Append-only contract: this module exports NO mutation or deletion API. The
 * only fs write on the event log is a single appendFileSync of one complete
 * "\n"-terminated line (JSON.stringify never emits raw newlines), so each
 * record is one O_APPEND write — line-atomic against interleaving.
 *
 * Contention strategy (single-writer mutual exclusion): writers serialize on
 * an mkdir-based lock directory (<scope>/events.lock/). mkdir is atomic on
 * POSIX and NTFS, so exactly one writer holds the lock at a time, including
 * across processes. Contenders retry with a short backoff up to
 * maxLockAttempts, then fail closed with a named lock_unavailable rejection
 * (never a silent drop, never a lock steal). The single-line O_APPEND write
 * is defense in depth beneath the lock. A process that dies mid-append can
 * leave a stale lock directory; that is an operator-visible halt condition,
 * not an auto-recovery path — remove the stale lock deliberately.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { govdispEventSchema } from "../schemas.js";
import {
  ATTEMPT_EVENT_TYPES,
  AUDIT_EVENT_TYPES,
  BREAK_GLASS_EVENT_TYPES,
  BUDGET_EVENT_TYPES,
  FINDING_EVENT_TYPES,
  GOVDISP_EVENT_CLASSES,
  TERMINAL_EVENT_TYPES,
  type GovdispEvent
} from "./types.js";

/** Default runtime registry base — under gitignored `.odin/`. */
export const LOCAL_REGISTRY_BASE = ".odin/registry";

/** Registry event log filename (one JSONL file per scope). */
export const REGISTRY_EVENTS_FILENAME = "events.jsonl";

/** Lock directory name used for cross-process single-writer exclusion. */
export const REGISTRY_LOCK_DIRNAME = "events.lock";

/**
 * Per-event serialized-size cap in bytes (64 KiB), enforced at the append
 * choke point: an event whose JSONL line would exceed the cap is rejected
 * fail-closed with a NAMED event_too_large rejection before any mkdir or
 * append. Doctrine declaration: protocol/resources/proof-ttl.yaml
 * (GD-DEC-006; closes the GOVDISP-002 exam's O1 holdout finding). This is
 * size-shape validation at the choke point — distinct from the budget
 * policy layer's counting doctrine.
 */
export const GOVDISP_EVENT_MAX_BYTES = 64 * 1024;

/** Named-rejection code: the serialized event line exceeds the per-event byte cap. */
export const EVENT_TOO_LARGE_CODE = "event_too_large" as const;

/**
 * A named, fail-closed rejection. Every refusal cites the offending field and
 * the event class it was rejected under ("<unknown>" when the event does not
 * declare one, "<query>" for query-shape rejections, "<store>" for
 * storage-layer refusals such as lock contention).
 */
export interface EventRejection {
  field: string;
  event_class: string;
  code: string;
  detail: string;
}

export type ValidateGovdispEventResult =
  | { valid: true; event: GovdispEvent }
  | { valid: false; rejections: EventRejection[] };

export type AppendRegistryEventResult =
  | { ok: true; path: string; event: GovdispEvent }
  | { ok: false; rejections: EventRejection[] };

export type ReadRegistryEventsResult =
  | { ok: true; events: GovdispEvent[] }
  | { ok: false; rejections: EventRejection[] };

/**
 * Deterministic query filters. All present filters AND together. Time bounds
 * are inclusive ISO-8601 lexicographic comparisons against event `ts`.
 * Results are returned in file (append) order — deterministic for a given
 * log content.
 */
export interface RegistryEventQuery {
  stable_objective_id?: string;
  event_class?: string;
  event_type?: string;
  from_ts?: string;
  to_ts?: string;
}

export interface RegistryLockOptions {
  /** Lock acquisition attempts before a named lock_unavailable rejection. */
  maxLockAttempts?: number;
  /** Backoff between lock attempts, milliseconds. */
  lockRetryMs?: number;
}

/**
 * Append-path options: the lock discipline plus the per-event serialized
 * byte cap (defaults to GOVDISP_EVENT_MAX_BYTES; overridable for tests).
 */
export interface RegistryAppendOptions extends RegistryLockOptions {
  /** Per-event serialized byte cap; defaults to GOVDISP_EVENT_MAX_BYTES. */
  maxEventBytes?: number;
}

const DEFAULT_MAX_LOCK_ATTEMPTS = 50;
const DEFAULT_LOCK_RETRY_MS = 10;

const GOVDISP_EVENT_CLASS_SET = new Set<string>(GOVDISP_EVENT_CLASSES);
const GOVDISP_EVENT_TYPE_SET = new Set<string>([
  ...ATTEMPT_EVENT_TYPES,
  ...FINDING_EVENT_TYPES,
  ...BREAK_GLASS_EVENT_TYPES,
  ...BUDGET_EVENT_TYPES,
  ...TERMINAL_EVENT_TYPES,
  ...AUDIT_EVENT_TYPES
]);
const QUERY_FIELDS = new Set(["stable_objective_id", "event_class", "event_type", "from_ts", "to_ts"]);

/**
 * Safe registry scope: single path segment, no traversal / separators.
 * Rejects empty, `..`, `/`, `\`, and other path-like forms. Same rule as
 * harness-pacing's isSafeHarnessId.
 */
export function isSafeRegistryScope(scope: string): boolean {
  if (typeof scope !== "string" || scope.length === 0) return false;
  if (scope.length > 128) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(scope);
}

/**
 * Absolute path to the events.jsonl for a given scope. Unsafe / traversal
 * scope values throw (reject, do not join) — same posture as
 * harness-pacing's getProfilePath.
 */
export function getRegistryEventsPath(scope: string, base = LOCAL_REGISTRY_BASE): string {
  if (!isSafeRegistryScope(scope)) {
    throw new Error(`unsafe registry scope rejected: ${JSON.stringify(scope)}`);
  }
  return join(base, scope, REGISTRY_EVENTS_FILENAME);
}

/** Declared event class of a candidate value, or "<unknown>". */
function declaredEventClass(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "<unknown>";
  const declared = (value as Record<string, unknown>).event_class;
  return typeof declared === "string" && declared.trim() !== "" ? declared : "<unknown>";
}

interface SchemaIssueLike {
  path: ReadonlyArray<string | number | symbol>;
  code: string;
  message: string;
  keys?: unknown;
}

function mapSchemaIssue(issue: SchemaIssueLike, eventClass: string): EventRejection {
  let field = issue.path.map((segment) => String(segment)).join(".");
  if (field === "") {
    // Unrecognized-keys issues carry no path; name the extra fields instead.
    field = Array.isArray(issue.keys) && issue.keys.length > 0
      ? issue.keys.map((key) => String(key)).join(",")
      : "<root>";
  }
  return { field, event_class: eventClass, code: issue.code, detail: issue.message };
}

/**
 * THE validation choke point. Every write path in this module funnels through
 * this function exactly once, before any mkdir or append. Validates the
 * complete Wave-0 event shape against the canonical schema (strict:
 * unknown fields are rejected). Pure — never throws, never touches disk.
 * Malformed events are rejected fail-closed with NAMED reasons citing the
 * field and the declared event class.
 */
export function validateGovdispEvent(value: unknown): ValidateGovdispEventResult {
  const eventClass = declaredEventClass(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      valid: false,
      rejections: [{
        field: "<root>",
        event_class: eventClass,
        code: "invalid_event_shape",
        detail: "event must be a plain object with the Wave-0 govdisp event shape"
      }]
    };
  }
  const parsed = govdispEventSchema.safeParse(value);
  if (parsed.success) {
    // The canonical schema shape is the Wave-0 typed union; strict objects
    // guarantee parsed data carries no fields outside the union members.
    return { valid: true, event: parsed.data as GovdispEvent };
  }
  return {
    valid: false,
    rejections: parsed.error.issues.map((issue) => mapSchemaIssue(issue, eventClass))
  };
}

function unsafeScopeRejection(scope: unknown): EventRejection {
  return {
    field: "scope",
    event_class: "<store>",
    code: "unsafe_scope",
    detail: `registry scope must be a single safe path segment (alphanumeric start, then alnum/. _ -); rejected: ${JSON.stringify(scope)}`
  };
}

/** Synchronous backoff for lock retries (Atomics.wait; main-thread safe in Node). */
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

/**
 * Append one event to the registry log for the given scope.
 *
 * Choke point (must pass before ANY mkdir/append):
 *  1. Scope safety (unsafe scope → named unsafe_scope rejection)
 *  2. Full incoming event validation via validateGovdispEvent
 *  3. Serialized-size cap (the exact JSONL line to be appended exceeds the
 *     per-event byte cap → named event_too_large rejection, field "_size",
 *     with the size and the cap in detail)
 * Only then: mkdir (recursive, idempotent) → acquire mkdir lock → one
 * line-atomic O_APPEND write → release lock. The lock is always released,
 * including when the append itself throws.
 *
 * No read-modify-write: the log is append-only, so the write path never
 * reads existing content. Returns named rejections; unexpected fs errors
 * (not contention) propagate — an operator-visible halt, never a silent drop.
 */
export function appendRegistryEvent(
  scope: string,
  event: unknown,
  base = LOCAL_REGISTRY_BASE,
  fsAppend: typeof appendFileSync = appendFileSync,
  fsMkdir: typeof mkdirSync = mkdirSync,
  fsRmdir: typeof rmdirSync = rmdirSync,
  options: RegistryAppendOptions = {}
): AppendRegistryEventResult {
  // --- pure validation choke point (no side effects) ---
  if (!isSafeRegistryScope(scope)) {
    return { ok: false, rejections: [unsafeScopeRejection(scope)] };
  }
  const validation = validateGovdispEvent(event);
  if (!validation.valid) {
    return { ok: false, rejections: validation.rejections };
  }
  // Size-shape validation: measure the exact JSONL line to be appended
  // (utf8 bytes, terminator included); over-cap events are rejected by name
  // before any mkdir or append — nothing is written.
  const line = `${JSON.stringify(validation.event)}\n`;
  const maxEventBytes = Math.max(1, options.maxEventBytes ?? GOVDISP_EVENT_MAX_BYTES);
  const lineBytes = Buffer.byteLength(line, "utf8");
  if (lineBytes > maxEventBytes) {
    return {
      ok: false,
      rejections: [{
        field: "_size",
        event_class: validation.event.event_class,
        code: EVENT_TOO_LARGE_CODE,
        detail: `serialized event line is ${lineBytes} bytes, exceeding the per-event cap of ${maxEventBytes} bytes (GOVDISP_EVENT_MAX_BYTES; doctrine: protocol/resources/proof-ttl.yaml); the append is refused fail-closed and nothing was written`
      }]
    };
  }

  // --- mutations only after full incoming-event validation ---
  const dir = join(base, scope);
  const path = join(dir, REGISTRY_EVENTS_FILENAME);
  const lockDir = join(dir, REGISTRY_LOCK_DIRNAME);
  const maxAttempts = Math.max(1, options.maxLockAttempts ?? DEFAULT_MAX_LOCK_ATTEMPTS);
  const retryMs = Math.max(0, options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS);

  fsMkdir(dir, { recursive: true });

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
      rejections: [{
        field: REGISTRY_LOCK_DIRNAME,
        event_class: validation.event.event_class,
        code: "lock_unavailable",
        detail: `registry lock ${lockDir} held by another writer after ${maxAttempts} attempt(s); failing closed instead of risking interleaved corruption`
      }]
    };
  }

  try {
    fsAppend(path, line, "utf8");
  } finally {
    fsRmdir(lockDir);
  }
  return { ok: true, path, event: validation.event };
}

/**
 * Read every event in the registry log for a scope, in append order.
 * Fail-closed on persisted corruption: any unparsable or invalid line is a
 * named rejection citing the 1-based line number (field `line[<n>]...`), and
 * no partial result is returned. A missing log is an empty registry, not an
 * error. Unsafe scope → named rejection (never throws on bad input).
 */
export function readRegistryEvents(
  scope: string,
  base = LOCAL_REGISTRY_BASE,
  fsExists: typeof existsSync = existsSync,
  fsRead: typeof readFileSync = readFileSync
): ReadRegistryEventsResult {
  if (!isSafeRegistryScope(scope)) {
    return { ok: false, rejections: [unsafeScopeRejection(scope)] };
  }
  const path = join(base, scope, REGISTRY_EVENTS_FILENAME);
  if (!fsExists(path)) {
    return { ok: true, events: [] };
  }
  const text = fsRead(path, "utf8") as string;
  const lines = text.split("\n");
  // A well-formed log ends with exactly one trailing newline.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const events: GovdispEvent[] = [];
  const rejections: EventRejection[] = [];
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      rejections.push({
        field: `line[${lineNo}]`,
        event_class: "<unknown>",
        code: "corrupt_line",
        detail: `registry log line ${lineNo} is not valid JSON (${error instanceof Error ? error.message : String(error)}); refusing to serve a partially readable log`
      });
      return;
    }
    const validation = validateGovdispEvent(parsed);
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
    events.push(validation.event);
  });

  if (rejections.length > 0) {
    return { ok: false, rejections };
  }
  return { ok: true, events };
}

/** Validate a query shape; returns named rejections (empty when valid). Pure. */
export function validateRegistryEventQuery(query: unknown): EventRejection[] {
  const rejections: EventRejection[] = [];
  if (query === undefined) return rejections;
  if (query === null || typeof query !== "object" || Array.isArray(query)) {
    return [{
      field: "<query>",
      event_class: "<query>",
      code: "invalid_query",
      detail: "query must be a plain object with optional stable_objective_id / event_class / event_type / from_ts / to_ts filters"
    }];
  }
  const record = query as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!QUERY_FIELDS.has(key)) {
      rejections.push({
        field: key,
        event_class: "<query>",
        code: "invalid_query",
        detail: `unknown query filter "${key}"; allowed filters: ${[...QUERY_FIELDS].join(", ")}`
      });
    }
  }
  if (record.stable_objective_id !== undefined &&
      (typeof record.stable_objective_id !== "string" || record.stable_objective_id.trim() === "")) {
    rejections.push({
      field: "stable_objective_id",
      event_class: "<query>",
      code: "invalid_query",
      detail: "stable_objective_id filter must be a non-empty string"
    });
  }
  if (record.event_class !== undefined) {
    if (typeof record.event_class !== "string" || !GOVDISP_EVENT_CLASS_SET.has(record.event_class)) {
      rejections.push({
        field: "event_class",
        event_class: "<query>",
        code: "invalid_query",
        detail: `event_class filter must be one of ${GOVDISP_EVENT_CLASSES.join(" | ")}`
      });
    }
  }
  if (record.event_type !== undefined) {
    if (typeof record.event_type !== "string" || !GOVDISP_EVENT_TYPE_SET.has(record.event_type)) {
      rejections.push({
        field: "event_type",
        event_class: "<query>",
        code: "invalid_query",
        detail: "event_type filter must be a known Wave-0 event type (e.g. ATTEMPT_STARTED, FINDING_OPENED)"
      });
    }
  }
  for (const field of ["from_ts", "to_ts"] as const) {
    const value = record[field];
    if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
      rejections.push({
        field,
        event_class: "<query>",
        code: "invalid_query",
        detail: `${field} filter must be a non-empty ISO-8601 string`
      });
    }
  }
  return rejections;
}

/**
 * Deterministic filtered query over the registry log. All present filters AND
 * together; from_ts/to_ts are inclusive lexicographic bounds on event `ts`.
 * Results are in append order. Invalid query shapes and corrupt logs fail
 * closed with named rejections; no partial results.
 */
export function queryRegistryEvents(
  scope: string,
  query: RegistryEventQuery = {},
  base = LOCAL_REGISTRY_BASE,
  fsExists: typeof existsSync = existsSync,
  fsRead: typeof readFileSync = readFileSync
): ReadRegistryEventsResult {
  const queryRejections = validateRegistryEventQuery(query);
  if (queryRejections.length > 0) {
    return { ok: false, rejections: queryRejections };
  }
  const read = readRegistryEvents(scope, base, fsExists, fsRead);
  if (!read.ok) {
    return read;
  }
  const events = read.events.filter((event) => {
    if (query.stable_objective_id !== undefined && event.stable_objective_id !== query.stable_objective_id) return false;
    if (query.event_class !== undefined && event.event_class !== query.event_class) return false;
    if (query.event_type !== undefined && event.event_type !== query.event_type) return false;
    if (query.from_ts !== undefined && event.ts < query.from_ts) return false;
    if (query.to_ts !== undefined && event.ts > query.to_ts) return false;
    return true;
  });
  return { ok: true, events };
}
