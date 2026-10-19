/** Governance registry authority, accounting and finding lifecycle.
 * Transport-independent: callers inject a store; this module never creates one.
 */
import { auditTargetSchema, govdispEventSchema } from "./schemas.js";
import type { AuditTarget, GovdispEvent } from "./schemas.js";
import { asRecord, type ValidationResult } from "./validators.js";

// ---------------------------------------------------------------------------
// STORY-GOVDISP-005 — registry-mode branches for the prose-receipt validators
// (GD-FP-013: never two independently-editable authorities for one fact).
//
// Behind the compatibility flag ODIN_GOVDISP_REGISTRY_MCP (ON by default as of
// 0.6.0 — Amendment 46: unset = active; a non-truthy value such as 0/false/off
// is the explicit opt-out), each prose-receipt validator accepts a TYPED
// REGISTRY EVENT REFERENCE as
// authority: a payload may carry registry_authority: { scope, event_id } in
// place of (or alongside) prose fields. The validator resolves the referenced
// event through the injected store (the GovdispRegistryStoreLike seam
// precedent below), verifies the event exists and matches the artifact class,
// and treats the PROSE as transport/history. A payload carrying a reference
// that FAILS to resolve is rejected by name (registry_authority_unresolved) —
// never a silent fall back to prose — and a prose-only payload still
// validates, with the result carrying authority: "prose_transport" instead of
// authority: "registry" (an advisory distinction, NOT a rejection; prose
// retirement is Wave-4 scope). Under the explicit opt-out every validator in
// this module is byte-compatible with the prose-authority baseline: the flag
// is read first and the baseline result object is returned untouched (no added
// keys, no added warnings).
// ---------------------------------------------------------------------------

/**
 * Env flag gating the registry-mode branches. This is the SAME flag as the
 * MCP registry compatibility surface and the odin-watch FINDING_OPENED
 * emission; as of Amendment 46 the UNIFIED reader lives here
 * (readGovdispRegistryMode) and every consumer delegates to it, so the
 * default inverts in exactly one place.
 */
export const GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR = "ODIN_GOVDISP_REGISTRY_MCP";

const GOVDISP_REGISTRY_AUTHORITY_TRUTHY = new Set(["1", "true", "yes", "on"]);

/** The resolved registry-mode flag state. */
export type GovdispRegistryModeConfig = {
  enabled: boolean;
  source: "env" | "default_on";
};

/**
 * Read the registry-mode flag — THE unified reader every consumer delegates
 * to (the MCP compatibility surface, these registry-mode validator branches,
 * and the odin-watch FINDING_OPENED emission). ACTIVE BY DEFAULT as of 0.6.0
 * (Amendment 46, operator order): an unset or empty value resolves ON with
 * source "default_on". An explicit truthy value (1/true/yes/on, case- and
 * whitespace-insensitive) resolves ON; any other non-empty value
 * (0/false/off/no/...) is the explicit opt-out and resolves OFF — the
 * baseline-compatibility escape hatch. A mistaken "0"/"false" can never
 * half-activate a registry-mode branch; it fully disables it.
 */
export function readGovdispRegistryMode(env: NodeJS.ProcessEnv = process.env): GovdispRegistryModeConfig {
  const raw = env[GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR];
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (normalized.length === 0) {
    return { enabled: true, source: "default_on" };
  }
  return { enabled: GOVDISP_REGISTRY_AUTHORITY_TRUTHY.has(normalized), source: "env" };
}

/**
 * Boolean form of the unified read (Amendment 46): registry mode is ON unless
 * an explicit non-truthy opt-out value is set.
 */
export function isGovdispRegistryAuthorityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readGovdispRegistryMode(env).enabled;
}

/** Named-rejection code: a registry authority reference failed to resolve. */
export const REGISTRY_AUTHORITY_UNRESOLVED_CODE = "registry_authority_unresolved" as const;

/**
 * The registry event classes accepted as receipt authority. A receipt's
 * registry authority is a TERMINAL-class event: terminal events are the
 * registry's outcome records and the only class that persists content hashes
 * (a proof-by-hash binding to the artifact body — the registry never stores
 * raw proof bodies). ATTEMPT, FINDING, BREAK_GLASS, BUDGET, and AUDIT events
 * record governance machinery, not artifact authority, so they never resolve
 * a receipt authority reference.
 */
export const REGISTRY_RECEIPT_AUTHORITY_EVENT_CLASSES = ["TERMINAL"] as const;

/** Injected seams for the registry-mode branches (flag-gated). */
export interface RegistryAuthorityOptions {
  /**
   * Injected registry store (the GovdispRegistryStoreLike seam), bound by the
   * caller. Flag on with a reference present but no usable store fails closed:
   * the reference is rejected by name (registry_authority_unresolved, detail
   * citing the store_unavailable fault).
   */
  store?: GovdispRegistryStoreLike;
  /** Registry base path override; defaults to the store's own default base. */
  base?: string;
  /** Env source for the compatibility flag; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/** The adjudicated authority source carried by a mode-ON result. */
export type RegistryAuthorityInfo =
  | { status: "resolved"; scope: string; event_id: string; event_class: string }
  | { status: "unresolved"; code: typeof REGISTRY_AUTHORITY_UNRESOLVED_CODE; detail: string; scope?: string; event_id?: string };

/**
 * A validator result under the registry-mode branches. With the flag OFF the
 * result is the baseline ValidationResult with NO added keys
 * (byte-compatible). With the flag ON the result additionally carries
 * authority — "registry" when a resolved registry event is the single
 * authority, "prose_transport" when no reference was supplied and the prose
 * itself was validated (advisory; NOT a rejection) — and, for a reference
 * that failed to resolve, a structured registry_authority record naming
 * registry_authority_unresolved.
 */
export type RegistryModeValidationResult = ValidationResult & {
  authority?: "registry" | "prose_transport";
  registry_authority?: RegistryAuthorityInfo;
};

type RegistryAuthorityResolution =
  | { ok: true; scope: string; eventId: string; event: GovdispEvent }
  | { ok: false; scope?: string; eventId?: string; detail: string };

/**
 * Resolve a payload's registry authority reference through the injected store.
 * Pure resolution plus artifact-class match; the event's own append-time
 * validation was the registry's choke point and is reused, never re-run.
 */
function resolveRegistryAuthority(
  artifactLabel: string,
  reference: unknown,
  options: RegistryAuthorityOptions
): RegistryAuthorityResolution {
  if (reference === null || typeof reference !== "object" || Array.isArray(reference)) {
    return { ok: false, detail: `registry_authority must be an object { scope, event_id } naming the registry event that carries authority for this ${artifactLabel}` };
  }
  const record = asRecord(reference);
  const scope = typeof record.scope === "string" && record.scope.trim() !== "" ? record.scope : undefined;
  const eventId = typeof record.event_id === "string" && record.event_id.trim() !== "" ? record.event_id : undefined;
  if (scope === undefined) {
    return { ok: false, detail: "registry_authority.scope must be a non-empty string naming the registry scope" };
  }
  if (eventId === undefined) {
    return { ok: false, scope, detail: "registry_authority.event_id must be a non-empty string naming the authority event" };
  }
  // Deliberate cast (the odin-watch writers seam precedent): a missing store
  // flows into the fail-closed store_unavailable rejection instead of throwing.
  const store = options.store as GovdispRegistryStoreLike;
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) {
    return { ok: false, scope, eventId, detail: `${storeFault.code}: ${storeFault.detail}` };
  }
  const queried = store.queryRegistryEvents(scope, {}, options.base);
  if (!queried.ok) {
    const codes = queried.rejections.map((rejection) => `${rejection.code}(${rejection.field})`).join(", ");
    return { ok: false, scope, eventId, detail: `registry query for scope "${scope}" failed closed: ${codes}` };
  }
  const event = queried.events.find((candidate) => candidate.event_id === eventId);
  if (event === undefined) {
    return { ok: false, scope, eventId, detail: `no registry event with event_id "${eventId}" exists in scope "${scope}"` };
  }
  if (!(REGISTRY_RECEIPT_AUTHORITY_EVENT_CLASSES as readonly string[]).includes(event.event_class)) {
    return { ok: false, scope, eventId, detail: `registry event "${eventId}" is class ${event.event_class}, which is not a receipt-authority class for a ${artifactLabel} (accepted: ${REGISTRY_RECEIPT_AUTHORITY_EVENT_CLASSES.join(" | ")}) — the event exists but does not match the artifact class` };
  }
  return { ok: true, scope, eventId, event };
}

/**
 * The registry-mode branch shared by the five prose-receipt validators.
 * Returns null when the branch does not apply (flag OFF, or flag ON with no
 * registry_authority on the payload) so the caller runs the baseline prose
 * path. When the branch applies, the registry alone adjudicates: a resolved
 * reference is the single authority (prose fields are transport/history and
 * are NOT re-validated as authority — GD-FP-013), and an unresolvable
 * reference is rejected by name (registry_authority_unresolved) with no
 * silent prose fallback.
 */
export function adjudicateRegistryAuthority(
  artifactLabel: string,
  payload: Record<string, unknown>,
  options: RegistryAuthorityOptions
): RegistryModeValidationResult | null {
  if (!isGovdispRegistryAuthorityEnabled(options.env)) return null;
  const reference = payload.registry_authority;
  if (reference === undefined || reference === null) return null;

  const resolution = resolveRegistryAuthority(artifactLabel, reference, options);
  if (!resolution.ok) {
    return {
      valid: false,
      missing: [],
      invalid: ["registry_authority"],
      warnings: [
        `${REGISTRY_AUTHORITY_UNRESOLVED_CODE}: ${resolution.detail} — a registry authority reference that fails to resolve is rejected by name; the prose fields are never silently promoted to authority (GD-FP-013)`
      ],
      registry_authority: {
        status: "unresolved",
        code: REGISTRY_AUTHORITY_UNRESOLVED_CODE,
        detail: resolution.detail,
        ...(resolution.scope !== undefined ? { scope: resolution.scope } : {}),
        ...(resolution.eventId !== undefined ? { event_id: resolution.eventId } : {})
      }
    };
  }

  const { scope, eventId, event } = resolution;
  return {
    valid: true,
    missing: [],
    invalid: [],
    warnings: [
      `registry authority resolved: ${event.event_class} event "${eventId}" in scope "${scope}" is the single authority for this ${artifactLabel} (GD-FP-013); the prose fields are transport/history and were not re-validated as authority`
    ],
    authority: "registry",
    registry_authority: { status: "resolved", scope, event_id: eventId, event_class: event.event_class }
  };
}

/**
 * Mode-ON advisory for a prose-only payload: the baseline prose validation
 * stands (prose retirement is Wave-4 scope, NOT a rejection here), and the
 * result carries authority: "prose_transport" to distinguish it from
 * registry-backed authority. Flag OFF returns the baseline object untouched.
 */
export function withProseTransportAdvisory(
  base: ValidationResult,
  options: RegistryAuthorityOptions
): RegistryModeValidationResult {
  if (!isGovdispRegistryAuthorityEnabled(options.env)) return base;
  return { ...base, authority: "prose_transport" };
}

// ---------------------------------------------------------------------------
// EPIC-052 Wave-1 — governance-displacement registry append/query service
// functions. Dependency-injected by design: the concrete append-only store
// ships in the Wave-1 registry storage module, and this surface binds only a
// structural handle so the public service layer stays decoupled from that
// module (the Wave-0 runtime-isolation contract forbids a direct import here).
// The store owns the single validation choke point; these functions add
// fail-closed named rejections for store/scope argument faults and pass the
// store's named rejections through unchanged.
// ---------------------------------------------------------------------------

/** Named fail-closed rejection, mirroring the registry storage shape. */
export interface GovdispRegistryRejection {
  field: string;
  event_class: string;
  code: string;
  detail: string;
}

/** Deterministic query filters (AND semantics; inclusive ISO ts bounds). */
export interface GovdispRegistryQuery {
  stable_objective_id?: string;
  event_class?: string;
  event_type?: string;
  from_ts?: string;
  to_ts?: string;
}

/** Structural handle over the append-only registry store. */
export interface GovdispRegistryStoreLike {
  appendRegistryEvent(
    scope: string,
    event: unknown,
    base?: string
  ):
    | { ok: true; path: string; event: GovdispEvent }
    | { ok: false; rejections: GovdispRegistryRejection[] };
  queryRegistryEvents(
    scope: string,
    query?: GovdispRegistryQuery,
    base?: string
  ):
    | { ok: true; events: GovdispEvent[] }
    | { ok: false; rejections: GovdispRegistryRejection[] };
}

export type GovdispRegistryAppendResult =
  | { ok: true; path: string; event: GovdispEvent }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type GovdispRegistryQueryResult =
  | { ok: true; events: GovdispEvent[] }
  | { ok: false; rejections: GovdispRegistryRejection[] };

function registryArgumentRejection(field: string, code: string, detail: string): GovdispRegistryRejection {
  return { field, event_class: "<store>", code, detail };
}

function requireRegistryStore(store: GovdispRegistryStoreLike, method: "appendRegistryEvent" | "queryRegistryEvents"): GovdispRegistryRejection | null {
  if (store === null || typeof store !== "object" || typeof store[method] !== "function") {
    return registryArgumentRejection(
      "store",
      "store_unavailable",
      `a registry store with a ${method} function is required; construct one from the Wave-1 registry storage module and inject it`
    );
  }
  return null;
}

function requireRegistryScope(scope: unknown): GovdispRegistryRejection | null {
  if (typeof scope !== "string" || scope.trim() === "") {
    return registryArgumentRejection(
      "scope",
      "invalid_scope",
      "scope must be a non-empty string naming the registry scope (a single safe path segment)"
    );
  }
  return null;
}

/**
 * Append one governance event to the append-only registry log for a scope.
 * The injected store performs the single choke-point validation; malformed
 * events are rejected fail-closed with named field + event-class reasons.
 * No mutation or deletion surface exists — this is an append-only channel.
 */
export function appendGovdispEvent(
  store: GovdispRegistryStoreLike,
  scope: string,
  event: unknown,
  base?: string
): GovdispRegistryAppendResult {
  const storeFault = requireRegistryStore(store, "appendRegistryEvent");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };
  return store.appendRegistryEvent(scope, event, base);
}

/**
 * Deterministically query the append-only registry log for a scope by
 * stable_objective_id, event class, event type, and/or inclusive time range.
 * Results are in append order; invalid queries or corrupt logs fail closed
 * with named rejections and no partial results.
 */
export function queryGovdispEvents(
  store: GovdispRegistryStoreLike,
  scope: string,
  query: GovdispRegistryQuery = {},
  base?: string
): GovdispRegistryQueryResult {
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };
  return store.queryRegistryEvents(scope, query, base);
}

// ---------------------------------------------------------------------------
// STORY-GOVDISP-003 — attempt accounting + attempt-ceiling evaluator.
//
// GD-DEC-004: retry laundering must become a named refusal. These are PURE,
// STATELESS derivations over the append-only registry: every count is derived
// from the registry's own events at evaluation time and NOTHING is stored or
// cached between calls (the registry is the append-only truth; evaluators are
// stateless functions over it). The ceiling binds to the immutable
// stable_objective_id — never to a session, seat, task name, or attempt_index
// label — so no laundering vector (reset / restaff / rename / cure / rerun /
// a fresh "start" for the same objective) can reset the count.
// ---------------------------------------------------------------------------

/**
 * The ceiling on attempts per stable_objective_id. Attempts 1..ATTEMPT_CEILING
 * are permitted; attempt ATTEMPT_CEILING + 1 (and beyond) is refused by name.
 */
export const ATTEMPT_CEILING = 3 as const;

/** The named refusal emitted when an attempt exceeds ATTEMPT_CEILING. */
export const ATTEMPT_REFUSAL_NAME = "ATTEMPT_REFUSED" as const;

/** The named-rejection code carried by an attempt-ceiling refusal. */
export const ATTEMPT_CEILING_CODE = "attempt_ceiling" as const;

/** Canonical attempt trigger spellings (mirrors the registry ATTEMPT_TRIGGERS). */
const ATTEMPT_TRIGGER_VALUES = ["start", "reset", "restaff", "rename", "cure", "rerun"] as const;

/**
 * A named attempt-ceiling refusal. Follows the registry named-rejection shape
 * conventions ({ field, event_class, code, detail }) and additionally carries
 * the attempt-ceiling context: the objective the ceiling binds to, the refused
 * attempt_index, the ceiling, and the laundering trigger vector.
 */
export interface AttemptRefusal {
  name: typeof ATTEMPT_REFUSAL_NAME;
  field: string;
  event_class: "ATTEMPT";
  code: typeof ATTEMPT_CEILING_CODE;
  detail: string;
  stable_objective_id: string;
  attempt_index: number;
  ceiling: number;
  trigger: string;
}

/**
 * Stateless attempt accounting derived from the registry's ATTEMPT events.
 * `count` is the total number of attempts (every attempt increment counts the
 * SAME counter); `per_trigger` breaks the count down by canonical trigger
 * (start/reset/restaff/rename/cure/rerun), with `unknown` absorbing attempt
 * increments that carry no recognized trigger. No counter is persisted: this
 * object is recomputed from events on every call.
 */
export interface AttemptAccounting {
  stable_objective_id: string;
  count: number;
  per_trigger: Record<string, number>;
}

export type DeriveAttemptAccountingResult =
  | { ok: true; accounting: AttemptAccounting }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type EvaluateAttemptCeilingResult =
  | { ok: true; permitted: true; stable_objective_id: string; attempt_index: number; ceiling: number; trigger: string; accounting: AttemptAccounting }
  | { ok: true; permitted: false; refusal: AttemptRefusal; accounting: AttemptAccounting }
  | { ok: false; rejections: GovdispRegistryRejection[] };

function requireStableObjectiveId(stableObjectiveId: unknown): GovdispRegistryRejection | null {
  if (typeof stableObjectiveId !== "string" || stableObjectiveId.trim() === "") {
    return registryArgumentRejection(
      "stable_objective_id",
      "invalid_objective",
      "stable_objective_id must be a non-empty string naming the immutable objective the attempt ceiling binds to"
    );
  }
  return null;
}

/** True when an event is an ATTEMPT-class increment (not a refusal record). */
function isAttemptIncrement(event: GovdispEvent): boolean {
  return (
    event.event_class === "ATTEMPT" &&
    (event.event_type === "ATTEMPT_STARTED" || event.event_type === "ATTEMPT_COUNTED")
  );
}

/** Canonical trigger key for an attempt increment; "unknown" when absent/unrecognized. */
function attemptTriggerKey(event: GovdispEvent): string {
  if (event.event_class !== "ATTEMPT") return "unknown";
  const trigger = (event as { trigger?: unknown }).trigger;
  if (typeof trigger === "string" && (ATTEMPT_TRIGGER_VALUES as readonly string[]).includes(trigger)) {
    return trigger;
  }
  return "unknown";
}

/**
 * Derive the attempt accounting for one stable_objective_id from the registry.
 *
 * Pure and stateless: the count and per-trigger breakdown are recomputed from
 * the registry's ATTEMPT events on every call. EVERY attempt increment
 * (ATTEMPT_STARTED / ATTEMPT_COUNTED) for the objective increments the SAME
 * counter — reset, restaff, rename, cure, rerun, and a fresh start are all
 * attempts; a rename/requeue expressed via a rename-trigger ATTEMPT event
 * counts identically. ATTEMPT_REFUSED records never increment the counter.
 * Only events already recorded under this objective are counted: the
 * ATTEMPT_REFUSED rows this evaluator emits are recorded separately and are
 * not increments.
 */
export function deriveAttemptAccounting(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  base?: string
): DeriveAttemptAccountingResult {
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };
  const objectiveFault = requireStableObjectiveId(stableObjectiveId);
  if (objectiveFault) return { ok: false, rejections: [objectiveFault] };

  const queried = store.queryRegistryEvents(
    scope,
    { stable_objective_id: stableObjectiveId, event_class: "ATTEMPT" },
    base
  );
  if (!queried.ok) return { ok: false, rejections: queried.rejections };

  const perTrigger: Record<string, number> = {};
  let count = 0;
  for (const event of queried.events) {
    if (!isAttemptIncrement(event)) continue;
    const key = attemptTriggerKey(event);
    perTrigger[key] = (perTrigger[key] ?? 0) + 1;
    count += 1;
  }

  return {
    ok: true,
    accounting: { stable_objective_id: stableObjectiveId, count, per_trigger: perTrigger }
  };
}

/**
 * Evaluate the attempt ceiling for one stable_objective_id.
 *
 * The candidate attempt_index is the derived count + 1 (derived from events,
 * never taken from a self-asserted attempt_index field, so a laundering vector
 * cannot reset the count by relabeling). Attempts 1..ATTEMPT_CEILING are
 * permitted; attempt ATTEMPT_CEILING + 1 (and beyond) yields a named
 * ATTEMPT_REFUSED refusal. Stateless: repeated evaluation over the same log
 * yields the identical verdict.
 */
export function evaluateAttemptCeiling(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  trigger: string,
  base?: string
): EvaluateAttemptCeilingResult {
  const accountingResult = deriveAttemptAccounting(store, scope, stableObjectiveId, base);
  if (!accountingResult.ok) return { ok: false, rejections: accountingResult.rejections };

  const { accounting } = accountingResult;
  const attemptIndex = accounting.count + 1;
  const normalizedTrigger =
    typeof trigger === "string" && (ATTEMPT_TRIGGER_VALUES as readonly string[]).includes(trigger)
      ? trigger
      : "unknown";

  if (attemptIndex <= ATTEMPT_CEILING) {
    return {
      ok: true,
      permitted: true,
      stable_objective_id: stableObjectiveId,
      attempt_index: attemptIndex,
      ceiling: ATTEMPT_CEILING,
      trigger: normalizedTrigger,
      accounting
    };
  }

  const priorCount = accounting.count;
  return {
    ok: true,
    permitted: false,
    refusal: {
      name: ATTEMPT_REFUSAL_NAME,
      field: "attempt_index",
      event_class: "ATTEMPT",
      code: ATTEMPT_CEILING_CODE,
      detail: `attempt ceiling exceeded for stable_objective_id "${stableObjectiveId}": attempt ${attemptIndex} exceeds the ${ATTEMPT_CEILING}-attempt ceiling (${priorCount} prior attempt(s) already recorded); retry laundering via a "${normalizedTrigger}" trigger does not reset the count`,
      stable_objective_id: stableObjectiveId,
      attempt_index: attemptIndex,
      ceiling: ATTEMPT_CEILING,
      trigger: normalizedTrigger
    },
    accounting
  };
}

// ---------------------------------------------------------------------------
// STORY-GOVDISP-003 — meta-governance depth cap + break-glass acceptance.
//
// GD-DEC-001 caps meta-governance at ONE audited layer. An AUDIT-class event
// auditing ordinary work is depth 1 (permitted). An audit whose target is
// itself an audit (audit-of-audit) is depth 2 and is REFUSED by name unless a
// valid BREAK_GLASS event for the same stable_objective_id exists in the
// registry. These are PURE, STATELESS derivations over the append-only
// registry — the same doctrine as the attempt evaluator above: depth is
// derived from the registry's own AUDIT events at evaluation time and NOTHING
// is stored or cached between calls. The policy doctrine lives in
// protocol/resources/meta-governance-depth.yaml (cap, refusal codes,
// break-glass requirements); the cap is declared here as a typed constant
// because the canonical resource-loading surface (the protocol repository's
// REQUIRED_PROTOCOL_FILES / ProtocolData) is outside this slice's write
// scope, and ATTEMPT_CEILING sets the in-code constant precedent — the
// contract's typed-constant fallback, recorded in the slice Summary/report.
// ---------------------------------------------------------------------------

/**
 * The cap on meta-governance depth per stable_objective_id. An audit of
 * ordinary work (depth 1) is permitted; any audit-of-audit (depth 2+) is
 * refused by name unless a valid BREAK_GLASS event authorizes the re-audit.
 * Doctrine: protocol/resources/meta-governance-depth.yaml (cap: 1).
 */
export const META_GOVERNANCE_DEPTH_CAP = 1 as const;

/** The named refusal emitted when an audit exceeds META_GOVERNANCE_DEPTH_CAP. */
export const AUDIT_REFUSAL_NAME = "AUDIT_REFUSED" as const;

/** Named-rejection code: depth exceeded the cap with no valid break-glass. */
export const META_GOVERNANCE_DEPTH_CODE = "meta_governance_depth" as const;

/**
 * Named-rejection code: an artifact offered as break-glass authority is not a
 * BREAK_GLASS event. An [SCP-EXCEPTION]-shaped payload (or any other class) is
 * never accepted as break-glass authority (G7).
 */
export const BREAK_GLASS_WRONG_CLASS_CODE = "break_glass_wrong_class" as const;

/**
 * A named meta-governance depth refusal. Follows the registry named-rejection
 * shape conventions ({ field, event_class, code, detail }) and additionally
 * carries the depth-cap context: the objective the cap binds to, the derived
 * depth, and the cap.
 */
export interface MetaGovernanceDepthRefusal {
  name: typeof AUDIT_REFUSAL_NAME;
  field: string;
  event_class: "AUDIT";
  code: typeof META_GOVERNANCE_DEPTH_CODE | typeof BREAK_GLASS_WRONG_CLASS_CODE;
  detail: string;
  stable_objective_id: string;
  depth: number;
  cap: number;
}

/**
 * Stateless meta-governance depth derivation. `depth` is the candidate audit's
 * derived depth (1 = audits ordinary work; 2+ = audit-of-audit chain);
 * `audit_chain` lists the resolved target_event_id links walked through the
 * registry; `break_glass_*` reports BREAK_GLASS presence/binding for the same
 * stable_objective_id. Recomputed from events on every call — never stored.
 */
export interface MetaGovernanceDepthDerivation {
  stable_objective_id: string;
  depth: number;
  cap: number;
  audit_chain: string[];
  break_glass_present: boolean;
  break_glass_event_ids: string[];
}

export type DeriveMetaGovernanceDepthResult =
  | { ok: true; derivation: MetaGovernanceDepthDerivation }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type EvaluateMetaGovernanceDepthResult =
  | {
      ok: true;
      permitted: true;
      stable_objective_id: string;
      depth: number;
      cap: number;
      authorized_by: "depth_cap" | "break_glass";
      break_glass_event_id: string | null;
      derivation: MetaGovernanceDepthDerivation;
    }
  | { ok: true; permitted: false; refusal: MetaGovernanceDepthRefusal; derivation: MetaGovernanceDepthDerivation }
  | { ok: false; rejections: GovdispRegistryRejection[] };

/** Options for evaluateMetaGovernanceDepth. */
export interface MetaGovernanceDepthEvaluationOptions {
  /**
   * An artifact offered out-of-band as break-glass authority for this
   * re-audit. It must BE a schema-valid BREAK_GLASS event that is also present
   * in the registry bound to the same stable_objective_id (registry presence
   * is the authority; the offer only binds it). Any other shape — an
   * [SCP-EXCEPTION] payload, a different event class, a malformed object — is
   * rejected by name (break_glass_wrong_class), never accepted.
   */
  breakGlassAuthority?: unknown;
}

/**
 * Derive the meta-governance depth of a candidate audit target from the
 * registry's own events.
 *
 * Pure and stateless: depth is recomputed from the registry on every call. An
 * audit of ordinary work is depth 1. An audit whose target is another audit
 * event (target.kind = "audit") is depth 2 or deeper; the chain is walked
 * through the registry's AUDIT events for the same stable_objective_id, with
 * cycle and unresolvable-id links terminating the walk (each still counts as
 * one layer — an audit claiming an audit target is meta-governance whether or
 * not the target resolves). BREAK_GLASS presence for the objective is reported
 * alongside; BREAK_GLASS events already carry the append-time union validation
 * (authorizing_human + named contradiction), which is reused here, never
 * re-validated.
 */
export function deriveMetaGovernanceDepth(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  target: unknown,
  base?: string
): DeriveMetaGovernanceDepthResult {
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };
  const objectiveFault = requireStableObjectiveId(stableObjectiveId);
  if (objectiveFault) return { ok: false, rejections: [objectiveFault] };

  const parsedTarget = auditTargetSchema.safeParse(target);
  if (!parsedTarget.success) {
    return {
      ok: false,
      rejections: [{
        field: "target",
        event_class: "AUDIT",
        code: "invalid_target",
        detail: "target must be a schema-valid audit target: { kind: \"ordinary_work\" } or { kind: \"audit\", target_event_id }"
      }]
    };
  }

  const queried = store.queryRegistryEvents(
    scope,
    { stable_objective_id: stableObjectiveId },
    base
  );
  if (!queried.ok) return { ok: false, rejections: queried.rejections };

  const auditEventsById = new Map<string, GovdispEvent>();
  const breakGlassEventIds: string[] = [];
  for (const event of queried.events) {
    if (event.event_class === "AUDIT") auditEventsById.set(event.event_id, event);
    if (event.event_class === "BREAK_GLASS") breakGlassEventIds.push(event.event_id);
  }

  const chain: string[] = [];
  let depth = 1;
  let current: AuditTarget = parsedTarget.data;
  const visited = new Set<string>();
  while (current.kind === "audit") {
    depth += 1;
    chain.push(current.target_event_id);
    if (visited.has(current.target_event_id)) break;
    visited.add(current.target_event_id);
    const targetEvent = auditEventsById.get(current.target_event_id);
    if (targetEvent === undefined || targetEvent.event_class !== "AUDIT") break;
    current = targetEvent.target;
  }

  return {
    ok: true,
    derivation: {
      stable_objective_id: stableObjectiveId,
      depth,
      cap: META_GOVERNANCE_DEPTH_CAP,
      audit_chain: chain,
      break_glass_present: breakGlassEventIds.length > 0,
      break_glass_event_ids: breakGlassEventIds
    }
  };
}

/**
 * Evaluate the meta-governance depth cap for a candidate audit.
 *
 * Depth 1 (an audit of ordinary work) is permitted under the cap. Depth 2+
 * (an audit whose target is itself an audit) is REFUSED with a named
 * meta_governance_depth refusal UNLESS a valid BREAK_GLASS event for the same
 * stable_objective_id exists in the registry — presence plus binding is the
 * authorization, never an in-memory offer alone. An [SCP-EXCEPTION]-shaped
 * payload (or any non-BREAK_GLASS artifact) offered as break-glass authority
 * is rejected by name (break_glass_wrong_class). Stateless: repeated
 * evaluation over the same log yields the identical verdict.
 */
export function evaluateMetaGovernanceDepth(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  target: unknown,
  base?: string,
  options: MetaGovernanceDepthEvaluationOptions = {}
): EvaluateMetaGovernanceDepthResult {
  const derivationResult = deriveMetaGovernanceDepth(store, scope, stableObjectiveId, target, base);
  if (!derivationResult.ok) return { ok: false, rejections: derivationResult.rejections };
  const { derivation } = derivationResult;

  const refuse = (
    code: typeof META_GOVERNANCE_DEPTH_CODE | typeof BREAK_GLASS_WRONG_CLASS_CODE,
    field: string,
    detail: string
  ): EvaluateMetaGovernanceDepthResult => ({
    ok: true,
    permitted: false,
    refusal: {
      name: AUDIT_REFUSAL_NAME,
      field,
      event_class: "AUDIT",
      code,
      detail,
      stable_objective_id: stableObjectiveId,
      depth: derivation.depth,
      cap: derivation.cap
    },
    derivation
  });

  // G7: validate any out-of-band artifact offered as break-glass authority
  // BEFORE consulting the cap. An exception-shaped or otherwise non-BREAK_GLASS
  // offer is named and refused — never accepted, never silently ignored.
  let offeredBreakGlassId: string | null = null;
  const offered = options.breakGlassAuthority;
  if (offered !== undefined && offered !== null) {
    const parsedOffer = govdispEventSchema.safeParse(offered);
    if (!parsedOffer.success || parsedOffer.data.event_class !== "BREAK_GLASS") {
      return refuse(
        BREAK_GLASS_WRONG_CLASS_CODE,
        "break_glass",
        `the artifact offered as break-glass authority for stable_objective_id "${stableObjectiveId}" is not a BREAK_GLASS event (an [SCP-EXCEPTION]-shaped payload, or any other class, is not break-glass authority); only a schema-valid BREAK_GLASS_RECORDED event recorded in the registry can authorize a re-audit`
      );
    }
    const offerEvent = parsedOffer.data;
    if (
      offerEvent.stable_objective_id !== stableObjectiveId ||
      !derivation.break_glass_event_ids.includes(offerEvent.event_id)
    ) {
      return refuse(
        META_GOVERNANCE_DEPTH_CODE,
        "break_glass",
        `the offered BREAK_GLASS event "${offerEvent.event_id}" is not present in the registry bound to stable_objective_id "${stableObjectiveId}"; break-glass authorization requires presence plus binding — an in-memory offer alone is not authority`
      );
    }
    offeredBreakGlassId = offerEvent.event_id;
  }

  if (derivation.depth <= derivation.cap) {
    return {
      ok: true,
      permitted: true,
      stable_objective_id: stableObjectiveId,
      depth: derivation.depth,
      cap: derivation.cap,
      authorized_by: "depth_cap",
      break_glass_event_id: null,
      derivation
    };
  }

  const authorizingBreakGlassId = offeredBreakGlassId ?? derivation.break_glass_event_ids[0] ?? null;
  if (authorizingBreakGlassId !== null) {
    return {
      ok: true,
      permitted: true,
      stable_objective_id: stableObjectiveId,
      depth: derivation.depth,
      cap: derivation.cap,
      authorized_by: "break_glass",
      break_glass_event_id: authorizingBreakGlassId,
      derivation
    };
  }

  return refuse(
    META_GOVERNANCE_DEPTH_CODE,
    "target",
    `meta-governance depth ${derivation.depth} exceeds the cap of ${derivation.cap} for stable_objective_id "${stableObjectiveId}": an audit whose target is itself an audit is an audit-of-audit and requires a valid BREAK_GLASS_RECORDED event (authorizing_human plus a named concrete contradiction) recorded in the registry for the same objective — none is recorded`
  );
}

// ---------------------------------------------------------------------------
// STORY-GOVDISP-003 — governance-overhead budget + single terminal-blocked
// event (GD-DEC-002: governance overhead must terminate in exactly ONE blocked
// event instead of spawning more proof work).
//
// These are PURE, STATELESS derivations over the append-only registry — the
// same doctrine as the attempt and depth evaluators above: every count is
// recomputed from the registry's own events at evaluation time and NOTHING is
// stored or cached between calls (the registry is the append-only truth;
// evaluators are stateless functions over it). The budget binds to the
// immutable stable_objective_id. The policy doctrine lives in
// protocol/resources/governance-overhead-budget.yaml (budget, countable
// classes, refusal codes, terminal-guard rules); the budget is declared here
// as a typed constant because the canonical resource-loading surface (the
// protocol repository's REQUIRED_PROTOCOL_FILES / ProtocolData) is outside
// this slice's write scope, and ATTEMPT_CEILING / META_GOVERNANCE_DEPTH_CAP
// set the in-code constant precedent — the contract's typed-constant fallback,
// recorded in the slice Summary/report.
//
// LAYERING (recorded per contract): the registry storage choke point stays
// shape-only. The budget guard, the terminal guard, and the post-terminal
// refusal below are service-layer policy functions that callers invoke;
// storage validation is reused, never re-implemented, never widened.
// ---------------------------------------------------------------------------

/**
 * The governance-overhead budget per stable_objective_id. While the derived
 * overhead count is below GOVERNANCE_OVERHEAD_BUDGET, further overhead is
 * permitted with remaining = budget - count; at count >= budget the objective's
 * overhead budget is exhausted and the candidate overhead event is refused by
 * name (candidate-event semantics, the ATTEMPT_CEILING precedent). Doctrine:
 * protocol/resources/governance-overhead-budget.yaml (default_overhead_budget:
 * 25 — a deliberately generous ceiling; run-ledger field data shows healthy
 * slices consume fewer than 20 governance events).
 */
export const GOVERNANCE_OVERHEAD_BUDGET = 25 as const;

/** The named refusal emitted when governance overhead reaches the budget. */
export const OVERHEAD_BUDGET_REFUSAL_NAME = "GOVERNANCE_OVERHEAD_BUDGET_REFUSED" as const;

/** Named-rejection code: the governance-overhead budget is exhausted. */
export const GOVERNANCE_OVERHEAD_BUDGET_CODE = "governance_overhead_budget" as const;

/** The named refusal emitted when the terminal guard declines an append. */
export const TERMINAL_BLOCKED_REFUSAL_NAME = "TERMINAL_BLOCKED_REFUSED" as const;

/** Named-rejection code: a TERMINAL_BLOCKED event already exists for the objective. */
export const TERMINAL_ALREADY_RECORDED_CODE = "terminal_already_recorded" as const;

/** Named-rejection code: the terminal guard was invoked without a budget breach. */
export const BUDGET_NOT_EXHAUSTED_CODE = "budget_not_exhausted" as const;

/** The named refusal emitted when a governance-overhead append follows a TERMINAL_BLOCKED. */
export const GOVERNANCE_APPEND_REFUSAL_NAME = "GOVERNANCE_APPEND_REFUSED" as const;

/** Named-rejection code: the objective is terminally blocked; overhead appends are refused. */
export const OBJECTIVE_TERMINALLY_BLOCKED_CODE = "objective_terminally_blocked" as const;

/**
 * The governance-overhead event classes counted toward the budget. TERMINAL
 * events are outcomes, not overhead, and NEVER count (the countable-class
 * boundary); BUDGET events are the budget machinery's own records, and counting
 * them would be self-referential.
 */
const GOVERNANCE_OVERHEAD_COUNTABLE_CLASSES = ["ATTEMPT", "FINDING", "BREAK_GLASS", "AUDIT"] as const;

/**
 * Stateless governance-overhead accounting derived from the registry. `count`
 * is the number of governance-overhead events (the countable classes) recorded
 * for the objective; `per_class` breaks the count down by class; `remaining` is
 * how many further overhead events fit under the budget (0 at exhaustion);
 * `terminal_blocked_*` reports TERMINAL_BLOCKED presence for the objective. No
 * counter is persisted: this object is recomputed from events on every call.
 */
export interface OverheadAccounting {
  stable_objective_id: string;
  count: number;
  per_class: Record<string, number>;
  budget: number;
  remaining: number;
  terminal_blocked_present: boolean;
  terminal_blocked_event_ids: string[];
}

/**
 * A named governance-overhead budget refusal. Follows the registry
 * named-rejection shape conventions ({ field, event_class, code, detail }) and
 * additionally carries the budget context: the objective the budget binds to,
 * the derived overhead count, and the budget.
 */
export interface OverheadBudgetRefusal {
  name: typeof OVERHEAD_BUDGET_REFUSAL_NAME;
  field: string;
  event_class: "BUDGET";
  code: typeof GOVERNANCE_OVERHEAD_BUDGET_CODE;
  detail: string;
  stable_objective_id: string;
  count: number;
  budget: number;
}

/**
 * A named terminal-guard refusal: the TERMINAL_BLOCKED append was declined,
 * either because the exactly-one invariant already holds
 * (terminal_already_recorded, with existing_event_id set) or because no budget
 * breach exists to terminate (budget_not_exhausted).
 */
export interface TerminalBlockedRefusal {
  name: typeof TERMINAL_BLOCKED_REFUSAL_NAME;
  field: string;
  event_class: "TERMINAL";
  code: typeof TERMINAL_ALREADY_RECORDED_CODE | typeof BUDGET_NOT_EXHAUSTED_CODE;
  detail: string;
  stable_objective_id: string;
  existing_event_id: string | null;
  count: number;
  budget: number;
}

/**
 * A named post-terminal refusal: a governance-overhead append was attempted
 * for an objective that already carries a TERMINAL_BLOCKED event.
 */
export interface ObjectiveTerminallyBlockedRefusal {
  name: typeof GOVERNANCE_APPEND_REFUSAL_NAME;
  field: string;
  event_class: string;
  code: typeof OBJECTIVE_TERMINALLY_BLOCKED_CODE;
  detail: string;
  stable_objective_id: string;
  terminal_event_id: string;
}

/** Input for recordBudgetExhaustion: the caller-supplied terminal event fields. */
export interface RecordBudgetExhaustionInput {
  event_id: string;
  ts: string;
  actor_role?: string;
  /**
   * Evidence bindings for the terminal record. The typed event union requires
   * at least one content hash on every TERMINAL event (terminal events persist
   * content hashes rather than raw proof bodies); an empty list is rejected by
   * the store's append-time union validation, which is reused, never
   * re-validated here.
   */
  content_hashes: Array<{ path: string; sha256: string }>;
}

export type DeriveOverheadAccountingResult =
  | { ok: true; accounting: OverheadAccounting }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type EvaluateOverheadBudgetResult =
  | { ok: true; permitted: true; stable_objective_id: string; count: number; budget: number; remaining: number; accounting: OverheadAccounting }
  | { ok: true; permitted: false; refusal: OverheadBudgetRefusal; accounting: OverheadAccounting }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type RecordBudgetExhaustionResult =
  | { ok: true; appended: true; path: string; event: GovdispEvent; accounting: OverheadAccounting }
  | { ok: true; appended: false; refusal: TerminalBlockedRefusal; accounting: OverheadAccounting }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type AppendGovernanceOverheadEventResult =
  | { ok: true; appended: true; path: string; event: GovdispEvent }
  | { ok: true; appended: false; refusal: ObjectiveTerminallyBlockedRefusal }
  | { ok: false; rejections: GovdispRegistryRejection[] };

/**
 * Derive the governance-overhead accounting for one stable_objective_id from
 * the registry.
 *
 * Pure and stateless: the count, per-class breakdown, and TERMINAL_BLOCKED
 * presence are recomputed from the registry's events on every call. Only the
 * countable classes (ATTEMPT, FINDING, BREAK_GLASS, AUDIT) increment the count;
 * TERMINAL events are outcomes and BUDGET events are the budget machinery's own
 * records, so neither ever counts toward the budget. Refusal records are
 * returned to callers, never appended, so refusals cannot inflate the count.
 */
export function deriveOverheadAccounting(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  base?: string
): DeriveOverheadAccountingResult {
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };
  const objectiveFault = requireStableObjectiveId(stableObjectiveId);
  if (objectiveFault) return { ok: false, rejections: [objectiveFault] };

  const queried = store.queryRegistryEvents(
    scope,
    { stable_objective_id: stableObjectiveId },
    base
  );
  if (!queried.ok) return { ok: false, rejections: queried.rejections };

  const perClass: Record<string, number> = {};
  const terminalBlockedEventIds: string[] = [];
  let count = 0;
  for (const event of queried.events) {
    if ((GOVERNANCE_OVERHEAD_COUNTABLE_CLASSES as readonly string[]).includes(event.event_class)) {
      perClass[event.event_class] = (perClass[event.event_class] ?? 0) + 1;
      count += 1;
    }
    if (event.event_class === "TERMINAL" && event.event_type === "TERMINAL_BLOCKED") {
      terminalBlockedEventIds.push(event.event_id);
    }
  }

  return {
    ok: true,
    accounting: {
      stable_objective_id: stableObjectiveId,
      count,
      per_class: perClass,
      budget: GOVERNANCE_OVERHEAD_BUDGET,
      remaining: Math.max(0, GOVERNANCE_OVERHEAD_BUDGET - count),
      terminal_blocked_present: terminalBlockedEventIds.length > 0,
      terminal_blocked_event_ids: terminalBlockedEventIds
    }
  };
}

/**
 * Evaluate the governance-overhead budget for one stable_objective_id.
 *
 * Under budget (count < GOVERNANCE_OVERHEAD_BUDGET): permitted, with the
 * remaining count. At exhaustion (count >= budget): the candidate overhead
 * event is REFUSED with a named governance_overhead_budget refusal carrying
 * the objective, count, and budget. The verdict is a pure derivation over the
 * registry: repeated evaluation over the same log yields the identical verdict,
 * and the evaluator never appends anything — on breach the caller invokes the
 * terminal guard (recordBudgetExhaustion), which terminates the objective in
 * exactly one blocked event instead of spawning more proof work.
 */
export function evaluateOverheadBudget(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  base?: string
): EvaluateOverheadBudgetResult {
  const accountingResult = deriveOverheadAccounting(store, scope, stableObjectiveId, base);
  if (!accountingResult.ok) return { ok: false, rejections: accountingResult.rejections };
  const { accounting } = accountingResult;

  if (accounting.count < accounting.budget) {
    return {
      ok: true,
      permitted: true,
      stable_objective_id: stableObjectiveId,
      count: accounting.count,
      budget: accounting.budget,
      remaining: accounting.remaining,
      accounting
    };
  }

  return {
    ok: true,
    permitted: false,
    refusal: {
      name: OVERHEAD_BUDGET_REFUSAL_NAME,
      field: "overhead_count",
      event_class: "BUDGET",
      code: GOVERNANCE_OVERHEAD_BUDGET_CODE,
      detail: `governance-overhead budget exhausted for stable_objective_id "${stableObjectiveId}": ${accounting.count} countable governance event(s) (${GOVERNANCE_OVERHEAD_COUNTABLE_CLASSES.join(" | ")}) reached the budget of ${accounting.budget}; the candidate overhead event is refused — terminate the objective with exactly one TERMINAL_BLOCKED via recordBudgetExhaustion instead of spawning more proof work`,
      stable_objective_id: stableObjectiveId,
      count: accounting.count,
      budget: accounting.budget
    },
    accounting
  };
}

/**
 * The terminal guard (GD-DEC-002): on a derived budget breach, append EXACTLY
 * ONE TERMINAL_BLOCKED event for the objective.
 *
 * The single-event invariant is DERIVED, not stored: before appending, the
 * guard re-derives the accounting from the registry and refuses the append by
 * name (terminal_already_recorded) when a TERMINAL_BLOCKED already exists for
 * the objective — a second exhaustion call is idempotent and appends nothing.
 * The guard fires only on breach: without a derived budget exhaustion there is
 * nothing to terminate, and the append is refused by name (budget_not_exhausted)
 * so a false terminal block can never be recorded through this guard. The guard
 * is race-tolerant via the store's existing lock: single-process callers cannot
 * interleave the synchronous derive-then-append sequence, the store's mkdir
 * lock serializes every individual append across processes, and any duplicate
 * invocation after the first landing refuses by name. The append itself passes
 * through the store's single validation choke point unchanged (the TERMINAL
 * union member requires content_hashes — reused, never re-validated here).
 */
export function recordBudgetExhaustion(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  event: RecordBudgetExhaustionInput,
  base?: string
): RecordBudgetExhaustionResult {
  const accountingResult = deriveOverheadAccounting(store, scope, stableObjectiveId, base);
  if (!accountingResult.ok) return { ok: false, rejections: accountingResult.rejections };
  const { accounting } = accountingResult;

  if (accounting.terminal_blocked_present) {
    const existingEventId = accounting.terminal_blocked_event_ids[0] ?? "";
    return {
      ok: true,
      appended: false,
      refusal: {
        name: TERMINAL_BLOCKED_REFUSAL_NAME,
        field: "event_type",
        event_class: "TERMINAL",
        code: TERMINAL_ALREADY_RECORDED_CODE,
        detail: `a TERMINAL_BLOCKED event already exists for stable_objective_id "${stableObjectiveId}" (event_id "${existingEventId}"); the exactly-one terminal invariant is derived from the registry — the duplicate append is refused and nothing is recorded`,
        stable_objective_id: stableObjectiveId,
        existing_event_id: existingEventId,
        count: accounting.count,
        budget: accounting.budget
      },
      accounting
    };
  }

  if (accounting.count < accounting.budget) {
    return {
      ok: true,
      appended: false,
      refusal: {
        name: TERMINAL_BLOCKED_REFUSAL_NAME,
        field: "overhead_count",
        event_class: "TERMINAL",
        code: BUDGET_NOT_EXHAUSTED_CODE,
        detail: `no budget breach exists for stable_objective_id "${stableObjectiveId}" (${accounting.count} of ${accounting.budget} governance-overhead events recorded); the terminal guard fires on a derived breach only — appending a terminal event now would be a false block`,
        stable_objective_id: stableObjectiveId,
        existing_event_id: null,
        count: accounting.count,
        budget: accounting.budget
      },
      accounting
    };
  }

  const storeFault = requireRegistryStore(store, "appendRegistryEvent");
  if (storeFault) return { ok: false, rejections: [storeFault] };

  // The canonical registry schema version literal is spelled out here because
  // the Wave-0 runtime-isolation contract forbids importing the registry
  // module's constants into this service layer; the store's choke point
  // validates the value against the canonical schema on every append.
  const terminalEvent = {
    schema_version: "govdisp.event.v1",
    event_id: event.event_id,
    ts: event.ts,
    stable_objective_id: stableObjectiveId,
    ...(typeof event.actor_role === "string" ? { actor_role: event.actor_role } : {}),
    event_class: "TERMINAL",
    event_type: "TERMINAL_BLOCKED",
    content_hashes: event.content_hashes
  };
  const appended = store.appendRegistryEvent(scope, terminalEvent, base);
  if (!appended.ok) return { ok: false, rejections: appended.rejections };
  return { ok: true, appended: true, path: appended.path, event: appended.event, accounting };
}

/**
 * The post-terminal refusal guard: the service-layer channel callers invoke for
 * governance-overhead appends. Once a TERMINAL_BLOCKED event exists for an
 * objective, further governance-overhead appends (the countable classes) for
 * that objective are refused by name (objective_terminally_blocked) — the
 * terminal event is the end of the proof chain, never the start of a new one.
 *
 * The check is derivation-based: terminal presence is recomputed from the
 * registry on every call; nothing is cached. Jurisdiction is exactly the
 * countable governance-overhead classes on a payload carrying a non-empty
 * stable_objective_id; every other payload passes through to the store's
 * shape-only validation choke point unchanged — the storage layer stays
 * shape-only and this guard adds service-layer policy on top, never inside it.
 */
export function appendGovernanceOverheadEvent(
  store: GovdispRegistryStoreLike,
  scope: string,
  event: unknown,
  base?: string
): AppendGovernanceOverheadEventResult {
  const queryFault = requireRegistryStore(store, "queryRegistryEvents");
  if (queryFault) return { ok: false, rejections: [queryFault] };
  const appendFault = requireRegistryStore(store, "appendRegistryEvent");
  if (appendFault) return { ok: false, rejections: [appendFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };

  const candidate = event !== null && typeof event === "object" && !Array.isArray(event)
    ? (event as Record<string, unknown>)
    : undefined;
  const objectiveId = typeof candidate?.stable_objective_id === "string" ? candidate.stable_objective_id : "";
  const eventClass = typeof candidate?.event_class === "string" ? candidate.event_class : "";
  const governedOverhead =
    objectiveId.trim() !== "" &&
    (GOVERNANCE_OVERHEAD_COUNTABLE_CLASSES as readonly string[]).includes(eventClass);

  if (governedOverhead) {
    const accountingResult = deriveOverheadAccounting(store, scope, objectiveId, base);
    if (!accountingResult.ok) return { ok: false, rejections: accountingResult.rejections };
    const { accounting } = accountingResult;
    if (accounting.terminal_blocked_present) {
      const terminalEventId = accounting.terminal_blocked_event_ids[0] ?? "";
      return {
        ok: true,
        appended: false,
        refusal: {
          name: GOVERNANCE_APPEND_REFUSAL_NAME,
          field: "stable_objective_id",
          event_class: eventClass,
          code: OBJECTIVE_TERMINALLY_BLOCKED_CODE,
          detail: `stable_objective_id "${objectiveId}" is terminally blocked (TERMINAL_BLOCKED event_id "${terminalEventId}"); further governance-overhead appends for this objective are refused — the terminal event ends the proof chain instead of spawning a new one`,
          stable_objective_id: objectiveId,
          terminal_event_id: terminalEventId
        }
      };
    }
  }

  const appended = store.appendRegistryEvent(scope, event, base);
  if (!appended.ok) return { ok: false, rejections: appended.rejections };
  return { ok: true, appended: true, path: appended.path, event: appended.event };
}

// ---------------------------------------------------------------------------
// STORY-GOVDISP-004 — finding ownership lifecycle (GD-DEC-005: a finding is
// not ACTIVE until it has an accountable owner and a delivery event; "logged"
// must not masquerade as "driven").
//
// These are PURE, STATELESS derivations over the append-only registry — the
// same doctrine as the attempt, depth, and budget evaluators above: a
// finding's lifecycle state is recomputed from the registry's own FINDING
// events at evaluation time and NOTHING is stored or cached between calls
// (the registry is the append-only truth; evaluators are stateless functions
// over it). The Wave-0 union already carries the full FINDING family
// (FINDING_OPENED/OWNED/DELIVERED/CLOSED); this slice adds derivation and
// refusal policy only — no union changes. The closure evaluator is registry
// negative control #9: a FINDING_CLOSED raised for a finding lacking a
// FINDING_OWNED owner binding, a FINDING_DELIVERED delivery event, or both is
// refused with the named finding_not_active refusal citing exactly which
// prerequisite events are missing; closing an owned+delivered finding is
// permitted. The intervention-duty guard (countActiveFindings) counts only
// owner-bound findings with delivery events — unowned findings never count
// toward ODIN intervention duties.
// ---------------------------------------------------------------------------

/** The named refusal emitted when a finding closure violates GD-DEC-005. */
export const FINDING_REFUSAL_NAME = "FINDING_REFUSED" as const;

/** Named-rejection code: the finding is not ACTIVE (ownership/delivery prerequisites missing). */
export const FINDING_NOT_ACTIVE_CODE = "finding_not_active" as const;

/**
 * The FINDING event types a closure requires in the registry, in canonical
 * family order. A finding missing either prerequisite is not ACTIVE and is
 * non-closable (registry negative control #9).
 */
export const FINDING_CLOSURE_PREREQUISITES = ["FINDING_OWNED", "FINDING_DELIVERED"] as const;
export type FindingClosurePrerequisite = (typeof FINDING_CLOSURE_PREREQUISITES)[number];

/**
 * Stateless finding lifecycle derivation for one finding_id. Presence flags
 * and event-id lists (append order) are recomputed from the registry's
 * FINDING events on every call. `active` is the GD-DEC-005 binding: the
 * finding carries BOTH a FINDING_OWNED owner binding and a FINDING_DELIVERED
 * delivery event and is not closed. `missing_prerequisites` names exactly
 * which closure prerequisites are absent (canonical family order); it is
 * empty iff the finding is closable.
 */
export interface FindingStateDerivation {
  finding_id: string;
  event_count: number;
  opened: boolean;
  owned: boolean;
  delivered: boolean;
  closed: boolean;
  active: boolean;
  owner_roles: string[];
  opened_event_ids: string[];
  owned_event_ids: string[];
  delivered_event_ids: string[];
  closed_event_ids: string[];
  missing_prerequisites: FindingClosurePrerequisite[];
}

/**
 * A named finding-closure refusal. Follows the registry named-rejection
 * shape conventions ({ field, event_class, code, detail }) and additionally
 * carries the finding the closure was attempted on plus exactly which
 * prerequisite events are missing.
 */
export interface FindingClosureRefusal {
  name: typeof FINDING_REFUSAL_NAME;
  field: string;
  event_class: "FINDING";
  code: typeof FINDING_NOT_ACTIVE_CODE;
  detail: string;
  finding_id: string;
  missing_prerequisites: FindingClosurePrerequisite[];
}

export type DeriveFindingStateResult =
  | { ok: true; state: FindingStateDerivation }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type EvaluateFindingClosureResult =
  | { ok: true; permitted: true; finding_id: string; state: FindingStateDerivation }
  | { ok: true; permitted: false; refusal: FindingClosureRefusal; state: FindingStateDerivation }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type CountActiveFindingsResult =
  | { ok: true; count: number; active_finding_ids: string[]; inactive_finding_ids: string[] }
  | { ok: false; rejections: GovdispRegistryRejection[] };

function requireFindingId(findingId: unknown): GovdispRegistryRejection | null {
  if (typeof findingId !== "string" || findingId.trim() === "") {
    return registryArgumentRejection(
      "finding_id",
      "invalid_finding_id",
      "finding_id must be a non-empty string naming the finding whose lifecycle is derived"
    );
  }
  return null;
}

/**
 * Pure reducer: fold one finding's FINDING events (append order) into its
 * lifecycle state. An accountable owner is a FINDING_OWNED event (its
 * owner_role binding is reported when the event carries one); delivery is a
 * FINDING_DELIVERED event. Never touches storage — the caller supplies the
 * already-queried events.
 */
function summarizeFindingEvents(findingId: string, events: GovdispEvent[]): FindingStateDerivation {
  const openedEventIds: string[] = [];
  const ownedEventIds: string[] = [];
  const deliveredEventIds: string[] = [];
  const closedEventIds: string[] = [];
  const ownerRoles: string[] = [];
  for (const event of events) {
    if (event.event_class !== "FINDING" || event.finding_id !== findingId) continue;
    if (event.event_type === "FINDING_OPENED") openedEventIds.push(event.event_id);
    if (event.event_type === "FINDING_OWNED") {
      ownedEventIds.push(event.event_id);
      if (typeof event.owner_role === "string" && event.owner_role.trim() !== "") {
        ownerRoles.push(event.owner_role);
      }
    }
    if (event.event_type === "FINDING_DELIVERED") deliveredEventIds.push(event.event_id);
    if (event.event_type === "FINDING_CLOSED") closedEventIds.push(event.event_id);
  }
  const owned = ownedEventIds.length > 0;
  const delivered = deliveredEventIds.length > 0;
  const closed = closedEventIds.length > 0;
  const missingPrerequisites: FindingClosurePrerequisite[] = [];
  if (!owned) missingPrerequisites.push("FINDING_OWNED");
  if (!delivered) missingPrerequisites.push("FINDING_DELIVERED");
  return {
    finding_id: findingId,
    event_count: openedEventIds.length + ownedEventIds.length + deliveredEventIds.length + closedEventIds.length,
    opened: openedEventIds.length > 0,
    owned,
    delivered,
    closed,
    active: owned && delivered && !closed,
    owner_roles: ownerRoles,
    opened_event_ids: openedEventIds,
    owned_event_ids: ownedEventIds,
    delivered_event_ids: deliveredEventIds,
    closed_event_ids: closedEventIds,
    missing_prerequisites: missingPrerequisites
  };
}

/**
 * Derive the lifecycle state of one finding_id from the registry's FINDING
 * events for a scope.
 *
 * Pure and stateless: the state is recomputed from the registry on every
 * call; repeated derivation over the same log yields the identical state.
 * The derivation binds to the finding_id alone (a finding's lifecycle is its
 * own event stream, independent of every other finding in the scope).
 */
export function deriveFindingState(
  store: GovdispRegistryStoreLike,
  scope: string,
  findingId: string,
  base?: string
): DeriveFindingStateResult {
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };
  const findingFault = requireFindingId(findingId);
  if (findingFault) return { ok: false, rejections: [findingFault] };

  const queried = store.queryRegistryEvents(scope, { event_class: "FINDING" }, base);
  if (!queried.ok) return { ok: false, rejections: queried.rejections };
  return { ok: true, state: summarizeFindingEvents(findingId, queried.events) };
}

/**
 * Evaluate whether a FINDING_CLOSED may stand for one finding_id (registry
 * negative control #9, GD-DEC-005).
 *
 * The verdict is a pure derivation over the registry: a finding lacking a
 * FINDING_OWNED owner binding, a FINDING_DELIVERED delivery event, or both is
 * NOT ACTIVE, and its closure is REFUSED with a named finding_not_active
 * refusal citing exactly which prerequisite events are missing. Closing an
 * owned+delivered finding is permitted. The evaluator never appends anything;
 * repeated evaluation over the same log yields the identical verdict.
 */
export function evaluateFindingClosure(
  store: GovdispRegistryStoreLike,
  scope: string,
  findingId: string,
  base?: string
): EvaluateFindingClosureResult {
  const stateResult = deriveFindingState(store, scope, findingId, base);
  if (!stateResult.ok) return { ok: false, rejections: stateResult.rejections };
  const { state } = stateResult;

  if (state.missing_prerequisites.length === 0) {
    return { ok: true, permitted: true, finding_id: findingId, state };
  }

  return {
    ok: true,
    permitted: false,
    refusal: {
      name: FINDING_REFUSAL_NAME,
      field: "finding_id",
      event_class: "FINDING",
      code: FINDING_NOT_ACTIVE_CODE,
      detail: `finding "${findingId}" is not ACTIVE: GD-DEC-005 requires both a FINDING_OWNED owner binding and a FINDING_DELIVERED delivery event recorded in the registry before closure; missing prerequisite event(s): ${state.missing_prerequisites.join(", ")} — a logged finding must not masquerade as driven`,
      finding_id: findingId,
      missing_prerequisites: state.missing_prerequisites
    },
    state
  };
}

/**
 * The intervention-duty guard (GD-DEC-005): count the findings in a scope
 * that are ACTIVE — owner-bound (FINDING_OWNED) with a delivery event
 * (FINDING_DELIVERED) and not closed. Only active findings count toward ODIN
 * intervention duties; unowned, undelivered, and already-closed findings are
 * excluded and reported on the inactive list. Pure and stateless: findings
 * are grouped by finding_id in first-seen (append) order and each lifecycle
 * is recomputed from the registry's events on every call.
 */
export function countActiveFindings(
  store: GovdispRegistryStoreLike,
  scope: string,
  base?: string
): CountActiveFindingsResult {
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };

  const queried = store.queryRegistryEvents(scope, { event_class: "FINDING" }, base);
  if (!queried.ok) return { ok: false, rejections: queried.rejections };

  // Group by finding_id in first-seen (append) order — deterministic for a
  // given log content.
  const byFinding = new Map<string, GovdispEvent[]>();
  for (const event of queried.events) {
    if (event.event_class !== "FINDING") continue;
    const bucket = byFinding.get(event.finding_id) ?? [];
    bucket.push(event);
    byFinding.set(event.finding_id, bucket);
  }

  const activeFindingIds: string[] = [];
  const inactiveFindingIds: string[] = [];
  for (const [findingId, events] of byFinding) {
    const state = summarizeFindingEvents(findingId, events);
    if (state.active) activeFindingIds.push(findingId);
    else inactiveFindingIds.push(findingId);
  }

  return {
    ok: true,
    count: activeFindingIds.length,
    active_finding_ids: activeFindingIds,
    inactive_finding_ids: inactiveFindingIds
  };
}
