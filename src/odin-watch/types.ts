import type { WakeVerdict as ProtocolWakeVerdict } from "../protocol/schemas.js";

/** Existing public writer verdict contract. */
export type WakeVerdict = ProtocolWakeVerdict;

/** Artifact-aware finding discriminator kept distinct from WORKING. */
export type LivenessVerdict = "LIVENESS_MIMIC";

/** Signals captured outside the pure classifier. */
export interface LivenessSignals {
  artifact_advanced: boolean;
  recent_attempt_payload: boolean;
  runner_alive: boolean | null;
  observation_valid: boolean;
  diagnostic_reason_codes: string[];
}

/** Raw inputs used to build deterministic liveness signals. */
export interface LivenessSnapshotInput {
  previous_artifact_revision: string | null;
  current_artifact_revision: string | null;
  attempt_payload_mtimes_ms: readonly number[];
  now_ms: number;
  recent_payload_window_ms: number;
  runner_pgrep_output: string;
}

export interface RunnerPgrepParseResult {
  valid: boolean;
  alive: boolean;
  pid_count: number;
  reason_code?: string;
}
