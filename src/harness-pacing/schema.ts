// Re-export pacing event types from the canonical schemas location.
// Do NOT redefine — task-001 owns these definitions.
export type { HarnessPacingEvent, PacingEventType } from "../protocol/schemas.js";

/**
 * A per-harness pacing profile built from accumulated HarnessPacingEvents.
 * Stored locally under .odin/harness-pacing/<harness_id>/profile.json.
 * Seed profiles live at src/harness-pacing/seeds/<harness_id>.json.
 */
export interface HarnessProfile {
  harness_id: string;
  version: string;
  last_updated: string;       // ISO-8601 UTC
  basis_note?: string;        // e.g., "provisional; seed data, n=1 session"
  samples_total: number;
  events: import("../protocol/schemas.js").HarnessPacingEvent[];
  crash_signatures: string[];  // SHA-256 hashes of known crash signatures
  recommended: PacingRecommendation;
}

/**
 * Conservative pacing recommendation derived from a HarnessProfile.
 * Crash samples force the smallest safe bucket and set mitigation notes.
 */
export interface PacingRecommendation {
  harness_id: string;
  max_word_bucket: string;                                          // e.g., "0-100 words"
  min_idle_wait_seconds: number;
  slash_command_bundling: "allowed" | "avoid" | "unknown";
  multi_phase_prompting: "allowed" | "avoid" | "unknown";
  notes: string;
}
