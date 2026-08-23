/**
 * EPIC-052 Wave-0: typed event union and stable_objective_id.
 *
 * Types and const enumerations only. No storage, no evaluators, no MCP wiring.
 * Wave-1 clones the harness-pacing fail-closed choke-point pattern against these
 * shapes. Events are metadata-only: do not add prompt or raw-proof body fields.
 */

export const GOVDISP_EVENT_SCHEMA_VERSION = "govdisp.event.v1" as const;
export type GovdispEventSchemaVersion = typeof GOVDISP_EVENT_SCHEMA_VERSION;

/** Immutable objective key. Survives reset, restaff, rename, cure, and rerun. */
export type StableObjectiveId = string;

export const ATTEMPT_EVENT_TYPES = [
  "ATTEMPT_STARTED",
  "ATTEMPT_COUNTED",
  "ATTEMPT_REFUSED"
] as const;
export type AttemptEventType = (typeof ATTEMPT_EVENT_TYPES)[number];

export const FINDING_EVENT_TYPES = [
  "FINDING_OPENED",
  "FINDING_OWNED",
  "FINDING_DELIVERED",
  "FINDING_CLOSED"
] as const;
export type FindingEventType = (typeof FINDING_EVENT_TYPES)[number];

export const BREAK_GLASS_EVENT_TYPES = [
  "BREAK_GLASS_RECORDED"
] as const;
export type BreakGlassEventType = (typeof BREAK_GLASS_EVENT_TYPES)[number];

export const BUDGET_EVENT_TYPES = [
  "BUDGET_CROSSED",
  "BUDGET_EXHAUSTED"
] as const;
export type BudgetEventType = (typeof BUDGET_EVENT_TYPES)[number];

export const TERMINAL_EVENT_TYPES = [
  "TERMINAL_BLOCKED",
  "TERMINAL_COMPLETED"
] as const;
export type TerminalEventType = (typeof TERMINAL_EVENT_TYPES)[number];

export const AUDIT_EVENT_TYPES = [
  "AUDIT_OPENED",
  "AUDIT_COMPLETED"
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const GOVDISP_EVENT_CLASSES = [
  "ATTEMPT",
  "FINDING",
  "BREAK_GLASS",
  "BUDGET",
  "TERMINAL",
  "AUDIT"
] as const;
export type GovdispEventClass = (typeof GOVDISP_EVENT_CLASSES)[number];

export const BUDGET_KINDS = ["tokens", "time", "artifacts", "roles"] as const;
export type BudgetKind = (typeof BUDGET_KINDS)[number];

export const ATTEMPT_TRIGGERS = [
  "start",
  "reset",
  "restaff",
  "rename",
  "cure",
  "rerun"
] as const;
export type AttemptTrigger = (typeof ATTEMPT_TRIGGERS)[number];

export type GovdispEventType =
  | AttemptEventType
  | FindingEventType
  | BreakGlassEventType
  | BudgetEventType
  | TerminalEventType
  | AuditEventType;

export interface ContentHash {
  path: string;
  sha256: string;
}

export interface GovdispEventBase {
  schema_version: GovdispEventSchemaVersion;
  event_id: string;
  ts: string;
  stable_objective_id: StableObjectiveId;
  actor_role?: string;
}

export interface AttemptEvent extends GovdispEventBase {
  event_class: "ATTEMPT";
  event_type: AttemptEventType;
  attempt_index?: number;
  trigger?: AttemptTrigger;
}

export interface FindingEvent extends GovdispEventBase {
  event_class: "FINDING";
  event_type: FindingEventType;
  finding_id: string;
  owner_role?: string;
}

/** Break-glass requires a named human authorizer and a contradiction reference. */
export interface BreakGlassEvent extends GovdispEventBase {
  event_class: "BREAK_GLASS";
  event_type: BreakGlassEventType;
  authorizing_human: string;
  contradiction_ref: string;
}

export interface BudgetEvent extends GovdispEventBase {
  event_class: "BUDGET";
  event_type: BudgetEventType;
  budget_kind: BudgetKind;
}

/** Terminal events persist content hashes rather than raw proof bodies. */
export interface TerminalEvent extends GovdispEventBase {
  event_class: "TERMINAL";
  event_type: TerminalEventType;
  content_hashes: ContentHash[];
}

export interface OrdinaryWorkAuditTarget {
  kind: "ordinary_work";
}

export interface AuditAuditTarget {
  kind: "audit";
  target_event_id: string;
}

/** An audit's schema-validated subject: ordinary work, or another audit event. */
export type AuditTarget = OrdinaryWorkAuditTarget | AuditAuditTarget;

export interface AuditEvent extends GovdispEventBase {
  event_class: "AUDIT";
  event_type: AuditEventType;
  target: AuditTarget;
}

export type GovdispEvent =
  | AttemptEvent
  | FindingEvent
  | BreakGlassEvent
  | BudgetEvent
  | TerminalEvent
  | AuditEvent;
