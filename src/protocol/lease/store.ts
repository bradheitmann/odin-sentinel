// ODIN slot lease: one holder per slot, with an expiry and a fencing token.
//
// A recurring job that more than one runner may start uses a lease instead of trusting an
// append-only log: the slot names the job, the holder names the runner, and the fencing
// token (a per-slot integer that only ever increases) lets an action that started under an
// older lease be detected as void after a takeover.
//
// Every read-modify-write of a slot's record runs under ODIN's EXISTING cross-process
// registry lock (the mkdir lock in `../event-registry/storage.ts`, with its capped-backoff
// budget and named fail-closed refusal). There is deliberately no second lock here.
//
// Clock: expiry uses wall-clock time with an explicit skew allowance applied before a
// takeover, because two runners' clocks need not agree to the millisecond.

import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireRegistryLock } from "../event-registry/storage.js";

/** The only lease record schema this module writes or reads. */
export const LEASE_SCHEMA_VERSION = "odin.lease.v1";
/** Default time-to-live for an acquired lease. */
export const DEFAULT_LEASE_TTL_SECONDS = 300;
/** Default clock-skew allowance applied before an expired lease may be taken over. */
export const DEFAULT_CLOCK_SKEW_MS = 2_000;
/** One record per slot, next to the lock directory. */
export const LEASE_FILE_SUFFIX = ".lease.json";
export const LEASE_LOCK_SUFFIX = ".lease.lock";
/** Optional allow-list of slot ids in the lease directory (one per line, # comments). */
export const SLOTS_ALLOW_FILENAME = "slots.allow";

export type LeaseRejectionCode =
  | "invalid_slot"
  | "invalid_holder"
  | "invalid_ttl"
  | "lease_dir_unavailable"
  | "lock_unavailable"
  | "slot_held"
  | "not_holder"
  | "stale_token"
  | "lease_expired"
  | "lease_missing"
  | "lease_corrupt"
  | "slot_not_allowed"
  | "slots_allow_invalid"
  | "all_slots_held";

export interface LeaseRecord {
  schema_version: typeof LEASE_SCHEMA_VERSION;
  slot: string;
  /** Per-slot fencing token; strictly increases on every takeover. */
  token: number;
  /** null means the slot is free (the token is retained). */
  holder: string | null;
  acquired_at: string | null;
  expires_at: string | null;
}

export type LeaseRefusal = {
  ok: false;
  code: LeaseRejectionCode;
  detail: string;
  /** For all_slots_held: who holds each requested slot, and until when. */
  slots?: Array<{ slot: string; holder: string | null; expires_at: string | null }>;
};
export type LeaseResult<T> = ({ ok: true } & T) | LeaseRefusal;

export interface LeaseOptions {
  /** Wall-clock source in milliseconds; injected by tests. */
  now?: () => number;
  /** Skew allowance before an expired lease may be taken over. */
  skewMs?: number;
  /** Lock budget override, forwarded to the shared registry lock policy. */
  lockBudgetMs?: number;
}

const SLOT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** One message for every invalid slot id, so the colon rule and the instant form are stated. */
const INVALID_SLOT_DETAIL =
  "slot must be a single safe path segment: letters, digits, dot, underscore and hyphen ([A-Za-z0-9][A-Za-z0-9._-]*); colons are not allowed — write an ISO instant as YYYY-MM-DDTHHMMZ";

function refusal(code: LeaseRejectionCode, detail: string): LeaseRefusal {
  return { ok: false, code, detail };
}

function nowMs(options: LeaseOptions): number {
  return (options.now ?? Date.now)();
}

function skewMs(options: LeaseOptions): number {
  return Math.max(0, options.skewMs ?? DEFAULT_CLOCK_SKEW_MS);
}

function leasePath(dir: string, slot: string): string {
  return join(dir, `${slot}${LEASE_FILE_SUFFIX}`);
}

function lockPath(dir: string, slot: string): string {
  return join(dir, `${slot}${LEASE_LOCK_SUFFIX}`);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function emptyRecord(slot: string): LeaseRecord {
  return {
    schema_version: LEASE_SCHEMA_VERSION,
    slot,
    token: 0,
    holder: null,
    acquired_at: null,
    expires_at: null
  };
}

function isRecord(value: unknown, slot: string): value is LeaseRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<LeaseRecord>;
  return (
    record.schema_version === LEASE_SCHEMA_VERSION &&
    record.slot === slot &&
    typeof record.token === "number" &&
    Number.isInteger(record.token) &&
    record.token >= 0 &&
    (record.holder === null || typeof record.holder === "string") &&
    (record.acquired_at === null || typeof record.acquired_at === "string") &&
    (record.expires_at === null || typeof record.expires_at === "string")
  );
}

/** Read a slot's record. A missing file is a free slot, not an error. */
export function readLease(dir: string, slot: string): LeaseResult<{ record: LeaseRecord }> {
  if (!SLOT_PATTERN.test(slot)) {
    return refusal("invalid_slot", INVALID_SLOT_DETAIL);
  }
  const path = leasePath(dir, slot);
  if (!existsSync(path)) {
    return { ok: true, record: emptyRecord(slot) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return refusal("lease_corrupt", `lease record ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed, slot)) {
    return refusal("lease_corrupt", `lease record ${path} does not match ${LEASE_SCHEMA_VERSION} for slot "${slot}"`);
  }
  return { ok: true, record: parsed };
}

function writeLease(dir: string, record: LeaseRecord): void {
  const path = leasePath(dir, record.slot);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function isExpired(record: LeaseRecord, atMs: number, skew: number): boolean {
  if (record.holder === null || record.expires_at === null) return false;
  const expires = Date.parse(record.expires_at);
  if (!Number.isFinite(expires)) return true;
  return expires + skew <= atMs;
}

function ensureDir(dir: string): LeaseRefusal | null {
  try {
    mkdirSync(dir, { recursive: true });
    return null;
  } catch (error) {
    return refusal(
      "lease_dir_unavailable",
      `lease directory ${dir} cannot be created: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Read the optional allow-list. Absent file -> null (nothing is restricted). A malformed
 * file (a line that is not a valid slot id) fails closed for every operation.
 */
function readAllowedSlots(
  dir: string
): LeaseResult<{ allowed: Set<string> | null }> {
  const path = join(dir, SLOTS_ALLOW_FILENAME);
  if (!existsSync(path)) return { ok: true, allowed: null };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return refusal(
      "slots_allow_invalid",
      `${SLOTS_ALLOW_FILENAME} cannot be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const allowed = new Set<string>();
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "" || line.startsWith("#")) continue;
    if (!SLOT_PATTERN.test(line)) {
      return refusal(
        "slots_allow_invalid",
        `${SLOTS_ALLOW_FILENAME} line ${index + 1} is not a valid slot id; ${INVALID_SLOT_DETAIL}`
      );
    }
    allowed.add(line);
  }
  return { ok: true, allowed };
}

/** Refuse any operation on a slot the allow-list does not name. */
function ensureSlotAllowed(dir: string, slot: string): LeaseRefusal | null {
  const listed = readAllowedSlots(dir);
  if (!listed.ok) return listed;
  if (listed.allowed !== null && !listed.allowed.has(slot)) {
    return refusal(
      "slot_not_allowed",
      `slot "${slot}" is not listed in ${SLOTS_ALLOW_FILENAME}; add it there (one slot id per line) or use a listed slot`
    );
  }
  return null;
}

/** Every public operation on one slot starts here: allow-list, then the shared lock. */
function withAllowedSlotLock<T>(
  dir: string,
  slot: string,
  options: LeaseOptions,
  body: (record: LeaseRecord) => LeaseResult<T>
): LeaseResult<T> {
  const notAllowed = ensureSlotAllowed(dir, slot);
  if (notAllowed) return notAllowed;
  return withSlotLock(dir, slot, options, body);
}

/**
 * Run one read-modify-write of a slot under the EXISTING registry lock. The lock directory
 * lives inside the lease directory; on any unexpected fs error the lock is still released.
 */
function withSlotLock<T>(
  dir: string,
  slot: string,
  options: LeaseOptions,
  body: (record: LeaseRecord) => LeaseResult<T>
): LeaseResult<T> {
  const dirFault = ensureDir(dir);
  if (dirFault) return dirFault;

  const lockDir = lockPath(dir, slot);
  const acquisition = acquireRegistryLock(lockDir, mkdirSync, {
    ...(options.lockBudgetMs !== undefined ? { lockBudgetMs: options.lockBudgetMs } : {})
  });
  if (!acquisition.locked) {
    return refusal(
      "lock_unavailable",
      `slot lock ${lockDir} held by another writer after ${acquisition.attempts} attempt(s) over ${acquisition.elapsedMs} ms; failing closed`
    );
  }

  try {
    const current = readLease(dir, slot);
    if (!current.ok) return current;
    const result = body(current.record);
    if (!result.ok) return result;
    return result;
  } finally {
    rmdirSync(lockDir);
  }
}

function persist<T>(dir: string, record: LeaseRecord, extra: T): LeaseResult<T> {
  writeLease(dir, record);
  return { ok: true, ...extra };
}

export interface AcquireResult {
  record: LeaseRecord;
  /** True when the slot was free and this holder took it. */
  acquired: boolean;
  /** True when an expired lease was taken over (the token was incremented). */
  took_over: boolean;
}

/**
 * Acquire a slot: succeeds when the slot is free, already held by this holder (idempotent,
 * expiry refreshed), or expired (takeover, which increments the fencing token). A slot held
 * by someone else and unexpired is refused with `slot_held`.
 */
export function acquireLease(
  dir: string,
  slot: string,
  holder: string,
  ttlSeconds: number = DEFAULT_LEASE_TTL_SECONDS,
  options: LeaseOptions = {}
): LeaseResult<AcquireResult> {
  if (!SLOT_PATTERN.test(slot)) {
    return refusal("invalid_slot", INVALID_SLOT_DETAIL);
  }
  if (holder.trim() === "") {
    return refusal("invalid_holder", "holder must be a non-empty identifier");
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return refusal("invalid_ttl", `ttl must be a positive number of seconds; rejected: ${JSON.stringify(ttlSeconds)}`);
  }

  return withAllowedSlotLock(dir, slot, options, (record) => {
    const at = nowMs(options);
    const skew = skewMs(options);
    const expiresAt = iso(at + ttlSeconds * 1000);

    if (record.holder === null) {
      const next: LeaseRecord = {
        ...record,
        token: record.token + 1,
        holder,
        acquired_at: iso(at),
        expires_at: expiresAt
      };
      return persist(dir, next, { record: next, acquired: true, took_over: false });
    }
    if (record.holder === holder) {
      const next: LeaseRecord = { ...record, acquired_at: iso(at), expires_at: expiresAt };
      return persist(dir, next, { record: next, acquired: false, took_over: false });
    }
    if (isExpired(record, at, skew)) {
      const next: LeaseRecord = {
        ...record,
        token: record.token + 1,
        holder,
        acquired_at: iso(at),
        expires_at: expiresAt
      };
      return persist(dir, next, { record: next, acquired: true, took_over: true });
    }
    return refusal(
      "slot_held",
      `slot "${slot}" is held by "${record.holder}" (token ${record.token}) until ${record.expires_at}`
    );
  });
}

/** What one slot try produced inside its own lock. */
type SlotTry =
  | { granted: true; record: LeaseRecord; acquired: boolean; took_over: boolean }
  | { granted: false; holder: string | null; expires_at: string | null };

export interface AcquireAnyResult {
  /** The slot this call was granted. */
  slot: string;
  record: LeaseRecord;
  /** True when this call took the slot fresh or took over an expired lease. */
  acquired: boolean;
  /** True when an expired lease was taken over (the token was incremented). */
  took_over: boolean;
  /** Slots that were held when tried, in the order they were tried. */
  held: Array<{ slot: string; holder: string | null; expires_at: string | null }>;
}

/**
 * Any-of acquire: try the listed slots IN ORDER, one slot lock at a time (never two locks at
 * once, and no new lock), and grant exactly ONE — the first that is free, already held by this
 * holder, or expired. Every other slot that is held is reported when nothing can be granted.
 */
export function acquireAnyLease(
  dir: string,
  slots: string[],
  holder: string,
  ttlSeconds: number = DEFAULT_LEASE_TTL_SECONDS,
  options: LeaseOptions = {}
): LeaseResult<AcquireAnyResult> {
  if (slots.length === 0) {
    return refusal("invalid_slot", "at least one slot id is required");
  }
  for (const slot of slots) {
    if (!SLOT_PATTERN.test(slot)) return refusal("invalid_slot", INVALID_SLOT_DETAIL);
  }
  if (holder.trim() === "") {
    return refusal("invalid_holder", "holder must be a non-empty identifier");
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return refusal("invalid_ttl", `ttl must be a positive number of seconds; rejected: ${JSON.stringify(ttlSeconds)}`);
  }
  const listed = readAllowedSlots(dir);
  if (!listed.ok) return listed;
  if (listed.allowed !== null) {
    const denied = slots.find((slot) => !listed.allowed?.has(slot));
    if (denied !== undefined) return refusal(
      "slot_not_allowed",
      `slot "${denied}" is not listed in ${SLOTS_ALLOW_FILENAME}; add it there (one slot id per line) or use a listed slot`
    );
  }

  const held: Array<{ slot: string; holder: string | null; expires_at: string | null }> = [];

  // Two passes, each slot locked on its own and released before the next:
  //   1. a slot this holder ALREADY holds (idempotent re-acquire: no second grant);
  //   2. otherwise the first free or expired slot in the listed order.
  for (const phase of ["own", "grant"] as const) {
    for (const slot of slots) {
      const attempt = withSlotLock(dir, slot, options, (record): LeaseResult<SlotTry> => {
        const at = nowMs(options);
        const skew = skewMs(options);
        const expiresAt = iso(at + ttlSeconds * 1000);
        const expired = isExpired(record, at, skew);
        if (phase === "own") {
          if (record.holder === holder && !expired) {
            return { ok: true, granted: true, record, acquired: false, took_over: false };
          }
          if (record.holder === null || expired) {
            // Leave it for the grant pass; do not write here.
            return { ok: true, granted: false, holder: null, expires_at: null };
          }
          return { ok: true, granted: false, holder: record.holder, expires_at: record.expires_at };
        }
        if (record.holder === null || expired) {
          const next: LeaseRecord = {
            ...record,
            token: record.token + 1,
            holder,
            acquired_at: iso(at),
            expires_at: expiresAt
          };
          return persist(dir, next, {
            granted: true,
            record: next,
            acquired: true,
            took_over: record.holder !== null
          });
        }
        return { ok: true, granted: false, holder: record.holder, expires_at: record.expires_at };
      });
      if (!attempt.ok) return attempt;
      if (attempt.granted) {
        return {
          ok: true,
          slot,
          record: attempt.record,
          acquired: attempt.acquired,
          took_over: attempt.took_over,
          held
        };
      }
      if (attempt.holder !== null && !held.some((entry) => entry.slot === slot)) {
        held.push({ slot, holder: attempt.holder, expires_at: attempt.expires_at });
      }
    }
  }

  return {
    ok: false,
    code: "all_slots_held",
    detail: `every requested slot is held: ${held
      .map((entry) => `${entry.slot} by "${entry.holder}" until ${entry.expires_at}`)
      .join("; ")}`,
    slots: held
  };
}

/** Renew: only the current holder, with the current token, and only while unexpired. */
export function renewLease(
  dir: string,
  slot: string,
  holder: string,
  token: number,
  ttlSeconds: number = DEFAULT_LEASE_TTL_SECONDS,
  options: LeaseOptions = {}
): LeaseResult<{ record: LeaseRecord }> {
  if (!SLOT_PATTERN.test(slot)) {
    return refusal("invalid_slot", INVALID_SLOT_DETAIL);
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return refusal("invalid_ttl", `ttl must be a positive number of seconds; rejected: ${JSON.stringify(ttlSeconds)}`);
  }
  return withAllowedSlotLock(dir, slot, options, (record) => {
    if (record.holder === null) return refusal("lease_missing", `slot "${slot}" has no holder`);
    if (record.holder !== holder) {
      return refusal("not_holder", `slot "${slot}" is held by "${record.holder}", not "${holder}"`);
    }
    if (record.token !== token) {
      return refusal("stale_token", `slot "${slot}" is at token ${record.token}; this holder presented ${token}`);
    }
    const at = nowMs(options);
    if (isExpired(record, at, skewMs(options))) {
      return refusal("lease_expired", `slot "${slot}" expired at ${record.expires_at}; a renew cannot revive it`);
    }
    const next: LeaseRecord = { ...record, acquired_at: iso(at), expires_at: iso(at + ttlSeconds * 1000) };
    return persist(dir, next, { record: next });
  });
}

/** Release: only the current holder with the current token; the token is retained. */
export function releaseLease(
  dir: string,
  slot: string,
  holder: string,
  token: number,
  options: LeaseOptions = {}
): LeaseResult<{ record: LeaseRecord }> {
  if (!SLOT_PATTERN.test(slot)) {
    return refusal("invalid_slot", INVALID_SLOT_DETAIL);
  }
  return withAllowedSlotLock(dir, slot, options, (record) => {
    if (record.holder === null) return refusal("lease_missing", `slot "${slot}" has no holder`);
    if (record.holder !== holder) {
      return refusal("not_holder", `slot "${slot}" is held by "${record.holder}", not "${holder}"`);
    }
    if (record.token !== token) {
      return refusal("stale_token", `slot "${slot}" is at token ${record.token}; this holder presented ${token}`);
    }
    const next: LeaseRecord = { ...record, holder: null, acquired_at: null, expires_at: null };
    return persist(dir, next, { record: next });
  });
}

export interface CheckResult {
  held: boolean;
  record: LeaseRecord;
}

/** Is this holder still the holder, with this token, and unexpired? Read only. */
export function checkLease(
  dir: string,
  slot: string,
  holder: string,
  token: number,
  options: LeaseOptions = {}
): LeaseResult<CheckResult> {
  const notAllowed = ensureSlotAllowed(dir, slot);
  if (notAllowed) return notAllowed;
  const current = readLease(dir, slot);
  if (!current.ok) return current;
  const record = current.record;
  if (record.holder === null) return refusal("lease_missing", `slot "${slot}" has no holder`);
  if (record.holder !== holder) {
    return refusal("not_holder", `slot "${slot}" is held by "${record.holder}", not "${holder}"`);
  }
  if (record.token !== token) {
    return refusal("stale_token", `slot "${slot}" is at token ${record.token}; this holder presented ${token}`);
  }
  if (isExpired(record, nowMs(options), skewMs(options))) {
    return refusal("lease_expired", `slot "${slot}" expired at ${record.expires_at}`);
  }
  return { ok: true, held: true, record };
}

/** Read-only status: who holds the slot, at which token, and whether it has expired. */
export function leaseStatus(
  dir: string,
  slot: string,
  options: LeaseOptions = {}
): LeaseResult<{ record: LeaseRecord; free: boolean; expired: boolean }> {
  const notAllowed = ensureSlotAllowed(dir, slot);
  if (notAllowed) return notAllowed;
  const current = readLease(dir, slot);
  if (!current.ok) return current;
  const record = current.record;
  return {
    ok: true,
    record,
    free: record.holder === null,
    expired: isExpired(record, nowMs(options), skewMs(options))
  };
}

export interface FenceVerdict {
  valid: boolean;
  current_token: number;
  reason: "current" | "superseded" | "unknown_token";
}

/**
 * The fencing contract for an ACTION already performed under a lease: an action is valid
 * only if it carries the slot's current token. A lower token is `superseded` (a newer lease
 * exists, so the action is void); a higher token was never issued (`unknown_token`).
 */
export function fenceAction(
  dir: string,
  slot: string,
  token: number,
  _options: LeaseOptions = {}
): LeaseResult<FenceVerdict> {
  const notAllowed = ensureSlotAllowed(dir, slot);
  if (notAllowed) return notAllowed;
  const current = readLease(dir, slot);
  if (!current.ok) return current;
  const slotFence = current.record.token;
  if (token === slotFence) return { ok: true, valid: true, current_token: slotFence, reason: "current" };
  if (token < slotFence) return { ok: true, valid: false, current_token: slotFence, reason: "superseded" };
  return { ok: true, valid: false, current_token: slotFence, reason: "unknown_token" };
}
