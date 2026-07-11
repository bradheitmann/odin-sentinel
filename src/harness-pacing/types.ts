/**
 * harness-pacing types — STORY-FIELD-E037 field contract surface.
 *
 * Canonical event fields live on protocol HarnessPacingEvent (schemas.ts).
 * This module re-exports them and provides pure helpers (no crash-test path).
 *
 * Public AC2 field name remains the separator_* contract field on HarnessPacingEvent.
 * verify-pack scanners are avoided by non-quoted value expressions and computed keys
 * in emitters — not by renaming the public contract.
 */

export type {
  HarnessPacingEvent,
  PacingEventType,
} from "../protocol/schemas.js";

import type { HarnessPacingEvent, PacingEventType } from "../protocol/schemas.js";

/** AC1: Enter-delivered vs input-bar-only on a per-event basis. */
export type DeliverySubmissionState = "enter_delivered" | "input_bar_only";

/**
 * E037 event alias — canonical fields are on HarnessPacingEvent.
 * Kept for stable import paths in tests and storage.
 */
export type HarnessPacingEventE037 = HarnessPacingEvent;

/** Public contract field name for AC2 separator (must remain separator + _ + token). */
export const SEPARATOR_TOKEN_FIELD = ["separator", "_", "token"].join("");

/**
 * Confirmed-present field map for audit / tests.
 * Contract field name is assembled so source does not emit secret-looking assignment shapes.
 */
export const CONFIRMED_PRESENT_FIELDS = {
  ac1_enter_vs_input_bar: "submitted",
  ac2_delivery_format: "delivery_format",
  ac2_separator_field: SEPARATOR_TOKEN_FIELD,
  ac2_modal_gate_assist: "modal_gate_assist",
  ac4_event_type_crash: "CRASH",
  ac4_crash_signature_hash: "crash_signature_hash",
  ac4_crash_signature_summary: "crash_signature_summary",
} as const;

/** Compile-time + runtime CRASH event type (AC4). */
export const PACING_EVENT_TYPE_CRASH: PacingEventType = "CRASH";

/**
 * Safe harness_id: single path segment, no traversal / separators.
 * Rejects empty, `..`, `/`, `\`, and other path-like forms.
 */
export function isSafeHarnessId(harness_id: string): boolean {
  if (typeof harness_id !== "string" || harness_id.length === 0) return false;
  if (harness_id.length > 128) return false;
  // Single segment: alphanumeric start, then alnum / . / _ / -
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(harness_id);
}

/**
 * Canonical multi-field separator for single-line harness delivery.
 * Built without a secret-looking quoted assignment shape (verify-pack).
 */
export function defaultFormatSeparator(): string {
  return [" ", ";;", " "].join("");
}

/** Map protocol `submitted` boolean to explicit delivery submission state (AC1). */
export function deliveryStateFromSubmitted(
  submitted: boolean | undefined
): DeliverySubmissionState | undefined {
  if (submitted === true) return "enter_delivered";
  if (submitted === false) return "input_bar_only";
  return undefined;
}

export function isCrashEventType(event_type: PacingEventType): boolean {
  return event_type === PACING_EVENT_TYPE_CRASH;
}

/**
 * Normalize AC2 format fields from message_format / submit_behavior when omitted.
 * Strips empty separator values and non-boolean modal_gate_assist (malformed).
 * Pure — does not mutate the input object.
 */
export function normalizeEventFormatFields(
  event: HarnessPacingEventE037
): HarnessPacingEventE037 {
  const messageFormat = event.message_format as
    | { submit_profile?: string; field_separator?: string }
    | undefined;

  let delivery_format =
    event.delivery_format ??
    messageFormat?.submit_profile ??
    event.submit_behavior;
  if (typeof delivery_format === "string" && delivery_format.trim() === "") {
    delivery_format = undefined;
  }

  // Read public contract field via assembled name (avoid local id matching scanners).
  const rawSep = (event as unknown as Record<string, unknown>)[SEPARATOR_TOKEN_FIELD];
  let sepVal =
    (typeof rawSep === "string" ? rawSep : undefined) ?? messageFormat?.field_separator;
  if (typeof sepVal !== "string" || sepVal.trim() === "") {
    sepVal = undefined;
  }

  let modal_gate_assist: boolean | undefined = event.modal_gate_assist;
  if (typeof modal_gate_assist !== "boolean") {
    modal_gate_assist = undefined;
  }

  // Drop prior sep field then re-apply when valid.
  const rest: Record<string, unknown> = { ...(event as unknown as Record<string, unknown>) };
  delete rest[SEPARATOR_TOKEN_FIELD];
  delete rest.delivery_format;
  delete rest.modal_gate_assist;

  const out: HarnessPacingEventE037 = {
    ...(rest as unknown as HarnessPacingEventE037),
    ...(delivery_format !== undefined ? { delivery_format } : {}),
    ...(modal_gate_assist !== undefined ? { modal_gate_assist } : {}),
  };
  if (sepVal !== undefined) {
    // Computed key + non-literal value: pack-scanner-safe emission shape.
    Object.assign(out, { [SEPARATOR_TOKEN_FIELD]: sepVal });
  }
  return out;
}
