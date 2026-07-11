import { Buffer } from "node:buffer";

import type {
  LivenessSignals,
  LivenessSnapshotInput,
  RunnerPgrepParseResult,
} from "./types.js";

const PID_LINE_RE = /^[1-9]\d*$/;
const MAX_PID = 2_147_483_647;

/** Strict runner-probe limits; larger output is diagnostic, never liveness. */
export const MAX_PGREP_OUTPUT_BYTES = 4_096;
export const MAX_PGREP_PID_COUNT = 256;

/** Freshness observations are bounded to JavaScript Date range and one day. */
export const MAX_FRESHNESS_TIMESTAMP_MS = 8_640_000_000_000_000;
export const MAX_FRESHNESS_WINDOW_MS = 86_400_000;
export const MAX_ARTIFACT_REVISION_LENGTH = 256;

export function parseRunnerPgrep(output: string): RunnerPgrepParseResult {
  if (Buffer.byteLength(output, "utf8") > MAX_PGREP_OUTPUT_BYTES) {
    return {
      valid: false,
      alive: false,
      pid_count: 0,
      reason_code: "PGREP_OUTPUT_TOO_LARGE",
    };
  }

  if (output === "") {
    return { valid: true, alive: false, pid_count: 0 };
  }

  if (output.endsWith("\n")) output = output.slice(0, -1);
  const lines = output.split("\n");
  if (lines.length > MAX_PGREP_PID_COUNT) {
    return {
      valid: false,
      alive: false,
      pid_count: 0,
      reason_code: "PGREP_PID_COUNT_EXCEEDED",
    };
  }

  if (
    lines.some((line) => {
      if (!PID_LINE_RE.test(line)) return true;
      const pid = Number(line);
      return !Number.isSafeInteger(pid) || pid > MAX_PID;
    })
  ) {
    return {
      valid: false,
      alive: false,
      pid_count: 0,
      reason_code: "PGREP_OUTPUT_INVALID",
    };
  }

  return { valid: true, alive: lines.length > 0, pid_count: lines.length };
}

/** Accept only a complete normalized LF-separated positive PID list. */
export function runnerAliveFromPgrep(output: string): boolean {
  const parsed = parseRunnerPgrep(output);
  return parsed.valid && parsed.alive;
}

function validTimestamp(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_FRESHNESS_TIMESTAMP_MS
  );
}

function validWindow(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_FRESHNESS_WINDOW_MS;
}

function validRevision(value: string | null): boolean {
  return (
    value === null ||
    (value.length > 0 &&
      value.length <= MAX_ARTIFACT_REVISION_LENGTH &&
      value.trim() === value)
  );
}

/** Convert artifact, attempt-directory, and pgrep observations into classifier input. */
export function createLivenessSnapshot(
  input: LivenessSnapshotInput
): LivenessSignals {
  const diagnostics: string[] = [];
  const pgrep = parseRunnerPgrep(input.runner_pgrep_output);
  if (!pgrep.valid) diagnostics.push(pgrep.reason_code ?? "PGREP_OUTPUT_INVALID");

  const timestampsValid =
    validTimestamp(input.now_ms) &&
    validWindow(input.recent_payload_window_ms) &&
    input.attempt_payload_mtimes_ms.every(
      (mtime) => validTimestamp(mtime) && mtime <= input.now_ms
    );
  if (!timestampsValid) diagnostics.push("FRESHNESS_OBSERVATION_INVALID");

  const revisionsValid =
    validRevision(input.previous_artifact_revision) &&
    validRevision(input.current_artifact_revision);
  if (!revisionsValid) diagnostics.push("ARTIFACT_REVISION_INVALID");

  const artifact_advanced =
    revisionsValid &&
    input.current_artifact_revision !== null &&
    input.current_artifact_revision !== input.previous_artifact_revision;
  const recent_attempt_payload =
    timestampsValid &&
    input.attempt_payload_mtimes_ms.some(
      (mtime) => input.now_ms - mtime <= input.recent_payload_window_ms
    );

  return {
    artifact_advanced,
    recent_attempt_payload,
    runner_alive: pgrep.valid ? pgrep.alive : null,
    observation_valid: diagnostics.length === 0,
    diagnostic_reason_codes: diagnostics,
  };
}
