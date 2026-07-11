/**
 * Storage layer for harness pacing profiles and events.
 *
 * Runtime profile directory: .odin/harness-pacing/<harness_id>/profile.json
 * Events store METADATA ONLY — prompt_text_stored: false at all times.
 *
 * Fail-closed architecture: ONE validation choke point for full
 * HarnessPacingEvent and HarnessProfile shapes must succeed before any
 * mkdir or write. Parse → validate → single reject path; no partial patches.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { HarnessProfile } from "./schema.js";
import type { HarnessPacingEventE037 } from "./types.js";
import { isSafeHarnessId, normalizeEventFormatFields } from "./types.js";

/** Default runtime profile base — kept outside audit-reserved local state paths. */
export const LOCAL_PROFILE_BASE = ".odin/harness-pacing";

/** Canonical PacingEventType enum (protocol/schemas). */
export const PACING_EVENT_TYPES = [
  "PROMPT_DELIVERY",
  "IDLE_WAIT",
  "MODAL_BLOCK",
  "PERMISSION_BLOCK",
  "CRASH",
  "RECOVERY",
  "MILESTONE",
] as const;

const PACING_EVENT_TYPE_SET = new Set<string>(PACING_EVENT_TYPES);
const BUNDLING = new Set(["allowed", "avoid", "unknown"]);
const SUBMIT_PROFILES = new Set(["single_line_flatten", "double_enter", "single_enter_verify"]);
const NEWLINE_POLICIES = new Set(["flatten_to_space", "preserve"]);

/**
 * Absolute path to the profile JSON for a given harness_id.
 * Unsafe / traversal harness_id values throw (reject, do not join).
 */
export function getProfilePath(harness_id: string, base = LOCAL_PROFILE_BASE): string {
  if (!isSafeHarnessId(harness_id)) {
    throw new Error(`unsafe harness_id rejected: ${JSON.stringify(harness_id)}`);
  }
  return join(base, harness_id, "profile.json");
}

/**
 * Build the initial empty profile for a harness_id.
 * Exported for testability — callers that need a blank slate can use this
 * rather than re-constructing the default shape by hand.
 */
export function buildDefaultProfile(harness_id: string): HarnessProfile {
  if (!isSafeHarnessId(harness_id)) {
    throw new Error(`unsafe harness_id rejected: ${JSON.stringify(harness_id)}`);
  }
  return {
    harness_id,
    version: "1.0",
    last_updated: new Date().toISOString(),
    samples_total: 0,
    events: [],
    crash_signatures: [],
    recommended: {
      harness_id,
      max_word_bucket: "0-100 words",
      min_idle_wait_seconds: 3,
      slash_command_bundling: "unknown",
      multi_phase_prompting: "unknown",
      notes: "No data yet — using conservative defaults",
    },
  };
}

function isNonNegFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function isNonNegInteger(n: unknown): n is number {
  return isNonNegFiniteNumber(n) && Number.isInteger(n);
}

function isOptionalString(v: unknown): boolean {
  return v === undefined || typeof v === "string";
}

function isOptionalBoolean(v: unknown): boolean {
  return v === undefined || typeof v === "boolean";
}

/** Full QaTimeoutPolicy validation when present. Pure — never throws. */
function isValidQaTimeoutPolicy(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const timeout = value as Record<string, unknown>;
  if (!isNonNegFiniteNumber(timeout.base_seconds)) return false;
  if (!isNonNegFiniteNumber(timeout.per_file_seconds)) return false;
  if (!isNonNegFiniteNumber(timeout.max_seconds)) return false;
  if (timeout.max_seconds < timeout.base_seconds) return false;
  return true;
}

/**
 * Full HarnessMessageFormat validation when present.
 * Pure — never throws.
 */
export function isValidMessageFormat(
  value: unknown,
  expectedHarnessId: string
): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const m = value as Record<string, unknown>;
  if (typeof m.harness_id !== "string" || m.harness_id !== expectedHarnessId) return false;
  if (typeof m.submit_profile !== "string" || !SUBMIT_PROFILES.has(m.submit_profile)) return false;
  if (typeof m.newline_policy !== "string" || !NEWLINE_POLICIES.has(m.newline_policy)) return false;
  if (typeof m.multi_line_ok !== "boolean") return false;
  if ("field_separator" in m && m.field_separator !== undefined) {
    if (typeof m.field_separator !== "string" || m.field_separator.trim() === "") return false;
  }
  if ("second_enter_on_busy" in m && !isOptionalBoolean(m.second_enter_on_busy)) return false;
  if ("notes" in m && !isOptionalString(m.notes)) return false;
  return true;
}

/**
 * Validate one pacing event object (incoming or persisted).
 * Complete shape: required fields, all optional field types, enums, identity.
 * Pure — never throws.
 */
export function isValidPacingEvent(
  value: unknown,
  expectedHarnessId?: string
): value is HarnessPacingEventE037 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const e = value as Record<string, unknown>;
  if (typeof e.harness_id !== "string" || e.harness_id.length === 0) return false;
  if (!isSafeHarnessId(e.harness_id)) return false;
  if (expectedHarnessId !== undefined && e.harness_id !== expectedHarnessId) return false;
  if (typeof e.event_type !== "string" || !PACING_EVENT_TYPE_SET.has(e.event_type)) return false;
  if (typeof e.ts !== "string" || e.ts.length === 0) return false;

  if ("duration_ms" in e && e.duration_ms !== undefined && !isNonNegFiniteNumber(e.duration_ms)) {
    return false;
  }
  if ("payload_bytes" in e && e.payload_bytes !== undefined && !isNonNegFiniteNumber(e.payload_bytes)) {
    return false;
  }
  if ("verdict" in e && !isOptionalString(e.verdict)) return false;
  if ("notes" in e && !isOptionalString(e.notes)) return false;
  if ("crash_signature_hash" in e && !isOptionalString(e.crash_signature_hash)) return false;
  if ("crash_signature_summary" in e && !isOptionalString(e.crash_signature_summary)) return false;
  if ("recovery_action" in e && !isOptionalString(e.recovery_action)) return false;
  if ("submitted" in e && e.submitted !== undefined && typeof e.submitted !== "boolean") return false;
  if ("submit_behavior" in e && !isOptionalString(e.submit_behavior)) return false;
  if ("delivery_format" in e && !isOptionalString(e.delivery_format)) return false;
  if ("separator_token" in e && e.separator_token !== undefined) {
    if (typeof e.separator_token !== "string" || e.separator_token.trim() === "") return false;
  }
  if ("modal_gate_assist" in e && e.modal_gate_assist !== undefined && typeof e.modal_gate_assist !== "boolean") {
    return false;
  }
  if ("message_format" in e && e.message_format !== undefined) {
    if (!isValidMessageFormat(e.message_format, e.harness_id)) return false;
  }
  return true;
}

/**
 * Validate a complete persisted HarnessProfile for a requested harness_id.
 * Pure — never throws.
 */
export function isValidHarnessProfile(
  value: unknown,
  expectedHarnessId: string
): value is HarnessProfile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const p = value as Record<string, unknown>;
  if (typeof p.harness_id !== "string" || p.harness_id.length === 0) return false;
  if (p.harness_id !== expectedHarnessId) return false;
  if (typeof p.version !== "string") return false;
  if (typeof p.last_updated !== "string") return false;
  if (!isNonNegInteger(p.samples_total)) return false;
  if (!Array.isArray(p.events)) return false;
  if (p.samples_total !== p.events.length) return false;
  if (!Array.isArray(p.crash_signatures)) return false;
  for (const sig of p.crash_signatures) {
    if (typeof sig !== "string") return false;
  }
  for (const ev of p.events) {
    if (!isValidPacingEvent(ev, expectedHarnessId)) return false;
  }
  if (p.recommended === null || typeof p.recommended !== "object" || Array.isArray(p.recommended)) {
    return false;
  }
  const rec = p.recommended as Record<string, unknown>;
  if (typeof rec.harness_id !== "string" || rec.harness_id !== expectedHarnessId) return false;
  if (typeof rec.max_word_bucket !== "string") return false;
  if (typeof rec.min_idle_wait_seconds !== "number" || !Number.isFinite(rec.min_idle_wait_seconds)) {
    return false;
  }
  if (rec.min_idle_wait_seconds < 0) return false;
  if (typeof rec.slash_command_bundling !== "string" || !BUNDLING.has(rec.slash_command_bundling)) {
    return false;
  }
  if (typeof rec.multi_phase_prompting !== "string" || !BUNDLING.has(rec.multi_phase_prompting)) {
    return false;
  }
  if (typeof rec.notes !== "string") return false;
  if ("submit_profile" in rec && rec.submit_profile !== undefined) {
    if (typeof rec.submit_profile !== "string" || !SUBMIT_PROFILES.has(rec.submit_profile)) return false;
  }
  if ("newline_policy" in rec && rec.newline_policy !== undefined) {
    if (typeof rec.newline_policy !== "string" || !NEWLINE_POLICIES.has(rec.newline_policy)) return false;
  }
  if ("qa_timeout" in rec && rec.qa_timeout !== undefined) {
    if (!isValidQaTimeoutPolicy(rec.qa_timeout)) return false;
  }
  if ("basis_note" in p && !isOptionalString(p.basis_note)) return false;
  if ("message_format" in p && p.message_format !== undefined) {
    if (!isValidMessageFormat(p.message_format, expectedHarnessId)) return false;
  }
  return true;
}

/**
 * Read the local runtime profile for harness_id.
 * Returns null when no profile exists, harness_id is unsafe, JSON is invalid,
 * or the profile shape/identity is malformed (never throws).
 */
export function readProfile(
  harness_id: string,
  base = LOCAL_PROFILE_BASE,
  fsRead: typeof readFileSync = readFileSync,
  fsExists: typeof existsSync = existsSync
): HarnessProfile | null {
  if (!isSafeHarnessId(harness_id)) return null;
  const path = getProfilePath(harness_id, base);
  if (!fsExists(path)) return null;
  try {
    const parsed: unknown = JSON.parse(fsRead(path, "utf8") as string);
    if (!isValidHarnessProfile(parsed, harness_id)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Append a pacing event to the local runtime profile for the event's harness_id.
 *
 * Choke point (must all pass before ANY mkdir/write):
 *  1. Validate complete incoming event
 *  2. Load+validate persisted profile if present (else build default in memory)
 *  3. Normalize event format fields
 *  4. Re-validate post-normalization event
 * Only then: mkdir + write.
 */
export function appendEvent(
  event: HarnessPacingEventE037,
  base = LOCAL_PROFILE_BASE,
  fsRead: typeof readFileSync = readFileSync,
  fsExists: typeof existsSync = existsSync,
  fsWrite: typeof writeFileSync = writeFileSync,
  fsMkdir: typeof mkdirSync = mkdirSync
): void {
  // --- pure validation choke point (no side effects) ---
  if (!isValidPacingEvent(event)) {
    return;
  }
  if (!isSafeHarnessId(event.harness_id)) {
    return;
  }

  const path = getProfilePath(event.harness_id, base);
  const filePresent = fsExists(path);

  let existing: HarnessProfile;
  if (filePresent) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fsRead(path, "utf8") as string);
    } catch {
      return;
    }
    if (!isValidHarnessProfile(parsed, event.harness_id)) {
      return;
    }
    existing = parsed;
  } else {
    existing = buildDefaultProfile(event.harness_id);
  }

  const stored = normalizeEventFormatFields(event);
  if (!isValidPacingEvent(stored, event.harness_id)) {
    return;
  }

  const crashSignatures = [...existing.crash_signatures];
  if (
    stored.crash_signature_hash &&
    !crashSignatures.includes(stored.crash_signature_hash)
  ) {
    crashSignatures.push(stored.crash_signature_hash);
  }

  const nextProfile: HarnessProfile = {
    ...existing,
    last_updated: new Date().toISOString(),
    samples_total: existing.events.length + 1,
    events: [...existing.events, stored],
    crash_signatures: crashSignatures,
  };
  if (!isValidHarnessProfile(nextProfile, event.harness_id)) {
    return;
  }

  // --- mutations only after full incoming, persisted, and next-profile validation ---
  const dir = join(base, event.harness_id);
  fsMkdir(dir, { recursive: true });
  fsWrite(path, JSON.stringify(nextProfile, null, 2), "utf8");
}
