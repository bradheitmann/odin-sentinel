import { describe, expect, it } from "vitest";
import {
  validateFallbackContract,
  validateOutageHandoff,
  validateSuccessorContract
} from "../../src/protocol/index.js";

// EPIC-024 — roster continuity & failover. Field origin: RFC-v2.3 sweep §5
// (HIGH: silent non-agentic default model in a control seat) and the
// 2026-06-28 provider-outage case study (bounded exception, clean revert).

function fallback(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role_slot: "B/TEAM-PM",
    fallback_rungs: [
      { harness: "droid", model: "pinned-model-x", flags: ["--auto", "high"], reasoning: "high" }
    ],
    substitution_triggers: ["AGENT_DEATH", "USAGE_CAP_EXHAUSTION", "SILENT_SESSION_DROP"],
    post_relaunch_model_verify: true,
    ...overrides
  };
}

describe("validateFallbackContract — pin the model, never the harness default", () => {
  it("accepts a contract whose rungs pin model + flags", () => {
    expect(validateFallbackContract(fallback()).valid).toBe(true);
  });

  it("rejects a rung that names only a harness (inherits the harness default)", () => {
    const result = validateFallbackContract(
      fallback({ fallback_rungs: [{ harness: "opencode", model: "" }] })
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("fallback_rungs");
    expect(result.warnings.join(" ")).toMatch(/default model/i);
  });

  it('rejects a rung whose model is literally "default"', () => {
    const result = validateFallbackContract(
      fallback({ fallback_rungs: [{ harness: "crush", model: "harness default" }] })
    );
    expect(result.valid).toBe(false);
  });

  it("requires PAUSE_ESCALATE when no authorized substitute exists", () => {
    const result = validateFallbackContract(fallback({ fallback_rungs: [] }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("no_substitute_action");

    const ok = validateFallbackContract(
      fallback({ fallback_rungs: [], no_substitute_action: "PAUSE_ESCALATE" })
    );
    expect(ok.valid).toBe(true);
  });

  it("rejects provider billing errors as substitution triggers (operator-side hold)", () => {
    const result = validateFallbackContract(
      fallback({ substitution_triggers: ["AGENT_DEATH", "PROVIDER_BILLING_ERROR"] })
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("substitution_triggers");
    expect(result.warnings.join(" ")).toMatch(/operator-side/i);
  });

  it("requires the post-relaunch model re-verify (identity drifts on relaunch)", () => {
    const result = validateFallbackContract(fallback({ post_relaunch_model_verify: false }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("post_relaunch_model_verify");
  });
});

function successor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    successor_seat: "A/EXEC-ODIN",
    locked_roster: [{ role_slot: "B/DEV-1", model_harness: "pinned-model-x on droid" }],
    in_flight_worklist: ["repo-7 staged, awaiting COMMIT-AUTHORIZED"],
    canonical_hashes: { "hooks/pre-commit": "abc123" },
    roster_mutation_authority: "operator",
    report_up_chain: true,
    ...overrides
  };
}

describe("validateSuccessorContract — assume the seat, keep the roster locked", () => {
  it("accepts a complete successor contract", () => {
    expect(validateSuccessorContract(successor()).valid).toBe(true);
  });

  it("rejects a contract missing the locked roster / worklist / hashes", () => {
    const c = successor();
    delete c.locked_roster;
    delete c.in_flight_worklist;
    delete c.canonical_hashes;
    const result = validateSuccessorContract(c);
    expect(result.valid).toBe(false);
    for (const field of ["locked_roster", "in_flight_worklist", "canonical_hashes"]) {
      expect(result.missing).toContain(field);
    }
  });

  it("rejects an empty locked roster and empty hashes", () => {
    expect(validateSuccessorContract(successor({ locked_roster: [] })).valid).toBe(false);
    expect(validateSuccessorContract(successor({ canonical_hashes: {} })).valid).toBe(false);
  });

  it("rejects roster mutation authority outside operator / Team-A EXEC", () => {
    const result = validateSuccessorContract(successor({ roster_mutation_authority: "B/TEAM-PM" }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("roster_mutation_authority");
  });

  it("accepts TEAM_A_EXEC as mutation authority; rejects lateral negotiation", () => {
    expect(validateSuccessorContract(successor({ roster_mutation_authority: "TEAM_A_EXEC" })).valid).toBe(true);
    expect(validateSuccessorContract(successor({ report_up_chain: false })).valid).toBe(false);
  });
});

function handoff(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    receipt_type: "SCP-OUTAGE-HANDOFF",
    affected_provider: "provider-a",
    affected_slots: ["A/EXEC-PM", "A/PO"],
    surviving_continuity_seat: { seat: "D/ODIN", provider: "provider-b" },
    in_flight_work: ["CP3 homepage body", "E1 content check"],
    critical_roles_needing_cover: ["design lead"],
    expiry_condition: "provider account reset / recovery",
    bounded_exception: true,
    restoration_trigger: "account-reset detection + timed backstop + operator confirm",
    ...overrides
  };
}

describe("validateOutageHandoff — the pre-dark receipt", () => {
  it("accepts a complete pre-dark handoff", () => {
    expect(validateOutageHandoff(handoff()).valid).toBe(true);
  });

  it("rejects a survivor on the SAME provider as the outage (diversity is the point)", () => {
    const result = validateOutageHandoff(
      handoff({ surviving_continuity_seat: { seat: "A/EXEC-ODIN", provider: "provider-a" } })
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("surviving_continuity_seat");
  });

  it("rejects an unbounded reconstitution (no authority transfer by inertia)", () => {
    expect(validateOutageHandoff(handoff({ bounded_exception: false })).valid).toBe(false);
  });

  it("rejects empty affected_slots (the survivor must be able to partition affected vs unaffected)", () => {
    expect(validateOutageHandoff(handoff({ affected_slots: [] })).valid).toBe(false);
  });

  it("warns when no real restoration trigger is named (the phantom self-wake gap)", () => {
    const h = handoff();
    delete h.restoration_trigger;
    const result = validateOutageHandoff(h);
    expect(result.valid).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/self-wake|restoration_trigger/i);
  });
});
