import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  evaluateBlockedPodRollover,
  evaluateEscalationGate,
  validateBringUpPlan,
  validateRemediationPacket
} from "../../src/protocol/index.js";
import { BRING_UP_STOP_TRIGGERS } from "../../src/protocol/schemas.js";

// STORY-GOVTRUTH-R3 — fail-closed state transitions.
// Three evaluators used to return a proceeding answer on state they declined to
// require. These rows assert the opposite in each case: an unmet precondition
// yields a NON-proceeding decision, a malformed input is refused BY NAME rather
// than coerced away, and the REMEDIATE requirements correspond one-for-one with
// the fields the packet validator actually enforces.

// ---------------------------------------------------------------------------
// evaluateBlockedPodRollover — AC1, AC2, AC10
// ---------------------------------------------------------------------------

const PAUSED_ASSERTION = "blocked pod stays paused for resume";

describe("evaluateBlockedPodRollover — fail-closed preconditions", () => {
  it.each([
    [true, true, "SPIN_NEXT_TEAM"],
    [true, false, "ESCALATE_OPERATOR"],
    [false, true, "ESCALATE_OPERATOR"],
    [false, false, "ESCALATE_OPERATOR"]
  ] as const)(
    "paused=%s preserved=%s decides %s",
    (blockedPodPaused, blockedStatePreserved, decision) => {
      const result = evaluateBlockedPodRollover({
        lettersInUse: ["B"],
        blockedPodPaused,
        blockedStatePreserved
      });
      expect(result.decision).toBe(decision);
      expect(result.next_team_letter).toBe(decision === "SPIN_NEXT_TEAM" ? "C" : null);
    }
  );

  it("only paused AND preserved may proceed — an unpaused pod never spins a team", () => {
    for (const blockedStatePreserved of [true, false]) {
      const result = evaluateBlockedPodRollover({
        lettersInUse: ["B"],
        blockedPodPaused: false,
        blockedStatePreserved
      });
      expect(result.decision).not.toBe("SPIN_NEXT_TEAM");
      expect(result.next_team_letter).toBeNull();
    }
  });

  it("reports EVERY unmet precondition, not just the first", () => {
    const reasons = evaluateBlockedPodRollover({
      lettersInUse: ["B"],
      blockedPodPaused: false,
      blockedStatePreserved: false
    }).reasons.join(" ");
    expect(reasons).toMatch(/NOT paused/);
    expect(reasons).toMatch(/NOT preserved/);
  });

  it("no reason asserts a paused pod on an input that was never required to be paused", () => {
    for (const blockedStatePreserved of [true, false]) {
      for (const framedAsRestaff of [true, false]) {
        const result = evaluateBlockedPodRollover({
          lettersInUse: ["B"],
          blockedPodPaused: false,
          blockedStatePreserved,
          framedAsRestaff
        });
        expect(result.reasons.join(" ")).not.toContain(PAUSED_ASSERTION);
      }
    }
  });

  it("emits the paused assertion only on a path that verified the pod is paused", () => {
    const proceeding = evaluateBlockedPodRollover({
      lettersInUse: ["B"],
      blockedPodPaused: true,
      blockedStatePreserved: true
    });
    expect(proceeding.decision).toBe("SPIN_NEXT_TEAM");
    expect(proceeding.reasons.join(" ")).toContain(PAUSED_ASSERTION);
  });

  it("restaff framing is never a bypass of the paused precondition", () => {
    const result = evaluateBlockedPodRollover({
      lettersInUse: ["B"],
      blockedPodPaused: false,
      blockedStatePreserved: true,
      framedAsRestaff: true
    });
    expect(result.decision).toBe("ESCALATE_OPERATOR");
    expect(result.next_team_letter).toBeNull();
  });

  it("the restaff short-circuit stays non-proceeding even when both preconditions hold", () => {
    const result = evaluateBlockedPodRollover({
      lettersInUse: ["B"],
      blockedPodPaused: true,
      blockedStatePreserved: true,
      framedAsRestaff: true
    });
    expect(result.decision).toBe("ESCALATE_OPERATOR");
    expect(result.reasons.join(" ")).toMatch(/never a re-staffing/);
  });
});

// ---------------------------------------------------------------------------
// validateBringUpPlan — AC3
// ---------------------------------------------------------------------------

function bringUpPlan(stopTriggers: unknown, omit = false): Record<string, unknown> {
  const plan: Record<string, unknown> = {
    ground_truth_capture: "after_boot",
    preserve_framing: "count_agnostic"
  };
  if (!omit) plan.stop_triggers = stopTriggers;
  return plan;
}

describe("validateBringUpPlan — stop_triggers is an exact set on the raw input", () => {
  it("accepts the canonical set, and only the canonical set is canonical", () => {
    expect(BRING_UP_STOP_TRIGGERS).toEqual(["TARGET_ARTIFACT_WRONG"]);
    const result = validateBringUpPlan(bringUpPlan(["TARGET_ARTIFACT_WRONG"]));
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ["absent", undefined, true],
    ["null", null, false]
  ] as const)("refuses %s as a missing required field", (_label, value, omit) => {
    const result = validateBringUpPlan(bringUpPlan(value, omit));
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("stop_triggers");
  });

  it.each([
    ["an empty array", [], /empty list|array of 0/i],
    ["a bare scalar string", "TARGET_ARTIFACT_WRONG", /non-array/i],
    ["an object", { a: 1 }, /non-array/i],
    ["a duplicated member", ["TARGET_ARTIFACT_WRONG", "TARGET_ARTIFACT_WRONG"], /repeats/i],
    ["a non-string element beside a valid one", ["TARGET_ARTIFACT_WRONG", 42], /not a string/i],
    ["an all-non-string array", [42], /not a string/i],
    ["a non-canonical member", ["SOMETHING_ELSE"], /not a valid stop trigger/i],
    ["a case-folded near-miss", ["target_artifact_wrong"], /not a valid stop trigger/i]
  ] as const)("refuses %s by name", (_label, value, refusal) => {
    const result = validateBringUpPlan(bringUpPlan(value));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("stop_triggers");
    expect(result.warnings.join(" ")).toMatch(refusal);
  });

  it("discards nothing: a malformed element is refused whole, never trimmed to a valid set", () => {
    // The old coercion filtered non-strings out and validated the remains, so
    // this input passed clean with the 42 silently dropped.
    const result = validateBringUpPlan(bringUpPlan(["TARGET_ARTIFACT_WRONG", 42]));
    expect(result.valid).toBe(false);
  });

  it("still refuses the other two fields independently of stop_triggers", () => {
    const result = validateBringUpPlan({
      ground_truth_capture: "before_boot",
      preserve_framing: "enumerated",
      stop_triggers: ["TARGET_ARTIFACT_WRONG"]
    });
    expect(result.valid).toBe(false);
    expect(result.invalid).toEqual(expect.arrayContaining(["ground_truth_capture", "preserve_framing"]));
  });
});

// ---------------------------------------------------------------------------
// evaluateEscalationGate REMEDIATE requirements — AC4, AC5, AC6, AC7, AC9
// ---------------------------------------------------------------------------

const REQUIREMENT_FIELD = /^([a-z_]+): /;
const REQUIREMENT_VALUE = /\[value: ([^\]]+)\]/;

/** The eight fields validateRemediationPacket requires, per AC4. */
const REQUIRED_PACKET_FIELDS = [
  "task_ref",
  "tier_index",
  "artifact_paths",
  "failure_reason",
  "failed_gate",
  "acceptance_bar",
  "next_tier_index",
  "review_lane_tier_index"
];

function remediateRequirements(
  currentTierIndex = 0,
  observations: Record<string, unknown> = { qa_verdict: "REJECT" }
): string[] {
  const result = evaluateEscalationGate({
    // One rung above the current tier, so REMEDIATE is reachable (a failure at
    // the reserve tier escalates instead).
    tierCount: currentTierIndex + 2,
    currentTierIndex,
    observations: observations as never
  });
  expect(result.verdict).toBe("REMEDIATE");
  expect(result.remediation_requirements).not.toBeNull();
  return result.remediation_requirements as string[];
}

/** Field name each requirement governs, read only from the requirement string. */
function requirementFields(requirements: string[]): string[] {
  return requirements.map((requirement) => {
    const match = requirement.match(REQUIREMENT_FIELD);
    expect(match, `requirement identifies no field: ${requirement}`).not.toBeNull();
    return (match as RegExpMatchArray)[1];
  });
}

/** Build a packet using nothing but the requirement strings themselves. */
function packetFromRequirements(requirements: string[]): Record<string, unknown> {
  const packet: Record<string, unknown> = {};
  for (const requirement of requirements) {
    const field = (requirement.match(REQUIREMENT_FIELD) as RegExpMatchArray)[1];
    const stated = requirement.match(REQUIREMENT_VALUE);
    if (stated !== null) {
      const raw = stated[1];
      packet[field] = /^-?\d+$/.test(raw) ? Number(raw) : raw;
      continue;
    }
    // No gate-known value: the requirement says what the failing tier supplies.
    packet[field] = /non-empty list of paths/.test(requirement)
      ? ["src/feature/partial-impl.ts"]
      : `carried verbatim by the failing tier for ${field}`;
  }
  return packet;
}

describe("evaluateEscalationGate — field-identified REMEDIATE requirements", () => {
  it("every requirement opens with the packet field it governs", () => {
    for (const requirement of remediateRequirements()) {
      expect(requirement).toMatch(REQUIREMENT_FIELD);
    }
  });

  it("names all eight required fields, once each, and nothing else", () => {
    const fields = requirementFields(remediateRequirements());
    expect([...fields].sort()).toEqual([...REQUIRED_PACKET_FIELDS].sort());
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("emits no requirement for a merely recommended field", () => {
    const fields = requirementFields(remediateRequirements());
    for (const recommended of ["attempts", "budget_spent", "original_acceptance_bar"]) {
      expect(fields).not.toContain(recommended);
    }
  });

  it("carries the gate-known values so the next tier need not infer them", () => {
    const requirements = remediateRequirements(3);
    const byField = new Map(requirementFields(requirements).map((field, i) => [field, requirements[i]]));
    expect(byField.get("tier_index")).toContain("[value: 3]");
    expect(byField.get("next_tier_index")).toContain("[value: 4]");
    expect(byField.get("review_lane_tier_index")).toContain("[value: 4]");
    expect(byField.get("failed_gate")).toContain("[value: QA_REJECT]");
  });

  it("keeps the rework-not-restart doctrine on the artifact_paths requirement", () => {
    expect(remediateRequirements().join(" ")).toMatch(/rework, never restart/);
  });

  it("DONE, INSUFFICIENT_EVIDENCE, and ESCALATE_OPERATOR still carry a null requirement list", () => {
    const done = evaluateEscalationGate({ tierCount: 3, currentTierIndex: 0, observations: { qa_verdict: "PASS" } });
    const insufficient = evaluateEscalationGate({ tierCount: 3, currentTierIndex: 0, observations: {} });
    const escalate = evaluateEscalationGate({ tierCount: 3, currentTierIndex: 2, observations: { qa_verdict: "REJECT" } });
    expect(done.verdict).toBe("DONE");
    expect(insufficient.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(escalate.verdict).toBe("ESCALATE_OPERATOR");
    for (const result of [done, insufficient, escalate]) {
      expect(result.remediation_requirements).toBeNull();
    }
  });
});

describe("REMEDIATE requirements are mechanically satisfiable — AC7", () => {
  it("a packet built from the requirement strings alone is accepted", () => {
    const packet = packetFromRequirements(remediateRequirements(1));
    expect(Object.keys(packet).sort()).toEqual([...REQUIRED_PACKET_FIELDS].sort());
    const result = validateRemediationPacket(packet);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.invalid).toEqual([]);
  });

  it.each([
    ["a QA rejection", { qa_verdict: "REJECT" }],
    ["a holdout failure", { holdout_result: "FAIL" }],
    ["a self-proof gap", { self_proof: "GAP" }],
    ["an exhausted budget", { budget_exhausted: true }],
    ["a self-declared block", { blocked: true }]
  ] as const)("holds for %s — the stated failed_gate is always an accepted enum value", (_label, observations) => {
    const packet = packetFromRequirements(remediateRequirements(0, observations as Record<string, unknown>));
    const result = validateRemediationPacket(packet);
    expect(result.valid).toBe(true);
    expect(result.invalid).not.toContain("failed_gate");
  });
});

describe("gate requirements and step-up-ladder.yaml required_fields stay in parity — AC9", () => {
  const ladder = YAML.parse(readFileSync("protocol/resources/step-up-ladder.yaml", "utf8"));
  const yamlRequired: string[] = ladder.step_up_ladder.remediation_packet.required_fields;

  it("the YAML still declares the eight fields the packet validator loads", () => {
    expect([...yamlRequired].sort()).toEqual([...REQUIRED_PACKET_FIELDS].sort());
  });

  it("every YAML required_field is named by a gate requirement", () => {
    const fields = requirementFields(remediateRequirements());
    for (const field of yamlRequired) {
      expect(fields, `no REMEDIATE requirement names ${field}`).toContain(field);
    }
  });

  it("every gate requirement names a YAML required_field — none maps to nothing", () => {
    for (const field of requirementFields(remediateRequirements())) {
      expect(yamlRequired, `requirement names ${field}, which the packet does not require`).toContain(field);
    }
  });

  it("the correspondence is exact, so drift in either direction fails", () => {
    expect([...requirementFields(remediateRequirements())].sort()).toEqual([...yamlRequired].sort());
  });
});

// ---------------------------------------------------------------------------
// validateRemediationPacket — invalid VALUES, not just missing fields — AC11
// ---------------------------------------------------------------------------

describe("validateRemediationPacket — invalid values are refused by name", () => {
  const wellFormed = (): Record<string, unknown> => packetFromRequirements(remediateRequirements(1));

  it("refuses a failed_gate outside the enum", () => {
    const result = validateRemediationPacket({ ...wellFormed(), failed_gate: "VIBES_OFF" });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("failed_gate");
    expect(result.warnings.join(" ")).toMatch(/QA_REJECT \| HOLDOUT_FAIL \| SELF_PROOF_GAP/);
  });

  it("refuses a next_tier_index that is not tier_index + 1", () => {
    const result = validateRemediationPacket({ ...wellFormed(), next_tier_index: 4, review_lane_tier_index: 4 });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("next_tier_index");
    expect(result.warnings.join(" ")).toMatch(/one rung at a time/);
  });

  it("refuses an empty artifact_paths array as the restart it is", () => {
    const result = validateRemediationPacket({ ...wellFormed(), artifact_paths: [] });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("artifact_paths");
    expect(result.warnings.join(" ")).toMatch(/restart/i);
  });
});
