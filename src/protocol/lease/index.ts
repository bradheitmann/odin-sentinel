// ODIN slot lease: a fenced lease with an expiry, one holder per slot.
//
// Re-export surface for the lease store. Every read-modify-write runs under ODIN's existing
// cross-process registry lock (no second lock); the fencing token is a per-slot integer that
// only ever increases, so an action performed under an older lease is detectable as void.

export {
  DEFAULT_CLOCK_SKEW_MS,
  DEFAULT_LEASE_TTL_SECONDS,
  LEASE_FILE_SUFFIX,
  LEASE_LOCK_SUFFIX,
  LEASE_SCHEMA_VERSION,
  SLOTS_ALLOW_FILENAME,
  acquireAnyLease,
  acquireLease,
  checkLease,
  fenceAction,
  leaseStatus,
  readLease,
  releaseLease,
  renewLease
} from "./store.js";
export type {
  AcquireAnyResult,
  AcquireResult,
  CheckResult,
  FenceVerdict,
  LeaseOptions,
  LeaseRecord,
  LeaseRejectionCode,
  LeaseRefusal,
  LeaseResult
} from "./store.js";
