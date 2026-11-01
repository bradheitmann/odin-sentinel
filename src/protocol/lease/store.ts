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
  | "lease_corrupt";

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

export type LeaseRefusal = { ok: false; code: LeaseRejectionCode; detail: string };
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
    return refusal("invalid_slot", "slot must be a single safe path segment ([A-Za-z0-9][A-Za-z0-9._-]*)");
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
    return refusal("invalid_slot", "slot must be a single safe path segment ([A-Za-z0-9][A-Za-z0-9._-]*)");
  }
  if (holder.trim() === "") {
    return refusal("invalid_holder", "holder must be a non-empty identifier");
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return refusal("invalid_ttl", `ttl must be a positive number of seconds; rejected: ${JSON.stringify(ttlSeconds)}`);
  }

  return withSlotLock(dir, slot, options, (record) => {
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
    return refusal("invalid_slot", "slot must be a single safe path segment ([A-Za-z0-9][A-Za-z0-9._-]*)");
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return refusal("invalid_ttl", `ttl must be a positive number of seconds; rejected: ${JSON.stringify(ttlSeconds)}`);
  }
  return withSlotLock(dir, slot, options, (record) => {
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
    return refusal("invalid_slot", "slot must be a single safe path segment ([A-Za-z0-9][A-Za-z0-9._-]*)");
  }
  return withSlotLock(dir, slot, options, (record) => {
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
  const current = readLease(dir, slot);
  if (!current.ok) return current;
  const currentToken = current.record.token;
  if (token === currentToken) return { ok: true, valid: true, current_token: currentToken, reason: "current" };
  if (token < currentToken) return { ok: true, valid: false, current_token: currentToken, reason: "superseded" };
  return { ok: true, valid: false, current_token: currentToken, reason: "unknown_token" };
}
