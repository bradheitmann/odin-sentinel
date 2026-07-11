import { describe, expect, it } from "vitest";

import { classify, type ClassifierInput } from "../../src/odin-watch/classifier.js";
import {
  createLivenessSnapshot,
  MAX_PGREP_OUTPUT_BYTES,
  MAX_PGREP_PID_COUNT,
  parseRunnerPgrep,
  runnerAliveFromPgrep,
} from "../../src/odin-watch/snapshot.js";

function input(overrides: Partial<ClassifierInput> = {}): ClassifierInput {
  return {
    text: "quiet",
    hash: "same",
    prev_hash: "same",
    elapsed_ms: 60_001,
    now_ms: 100_000,
    mandatory_audit_interval_ms: 200_000,
    stale_threshold_ms: 60_000,
    write_scope: [],
    dirty_paths: [],
    last_verdict: null,
    last_mandatory_audit_ts: 99_000,
    ...overrides,
  };
}

describe("artifact-aware odin-watch liveness", () => {
  it("wakes on spinner-active liveness mimic with no artifact progress", () => {
    const result = classify(
      input({
        text: "⠋ Processing",
        liveness: {
          artifact_advanced: false,
          recent_attempt_payload: false,
          runner_alive: true,
          observation_valid: true,
          diagnostic_reason_codes: [],
        },
      })
    );

    expect(result).toMatchObject({
      verdict: "UNKNOWN_NEEDS_READ",
      liveness_verdict: "LIVENESS_MIMIC",
      wake: 1,
    });
    expect(result.reason_codes).toContain("LIVENESS_MIMIC");
  });

  it("does not call a quiet unchanged surface idle when its attempt payload is recent", () => {
    const result = classify(
      input({
        liveness: {
          artifact_advanced: false,
          recent_attempt_payload: true,
          runner_alive: false,
          observation_valid: true,
          diagnostic_reason_codes: [],
        },
      })
    );

    expect(result).toMatchObject({ verdict: "WORKING", wake: 0 });
    expect(result.reason_codes).toContain("RECENT_ATTEMPT_PAYLOAD");
  });

  it("treats artifact advancement as stronger evidence than an unchanged screen", () => {
    const result = classify(
      input({
        liveness: {
          artifact_advanced: true,
          recent_attempt_payload: false,
          runner_alive: true,
          observation_valid: true,
          diagnostic_reason_codes: [],
        },
      })
    );

    expect(result).toMatchObject({ verdict: "WORKING", wake: 0 });
    expect(result.reason_codes).toContain("ARTIFACT_ADVANCED");
  });

  it("builds signals from attempt payload times and pgrep output", () => {
    expect(
      createLivenessSnapshot({
        previous_artifact_revision: "r1",
        current_artifact_revision: "r2",
        attempt_payload_mtimes_ms: [99_500],
        now_ms: 100_000,
        recent_payload_window_ms: 1_000,
        runner_pgrep_output: "412\n",
      })
    ).toEqual({
      artifact_advanced: true,
      recent_attempt_payload: true,
      runner_alive: true,
      observation_valid: true,
      diagnostic_reason_codes: [],
    });
  });

  it("rejects non-pid pgrep output and future attempt payload timestamps", () => {
    expect(runnerAliveFromPgrep("runner unavailable")).toBe(false);
    expect(
      createLivenessSnapshot({
        previous_artifact_revision: "r1",
        current_artifact_revision: "r1",
        attempt_payload_mtimes_ms: [100_001],
        now_ms: 100_000,
        recent_payload_window_ms: 1_000,
        runner_pgrep_output: "",
      })
    ).toEqual({
      artifact_advanced: false,
      recent_attempt_payload: false,
      runner_alive: false,
      observation_valid: false,
      diagnostic_reason_codes: ["FRESHNESS_OBSERVATION_INVALID"],
    });
  });

  it("keeps stale idle behavior when no artifact liveness exists", () => {
    expect(
      classify(
        input({
          liveness: {
          artifact_advanced: false,
          recent_attempt_payload: false,
          runner_alive: false,
          observation_valid: true,
          diagnostic_reason_codes: [],
          },
        })
      )
    ).toMatchObject({ verdict: "IDLE", wake: 1 });
  });

  it("rejects numeric error prose instead of extracting an embedded PID", () => {
    expect(runnerAliveFromPgrep("error 123")).toBe(false);
    expect(parseRunnerPgrep("123\npermission denied")).toMatchObject({
      valid: false,
      alive: false,
      reason_code: "PGREP_OUTPUT_INVALID",
    });
    const liveness = createLivenessSnapshot({
      previous_artifact_revision: "r1",
      current_artifact_revision: "r2",
      attempt_payload_mtimes_ms: [99_500],
      now_ms: 100_000,
      recent_payload_window_ms: 1_000,
      runner_pgrep_output: "123\npermission denied",
    });
    expect(liveness).toMatchObject({
      runner_alive: null,
      observation_valid: false,
      diagnostic_reason_codes: ["PGREP_OUTPUT_INVALID"],
    });
    expect(classify(input({ liveness }))).toMatchObject({
      verdict: "UNKNOWN_NEEDS_READ",
      wake: 1,
      prompt_budget_class: "diagnostic",
    });
  });

  it("rejects oversized output and unbounded PID lists", () => {
    expect(parseRunnerPgrep("9".repeat(MAX_PGREP_OUTPUT_BYTES + 1))).toMatchObject({
      valid: false,
      reason_code: "PGREP_OUTPUT_TOO_LARGE",
    });
    expect(
      parseRunnerPgrep(Array.from({ length: MAX_PGREP_PID_COUNT + 1 }, (_, i) => String(i + 1)).join("\n"))
    ).toMatchObject({ valid: false, reason_code: "PGREP_PID_COUNT_EXCEEDED" });
  });

  it.each([
    { now_ms: Number.NaN, recent_payload_window_ms: 1_000 },
    { now_ms: -1, recent_payload_window_ms: 1_000 },
    { now_ms: 100_000, recent_payload_window_ms: Number.POSITIVE_INFINITY },
    { now_ms: 100_000, recent_payload_window_ms: -1 },
    {
      now_ms: 100_000,
      recent_payload_window_ms: 1_000,
      attempt_payload_mtimes_ms: [Number.NaN],
    },
    {
      now_ms: 100_000,
      recent_payload_window_ms: 1_000,
      attempt_payload_mtimes_ms: [-1],
    },
  ])("fails closed for invalid freshness values: %o", (freshness) => {
    const liveness = createLivenessSnapshot({
      previous_artifact_revision: "r1",
      current_artifact_revision: "r2",
      attempt_payload_mtimes_ms: [99_500],
      runner_pgrep_output: "412\n",
      ...freshness,
    });
    expect(liveness).toMatchObject({
      artifact_advanced: true,
      recent_attempt_payload: false,
      observation_valid: false,
    });
    expect(classify(input({ liveness }))).toMatchObject({
      verdict: "UNKNOWN_NEEDS_READ",
      wake: 1,
      prompt_budget_class: "diagnostic",
    });
  });

  it("does not let an unbounded window make an ancient payload look recent", () => {
    const invalid = createLivenessSnapshot({
      previous_artifact_revision: "r1",
      current_artifact_revision: "r1",
      attempt_payload_mtimes_ms: [1],
      now_ms: 100_000,
      recent_payload_window_ms: Number.POSITIVE_INFINITY,
      runner_pgrep_output: "",
    });
    expect(invalid).toMatchObject({
      recent_attempt_payload: false,
      observation_valid: false,
    });
    expect(classify(input({ liveness: invalid }))).toMatchObject({
      verdict: "UNKNOWN_NEEDS_READ",
      wake: 1,
    });

    const bounded = createLivenessSnapshot({
      previous_artifact_revision: "r1",
      current_artifact_revision: "r1",
      attempt_payload_mtimes_ms: [1],
      now_ms: 100_000,
      recent_payload_window_ms: 1_000,
      runner_pgrep_output: "",
    });
    expect(bounded).toMatchObject({
      recent_attempt_payload: false,
      observation_valid: true,
    });
  });

  it("rejects empty artifact revisions as advancement", () => {
    const liveness = createLivenessSnapshot({
      previous_artifact_revision: "r1",
      current_artifact_revision: "",
      attempt_payload_mtimes_ms: [],
      now_ms: 100_000,
      recent_payload_window_ms: 1_000,
      runner_pgrep_output: "412\n",
    });
    expect(liveness).toMatchObject({
      artifact_advanced: false,
      observation_valid: false,
      diagnostic_reason_codes: ["ARTIFACT_REVISION_INVALID"],
    });
    expect(classify(input({ liveness }))).toMatchObject({
      verdict: "UNKNOWN_NEEDS_READ",
      wake: 1,
    });
  });
});
