import { describe, expect, it } from "vitest";
import {
  evaluateBlockedPodRollover,
  evaluateSliceHealth,
  validateAuthorityAction,
  validateControlRecipe
} from "../../src/protocol/index.js";

// EPIC-028 — arrow-free, version-pinned control recipes.
describe("validateControlRecipe", () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    harness_id: "test-harness",
    version_pin: "1.2.3",
    open_menu_recipe: "type-ahead: m",
    model_set_recipe: "launch flag: --model pinned-x",
    quit_verb: "/exit",
    ...overrides
  });

  it("accepts an arrow-free, version-pinned entry", () => {
    expect(validateControlRecipe(entry()).valid).toBe(true);
  });

  it("rejects recipes containing arrow/nav tokens", () => {
    const result = validateControlRecipe(entry({ model_set_recipe: "send-key Down Down Enter" }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("model_set_recipe");
  });

  it("rejects raw arrow escape sequences", () => {
    expect(validateControlRecipe(entry({ open_menu_recipe: "send \\e[B twice" })).valid).toBe(false);
  });

  it("rejects unpinned versions", () => {
    expect(validateControlRecipe(entry({ version_pin: "latest" })).valid).toBe(false);
    expect(validateControlRecipe(entry({ version_pin: "" })).valid).toBe(false);
  });

  it("rejects ctrl+c as a quit verb", () => {
    const result = validateControlRecipe(entry({ quit_verb: "ctrl+c" }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("quit_verb");
  });
});

// EPIC-026 — authority chain + rollover.
describe("validateAuthorityAction", () => {
  it("accepts an operator-authorized roster mutation", () => {
    const result = validateAuthorityAction({
      actor: "A/EXEC-PM",
      action_type: "RESTAFF",
      target_slot: "B/DEV-1",
      authorized_by: "operator"
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a worker re-staffing itself", () => {
    const result = validateAuthorityAction({
      actor: "B/DEV-1",
      action_type: "SELF_RESTAFF",
      authorized_by: "B/DEV-1"
    });
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/never re-staffs itself/);
  });

  it("rejects a roster mutation authorized outside operator/Team-A EXEC", () => {
    const result = validateAuthorityAction({
      actor: "C/TEAM-PM",
      action_type: "SPAWN",
      target_slot: "C/DEV-2",
      authorized_by: "C/TEAM-PM"
    });
    expect(result.valid).toBe(false);
  });

  it("rejects lateral roster negotiation", () => {
    const result = validateAuthorityAction({
      actor: "C/ODIN",
      action_type: "LATERAL_ROSTER_NEGOTIATION",
      authorized_by: "D/ODIN"
    });
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/report UP/);
  });
});

describe("evaluateBlockedPodRollover", () => {
  const base = { blockedPodPaused: true, blockedStatePreserved: true };

  it("spins the next letter in B->C->D->E", () => {
    const decision = evaluateBlockedPodRollover({ ...base, lettersInUse: ["B"] });
    expect(decision.decision).toBe("SPIN_NEXT_TEAM");
    expect(decision.next_team_letter).toBe("C");
    expect(evaluateBlockedPodRollover({ ...base, lettersInUse: ["B", "C", "D"] }).next_team_letter).toBe("E");
  });

  it("STOPs at F: exhausted progression escalates to the operator", () => {
    const decision = evaluateBlockedPodRollover({ ...base, lettersInUse: ["B", "C", "D", "E", "F"] });
    expect(decision.decision).toBe("ESCALATE_OPERATOR");
    expect(decision.next_team_letter).toBeNull();
  });

  it("rejects a rollover framed as a re-staff of the blocked seat", () => {
    const decision = evaluateBlockedPodRollover({ ...base, lettersInUse: ["B"], framedAsRestaff: true });
    expect(decision.decision).toBe("ESCALATE_OPERATOR");
    expect(decision.reasons.join(" ")).toMatch(/never a re-staffing/);
  });

  it("rejects a rollover that drops the blocked pod's state", () => {
    const decision = evaluateBlockedPodRollover({
      lettersInUse: ["B"],
      blockedPodPaused: true,
      blockedStatePreserved: false
    });
    expect(decision.decision).toBe("ESCALATE_OPERATOR");
  });
});

// EPIC-031 — slice & spec health sentinels (surface, never block).
describe("evaluateSliceHealth", () => {
  it("fires OVERSIZED_SLICE when the same slice DNFs two independent agents", () => {
    const signals = evaluateSliceHealth({
      dnfEvents: [
        { slice_ref: "SLICE-003-DEV-002", agent: "agent-a" },
        { slice_ref: "SLICE-003-DEV-002", agent: "agent-b" }
      ]
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].sentinel_id).toBe("OVERSIZED_SLICE");
    expect(signals[0].classification).toMatch(/not agent-weak/);
  });

  it("does NOT fire on a single-agent DNF", () => {
    expect(
      evaluateSliceHealth({ dnfEvents: [{ slice_ref: "SLICE-1", agent: "agent-a" }] })
    ).toHaveLength(0);
  });

  it("fires SPEC_DEFECT when two agents converge on the same WRITE-PROHIBITED path", () => {
    const signals = evaluateSliceHealth({
      prohibitedPathWrites: [
        { path: "crates/frozen/src/lib.rs", agent: "agent-a" },
        { path: "crates/frozen/src/lib.rs", agent: "agent-b" }
      ]
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].sentinel_id).toBe("SPEC_DEFECT");
    expect(signals[0].recommended_response).toBe("SURFACE_TO_PM for spec review/amendment before any retry");
  });

  it("does NOT fire SPEC_DEFECT for a single agent touching a prohibited path", () => {
    expect(
      evaluateSliceHealth({ prohibitedPathWrites: [{ path: "frozen.rs", agent: "agent-a" }] })
    ).toHaveLength(0);
  });

  it("fires QA_WINDOW_TOO_SMALL when a flat window meets a much larger review", () => {
    const signals = evaluateSliceHealth({
      qaReview: { slice_ref: "SLICE-9-QA", reviewed_file_count: 12, flat_timeout_seconds: 870, sized_for_file_count: 3 }
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].sentinel_id).toBe("QA_WINDOW_TOO_SMALL");
  });

  it("stays quiet for a proportionate review window", () => {
    expect(
      evaluateSliceHealth({
        qaReview: { slice_ref: "SLICE-9-QA", reviewed_file_count: 4, flat_timeout_seconds: 900, sized_for_file_count: 3 }
      })
    ).toHaveLength(0);
  });
});

// EPIC-025 — pod bring-up & ground-truth safety.
import { validateBringUpPlan } from "../../src/protocol/index.js";

describe("validateBringUpPlan", () => {
  it("accepts capture-after-boot + count-agnostic + target-only stop", () => {
    const result = validateBringUpPlan({
      ground_truth_capture: "after_boot",
      preserve_framing: "count_agnostic",
      stop_triggers: ["TARGET_ARTIFACT_WRONG"]
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a pre-boot ground-truth scan (hooks mutate the repo)", () => {
    const result = validateBringUpPlan({
      ground_truth_capture: "before_boot",
      preserve_framing: "count_agnostic",
      stop_triggers: ["TARGET_ARTIFACT_WRONG"]
    });
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/SessionStart hooks/);
  });

  it("rejects enumerated expected-state framing", () => {
    const result = validateBringUpPlan({
      ground_truth_capture: "after_boot",
      preserve_framing: "enumerated",
      stop_triggers: ["TARGET_ARTIFACT_WRONG"]
    });
    expect(result.valid).toBe(false);
  });

  it("rejects stop triggers other than a wrong TARGET artifact (count-agnostic preserve)", () => {
    const result = validateBringUpPlan({
      ground_truth_capture: "after_boot",
      preserve_framing: "count_agnostic",
      stop_triggers: ["UNTRACKED_FILE_COUNT_CHANGED"]
    });
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/ONLY stop condition/);
  });
});
