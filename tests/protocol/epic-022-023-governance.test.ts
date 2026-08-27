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
  it("rejects HOLDOUT_ACCEPTED alone (holdout is not a substitute for slice QA)", () => {
    const result = validateClosureIndependence(claim());
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/B\/QA PENDING|QA_INCOMPLETE/i);
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

  it("rejects SLICE_QA_PASS alone (weak signal, not closure-eligible; HOLDOUT PENDING)", () => {
    const result = validateClosureIndependence(
      claim({ verdicts: [{ verdict_kind: "SLICE_QA_PASS", result: "PASS", emitted_by: "B/QA-1" }] })
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/HOLDOUT PENDING|DEV_COMPLETE_QA_PENDING/i);
  });

  it("rejects a Mission-internal validator as the only closure basis (advisory)", () => {
    const result = validateClosureIndependence(
      claim({ verdicts: [{ verdict_kind: "MISSION_INTERNAL_VALIDATOR", result: "PASS", emitted_by: "mission/validator" }] })
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/advisory/i);
  });

  it("accepts BOTH independent SLICE_QA_PASS and independent HOLDOUT_ACCEPTED together", () => {
    const result = validateClosureIndependence(
      claim({
        verdicts: [
          { verdict_kind: "SLICE_QA_PASS", result: "PASS", emitted_by: "B/QA-1" },
          { verdict_kind: "HOLDOUT_ACCEPTED", result: "PASS", emitted_by: "B/HLDT-1" }
        ]
      })
    );
    expect(result.valid).toBe(true);
  });

  it("rejects both-lane verdicts when the holdout is emitted by the implementer", () => {
    const result = validateClosureIndependence(
      claim({
        verdicts: [
          { verdict_kind: "SLICE_QA_PASS", result: "PASS", emitted_by: "B/QA-1" },
          { verdict_kind: "HOLDOUT_ACCEPTED", result: "PASS", emitted_by: "B/DEV-1" }
        ]
      })
    );
    expect(result.valid).toBe(false);
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

// STORY-GOVTRUTH-R2 — closure independence by canonical identity.
//
// The evidence-class choke point (EPIC-053) fires BEFORE any identity logic, so
// a probe carrying a non-canonical evidence_class is rejected on that ground and
// the validator merely looks strict. Every probe below therefore supplies a
// canonical evidence_class + source_binding and result: "PASS", which is what it
// takes to reach the identity path at all.

function typed(verdict: Record<string, unknown>): Record<string, unknown> {
  return {
    result: "PASS",
    evidence_class: "observed",
    source_binding: ".edge-agentic/local/evidence/SLICE-42/verify.log",
    ...verdict
  };
}

/** A closure with one seat per verification lane; overrides respell the seats. */
function lanes(sliceQaEmitter: unknown, holdoutEmitter: unknown): Record<string, unknown> {
  return claim({
    verdicts: [
      typed({ verdict_kind: "SLICE_QA_PASS", emitted_by: sliceQaEmitter }),
      typed({ verdict_kind: "HOLDOUT_ACCEPTED", emitted_by: holdoutEmitter })
    ]
  });
}

describe("validateClosureIndependence — canonical emitter identity", () => {
  it("accepts a genuinely independent closure (two distinct non-party seats)", () => {
    const result = validateClosureIndependence(lanes("B/QA-1", "B/HLDT-1"));
    expect(result.valid).toBe(true);
    expect(result.warnings.join("\n")).not.toMatch(/CLOSURE_|EMITTER_IDENTITY_INVALID/);
  });

  it.each(["b/dev_1", "b/dev-1", "B/DEV-1 ", " B/Dev 1", "B/DEV‑1"])(
    "rejects alias-equivalent self-review by the implementer spelled %j",
    (alias) => {
      const result = validateClosureIndependence(lanes("B/QA-1", alias));
      expect(result.valid).toBe(false);
      expect(result.invalid).toContain("verdicts");
      const warnings = result.warnings.join("\n");
      expect(warnings).toContain("CLOSURE_SELF_REVIEW");
      expect(warnings).toContain("B/DEV-1");
    }
  );

  it.each(["b/team_pm", "B/TEAM-PM ", "b/Team-Pm"])(
    "rejects alias-equivalent self-assertion by the closing authority spelled %j",
    (alias) => {
      const result = validateClosureIndependence(lanes("B/QA-1", alias));
      expect(result.valid).toBe(false);
      expect(result.warnings.join("\n")).toContain("CLOSURE_SELF_ASSERTION");
    }
  );

  it("rejects both verdicts closer-asserted under different spellings", () => {
    const result = validateClosureIndependence(lanes("b/team_pm", "B/TEAM-PM "));
    expect(result.valid).toBe(false);
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("CLOSURE_SELF_ASSERTION");
    expect(warnings).toContain("verdict 0");
    expect(warnings).toContain("verdict 1");
  });

  it("rejects one seat emitting BOTH verification lanes (lane collapse)", () => {
    const result = validateClosureIndependence(lanes("B/QA-1", "B/QA-1"));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("verdicts");
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("CLOSURE_LANE_COLLAPSE");
    expect(warnings).toContain("B/QA-1");
  });

  it.each([
    ["underscore respelling", "b/qa_1"],
    ["trailing whitespace", "B/QA-1 "],
    ["U+2011 non-breaking hyphen", "B/QA‑1"],
    ["zero-width space", "B/QA-​1"],
    ["NFKC fullwidth form", "Ｂ/ＱＡ-１"]
  ])("rejects lane collapse when the second lane respells the first via %s", (_label, alias) => {
    const result = validateClosureIndependence(lanes("B/QA-1", alias));
    expect(result.valid).toBe(false);
    expect(result.warnings.join("\n")).toContain("CLOSURE_LANE_COLLAPSE");
  });

  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    ["null", null],
    ["non-string", 7],
    ["homoglyph outside the canonical alphabet", "В/QA-1"]
  ])("refuses an unreadable emitter (%s) by name", (_label, emitter) => {
    const result = validateClosureIndependence(lanes("B/QA-1", emitter));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("verdicts");
    expect(result.warnings.join("\n")).toContain("EMITTER_IDENTITY_INVALID");
  });

  it("refuses an ABSENT emitted_by field by name", () => {
    const result = validateClosureIndependence(
      claim({
        verdicts: [
          typed({ verdict_kind: "SLICE_QA_PASS", emitted_by: "B/QA-1" }),
          typed({ verdict_kind: "HOLDOUT_ACCEPTED" })
        ]
      })
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.join("\n")).toContain("EMITTER_IDENTITY_INVALID");
  });

  it("never treats two unreadable emitters as two distinct parties", () => {
    const result = validateClosureIndependence(lanes("", "   "));
    expect(result.valid).toBe(false);
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("EMITTER_IDENTITY_INVALID");
    // Both lanes are invalid input, so neither lane is satisfied and the
    // closure is refused rather than silently counted as independent.
    expect(warnings).toContain("verdict 0");
    expect(warnings).toContain("verdict 1");
  });

  it("refuses a claim whose implementer_lane is present but unreadable", () => {
    const result = validateClosureIndependence(
      claim({
        implementer_lane: "B/DEV–1",
        verdicts: [
          typed({ verdict_kind: "SLICE_QA_PASS", emitted_by: "B/QA-1" }),
          typed({ verdict_kind: "HOLDOUT_ACCEPTED", emitted_by: "B/HLDT-1" })
        ]
      })
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("implementer_lane");
    expect(result.warnings.join("\n")).toContain("CLOSURE_PARTY_IDENTITY_INVALID");
  });

  it("refuses a claim whose closing_authority is present but unreadable", () => {
    const result = validateClosureIndependence(
      claim({
        closing_authority: "B//TEAM-PM",
        verdicts: [
          typed({ verdict_kind: "SLICE_QA_PASS", emitted_by: "B/QA-1" }),
          typed({ verdict_kind: "HOLDOUT_ACCEPTED", emitted_by: "B/HLDT-1" })
        ]
      })
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("closing_authority");
    expect(result.warnings.join("\n")).toContain("CLOSURE_PARTY_IDENTITY_INVALID");
  });

  it("keeps distinct lane numbers and team prefixes as distinct seats", () => {
    const result = validateClosureIndependence(lanes("B/QA-1", "B/QA-2"));
    expect(result.valid).toBe(true);
    const collapsed = validateClosureIndependence(lanes("B/QA-1", "C/QA-1"));
    expect(collapsed.valid).toBe(true);
  });

  it("keeps the evidence-class choke point ahead of identity checks", () => {
    // Illegal evidence_class on an otherwise honest closure: the payload is
    // refused on evidence-class grounds, unchanged by this story.
    const result = validateClosureIndependence(
      claim({
        verdicts: [
          typed({ verdict_kind: "SLICE_QA_PASS", emitted_by: "B/QA-1", evidence_class: "trusted_me" }),
          typed({ verdict_kind: "HOLDOUT_ACCEPTED", emitted_by: "B/HLDT-1" })
        ]
      })
    );
    expect(result.valid).toBe(false);
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("EVIDENCE_CLASS_INVALID");
    expect(warnings).not.toContain("CLOSURE_SELF_REVIEW");
  });

  it("reports the evidence-class refusal even when the emitter is also unreadable", () => {
    const result = validateClosureIndependence(
      claim({
        verdicts: [
          typed({ verdict_kind: "SLICE_QA_PASS", emitted_by: "", evidence_class: "trusted_me" }),
          typed({ verdict_kind: "HOLDOUT_ACCEPTED", emitted_by: "B/HLDT-1" })
        ]
      })
    );
    expect(result.valid).toBe(false);
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("EVIDENCE_CLASS_INVALID");
    expect(warnings).toContain("EMITTER_IDENTITY_INVALID");
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
