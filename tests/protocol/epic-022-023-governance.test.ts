import { describe, expect, it } from "vitest";
import { validateClosureIndependence, validateCommitGate } from "../../src/protocol/index.js";

// EPIC-022 — active QA closure-independence detection.
// Field origin: RFC-v2.3 sweep §3.1 (TEAM PM asserted QA=QA_PASS while the QA
// seat never emitted a verdict) + fail-state ledger #13/#14 (slice legs all
// green while sealed holdouts failed 2 of 3).

function claim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_ref: "SLICE-42",
    implementer_lane: "B/DEV-1",
    closing_authority: "B/TEAM-PM",
    verdicts: [{ verdict_kind: "HOLDOUT_ACCEPTED", result: "PASS", emitted_by: "B/HLDT-1" }],
    ...overrides
  };
}

describe("validateClosureIndependence", () => {
  it("accepts an independent HOLDOUT_ACCEPTED pass", () => {
    expect(validateClosureIndependence(claim()).valid).toBe(true);
  });

  it("rejects closure with NO verdict (the fragmented-QA-seat case)", () => {
    const result = validateClosureIndependence(claim({ verdicts: [] }));
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/no verdict/i);
  });

  it("rejects a verdict SELF-ASSERTED by the closing authority (PM says QA_PASS)", () => {
    const result = validateClosureIndependence(
      claim({ verdicts: [{ verdict_kind: "HOLDOUT_ACCEPTED", result: "PASS", emitted_by: "B/TEAM-PM" }] })
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/SELF-ASSERTED/);
  });

  it("rejects a verdict emitted by the implementer's own lane", () => {
    const result = validateClosureIndependence(
      claim({ verdicts: [{ verdict_kind: "HOLDOUT_ACCEPTED", result: "PASS", emitted_by: "B/DEV-1" }] })
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/own lane/i);
  });

  it("rejects SLICE_QA_PASS as the only evidence (weak signal, not closure-eligible)", () => {
    const result = validateClosureIndependence(
      claim({ verdicts: [{ verdict_kind: "SLICE_QA_PASS", result: "PASS", emitted_by: "B/QA-1" }] })
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/DEV_COMPLETE_QA_PENDING/);
  });

  it("rejects a Mission-internal validator as the only closure basis (advisory)", () => {
    const result = validateClosureIndependence(
      claim({ verdicts: [{ verdict_kind: "MISSION_INTERNAL_VALIDATOR", result: "PASS", emitted_by: "mission/validator" }] })
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/advisory/i);
  });

  it("accepts slice-QA + independent holdout together, still flagging the advisory validator", () => {
    const result = validateClosureIndependence(
      claim({
        verdicts: [
          { verdict_kind: "SLICE_QA_PASS", result: "PASS", emitted_by: "B/QA-1" },
          { verdict_kind: "HOLDOUT_ACCEPTED", result: "PASS", emitted_by: "B/HLDT-1" },
          { verdict_kind: "MISSION_INTERNAL_VALIDATOR", result: "PASS", emitted_by: "mission/validator" }
        ]
      })
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/advisory/i);
  });
});

// EPIC-023 — exec-gated commit mode. Field origin: RFC-v2.3 sweep §6.

function gate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_ref: "repo-7 hook sync",
    pod_pm_lane: "B/TEAM-PM",
    implementer_lane: "B/DEV-1",
    staged_ready: true,
    commit_authorization: {
      token: "COMMIT-AUTHORIZED-7f3a",
      issued_by: "A/EXEC-ODIN",
      verified_ground_truth: true
    },
    committed: true,
    exec_reverified: true,
    ...overrides
  };
}

describe("validateCommitGate", () => {
  it("accepts the full valid sequence including post-commit EXEC re-verify", () => {
    expect(validateCommitGate(gate()).valid).toBe(true);
  });

  it("rejects a commit with no authorization token", () => {
    const g = gate();
    delete g.commit_authorization;
    const result = validateCommitGate(g);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("commit_authorization");
  });

  it("rejects an empty token", () => {
    const result = validateCommitGate(
      gate({ commit_authorization: { token: "", issued_by: "A/EXEC-ODIN", verified_ground_truth: true } })
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a SELF-ISSUED token (PM authorizing its own pod's commit)", () => {
    const result = validateCommitGate(
      gate({
        pod_pm_lane: "B/TEAM-PM-EXECUTOR",
        commit_authorization: { token: "t", issued_by: "B/TEAM-PM-EXECUTOR", verified_ground_truth: true }
      })
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/SELF-ISSUED/);
  });

  it("rejects a non-EXEC issuer", () => {
    const result = validateCommitGate(
      gate({ commit_authorization: { token: "t", issued_by: "B/QA-1", verified_ground_truth: true } })
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/EXEC-layer/);
  });

  it("rejects a token issued without independent ground-truth verification", () => {
    const result = validateCommitGate(
      gate({ commit_authorization: { token: "t", issued_by: "A/EXEC-ODIN", verified_ground_truth: false } })
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a landed commit that the EXEC never re-verified", () => {
    const result = validateCommitGate(gate({ committed: true, exec_reverified: false }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("exec_reverified");
  });

  it("accepts an authorization-stage record where the commit has not happened yet", () => {
    const result = validateCommitGate(gate({ committed: false, exec_reverified: false }));
    expect(result.valid).toBe(true);
  });
});
