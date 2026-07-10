import { describe, expect, it } from "vitest";
import {
  evaluateBlockedPodRollover,
  evaluateSliceHealth,
  evaluateOversizedSliceSentinel,
  evaluateQaTimeoutSentinel,
  evaluateSpecDefectSentinel,
  validateAuthorityAction,
  validateControlRecipe,
  validateHarnessControlRecipe,
  validateDeliveryVerification
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

  it("rejects standalone j/k/h/l as nav-key tokens (vim-style nav)", () => {
    const result = validateControlRecipe(entry({ model_set_recipe: "press j as standalone nav-key" }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("model_set_recipe");
  });

  it("rejects arrow/nav tokens in the control_recipe field (EPIC-028 S-028.1)", () => {
    const result = validateControlRecipe(entry({ control_recipe: "send-key Down Down Enter" }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("control_recipe");
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

  // EPIC-026 / S-026.1 — the exact field incident: a taking-over EXEC-ODIN
  // re-staffs a dead seat on its own initiative (self-authorized). The roster is
  // LOCKED on a takeover; report-up is the only accepted path.
  it("rejects a taking-over A/EXEC-ODIN self-authorized dead-seat restaff", () => {
    const result = validateAuthorityAction({
      actor: "A/EXEC-ODIN",
      action_type: "restaff_dead_seat",
      authorized_by: "A/EXEC-ODIN",
      target_slot: "B/QA"
    });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("authorized_by");
    expect(result.warnings.join(" ")).toMatch(/LOCKED|own initiative/);
  });

  it("rejects restaff_on_own_initiative self-authorized by A/EXEC-ODIN", () => {
    const result = validateAuthorityAction({
      actor: "A/EXEC-ODIN",
      action_type: "restaff_on_own_initiative",
      authorized_by: "A/EXEC-ODIN",
      target_slot: "B/DEV-1"
    });
    expect(result.valid).toBe(false);
  });

  it("still accepts an operator-authorized dead-seat restaff (independent authorizer)", () => {
    const result = validateAuthorityAction({
      actor: "A/EXEC-ODIN",
      action_type: "restaff_dead_seat",
      authorized_by: "operator",
      target_slot: "B/QA"
    });
    expect(result.valid).toBe(true);
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

// EPIC-028 / S-028.1 — holdout-facing harness control-recipe validator.
describe("validateHarnessControlRecipe", () => {
  it("accepts an arrow-free recipe with an exact version pin", () => {
    const result = validateHarnessControlRecipe({ recipe: "/model sonnet (type-ahead)", harness_version: "2.1.170+" });
    expect(result.valid).toBe(true);
  });

  it("rejects a recipe bearing an arrow/nav token", () => {
    const result = validateHarnessControlRecipe({ recipe: "send-key S Down", harness_version: "1.0.0" });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("recipe");
  });

  it("rejects a missing harness_version", () => {
    const result = validateHarnessControlRecipe({ recipe: "/model sonnet (type-ahead)" });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("harness_version");
  });

  it("rejects a placeholder version pin (latest)", () => {
    const result = validateHarnessControlRecipe({ recipe: "/model sonnet", harness_version: "latest" });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("harness_version");
  });

  it("accepts version_pin as an alias for harness_version", () => {
    const result = validateHarnessControlRecipe({ recipe: "/model sonnet", version_pin: "1.2.3" });
    expect(result.valid).toBe(true);
  });
});

// EPIC-028 / S-028.2 — delivery-verification enforcement.
describe("validateDeliveryVerification", () => {
  it("rejects marker-grep-only for an alt-screen surface", () => {
    const result = validateDeliveryVerification({ surface_type: "alt_screen", method: "marker_grep_only" });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("method");
  });

  it("accepts behavioral verification for an alt-screen surface", () => {
    const result = validateDeliveryVerification({ surface_type: "alt_screen", method: "behavioral" });
    expect(result.valid).toBe(true);
  });

  it("accepts scrollback grep for a scrollback-capable surface", () => {
    const result = validateDeliveryVerification({ surface_type: "scrollback", method: "scrollback_grep" });
    expect(result.valid).toBe(true);
  });

  it("requires both surface_type and method", () => {
    const result = validateDeliveryVerification({ surface_type: "alt_screen" });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("method");
  });
});

// EPIC-031 / S-031.1 — OVERSIZED_SLICE per-sentinel façade.
describe("evaluateOversizedSliceSentinel", () => {
  it("fires OVERSIZED_SLICE with SURFACE_TO_PM for two independent agents", () => {
    const signal = evaluateOversizedSliceSentinel({ slice_ref: "SLICE-TEST-001", dnf_agents: ["agent-a", "agent-b"] });
    expect(signal).not.toBeNull();
    expect(signal?.classification).toBe("OVERSIZED_SLICE");
    expect(signal?.action).toBe("SURFACE_TO_PM");
    expect(signal?.recommended_response).toMatch(/do not auto-retry/);
  });

  it("returns null for a single-agent DNF", () => {
    expect(evaluateOversizedSliceSentinel({ slice_ref: "SLICE-TEST-002", dnf_agents: ["agent-a"] })).toBeNull();
  });
});

// EPIC-031 / S-031.2 — QA_WINDOW_TOO_SMALL per-sentinel façade.
describe("evaluateQaTimeoutSentinel", () => {
  it("fires QA_WINDOW_TOO_SMALL for a flat timeout on a large review", () => {
    const signal = evaluateQaTimeoutSentinel({
      timeout_config: { base_seconds: 120, per_file_seconds: 0, max_seconds: 120 },
      review_file_count: 40
    });
    expect(signal).not.toBeNull();
    expect(signal?.classification).toBe("QA_WINDOW_TOO_SMALL");
    expect(signal?.action).toBe("SURFACE_TO_PM");
  });

  it("returns null when the window scales with review size", () => {
    expect(
      evaluateQaTimeoutSentinel({
        timeout_config: { base_seconds: 120, per_file_seconds: 30, max_seconds: 1800 },
        review_file_count: 40
      })
    ).toBeNull();
  });
});

// EPIC-031 / S-031.3 — SPEC_DEFECT per-sentinel façade.
describe("evaluateSpecDefectSentinel", () => {
  it("fires SPEC_DEFECT with SURFACE_TO_PM for two convergent agents", () => {
    const signal = evaluateSpecDefectSentinel({ prohibited_path: "src/forbidden.ts", convergent_agents: ["agent-a", "agent-b"] });
    expect(signal).not.toBeNull();
    expect(signal?.classification).toBe("SPEC_DEFECT");
    expect(signal?.action).toBe("SURFACE_TO_PM");
    expect(signal?.recommended_response).toMatch(/SURFACE_TO_PM/);
  });

  it("returns null for a single agent touching a prohibited path", () => {
    expect(evaluateSpecDefectSentinel({ prohibited_path: "src/forbidden.ts", convergent_agents: ["agent-a"] })).toBeNull();
  });
});
