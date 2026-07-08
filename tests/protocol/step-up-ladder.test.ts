import { describe, expect, it } from "vitest";
import { evaluateEscalationGate, validateRemediationPacket } from "../../src/protocol/index.js";

// EPIC-027 — Step-Up Remediation Ladder.
// Doctrine: cheap-first; step up only on a real, independent gate failure;
// rework, never restart; reserve the top tier; review lane travels with the DEV.

describe("evaluateEscalationGate — verdict matrix", () => {
  const ladder = { tierCount: 3, currentTierIndex: 0 };

  it("DONE when no gate failed and an independent gate passed (QA)", () => {
    const result = evaluateEscalationGate({ ...ladder, observations: { qa_verdict: "PASS" } });
    expect(result.verdict).toBe("DONE");
    expect(result.next_tier_index).toBeNull();
  });

  it("DONE when no gate failed and the sealed holdout passed", () => {
    const result = evaluateEscalationGate({ ...ladder, observations: { holdout_result: "PASS" } });
    expect(result.verdict).toBe("DONE");
  });

  it("a self-authored tool green is NEVER accepted as a pass", () => {
    const result = evaluateEscalationGate({ ...ladder, observations: { self_tool_green: true } });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toMatch(/self-tool green|self-authored/i);
  });

  it("no observations at all is INSUFFICIENT_EVIDENCE, not DONE and not a step-up", () => {
    const result = evaluateEscalationGate({ ...ladder, observations: {} });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.next_tier_index).toBeNull();
  });

  it.each([
    [{ qa_verdict: "REJECT" } as const, "QA_REJECT"],
    [{ holdout_result: "FAIL" } as const, "HOLDOUT_FAIL"],
    [{ self_proof: "GAP" } as const, "SELF_PROOF_GAP"]
  ])("each independent gate failure %j triggers REMEDIATE at the next tier", (obs, gate) => {
    const result = evaluateEscalationGate({ ...ladder, observations: obs });
    expect(result.verdict).toBe("REMEDIATE");
    expect(result.failed_gates).toContain(gate);
    expect(result.next_tier_index).toBe(1);
    expect(result.remediation_requirements?.join(" ")).toMatch(/rework, never restart/);
  });

  it("budget exhaustion and self-declared BLOCKED are failure signals", () => {
    expect(evaluateEscalationGate({ ...ladder, observations: { budget_exhausted: true } }).verdict).toBe("REMEDIATE");
    expect(evaluateEscalationGate({ ...ladder, observations: { blocked: true } }).verdict).toBe("REMEDIATE");
  });

  it("a gate failure OVERRIDES a passing gate (any failure fails the tier)", () => {
    const result = evaluateEscalationGate({
      ...ladder,
      observations: { qa_verdict: "PASS", holdout_result: "FAIL" }
    });
    expect(result.verdict).toBe("REMEDIATE");
    expect(result.failed_gates).toEqual(["HOLDOUT_FAIL"]);
  });

  it("reserve-tier failure escalates to the operator, never silent-fails", () => {
    const result = evaluateEscalationGate({
      tierCount: 3,
      currentTierIndex: 2,
      observations: { qa_verdict: "REJECT" }
    });
    expect(result.verdict).toBe("ESCALATE_OPERATOR");
    expect(result.next_tier_index).toBeNull();
  });

  it("supports a 2-tier ladder and an N-tier ladder (tier count is configuration)", () => {
    expect(
      evaluateEscalationGate({ tierCount: 2, currentTierIndex: 0, observations: { self_proof: "GAP" } }).verdict
    ).toBe("REMEDIATE");
    expect(
      evaluateEscalationGate({ tierCount: 2, currentTierIndex: 1, observations: { self_proof: "GAP" } }).verdict
    ).toBe("ESCALATE_OPERATOR");
    expect(
      evaluateEscalationGate({ tierCount: 7, currentTierIndex: 3, observations: { qa_verdict: "REJECT" } }).next_tier_index
    ).toBe(4);
  });

  it("rejects a tier index outside the configured ladder", () => {
    expect(() => evaluateEscalationGate({ tierCount: 2, currentTierIndex: 2, observations: {} })).toThrow(
      /outside the configured ladder/
    );
  });
});

function basePacket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_ref: "TASK-42",
    tier_index: 0,
    artifact_paths: ["src/feature/partial-impl.ts", "notes/failure-analysis.md"],
    failure_reason: "QA found the validator passes a known-bad artifact",
    failed_gate: "QA_REJECT",
    acceptance_bar: "the gate must FAIL the known-bad fixture and PASS the known-good fixture",
    next_tier_index: 1,
    review_lane_tier_index: 1,
    attempts: ["regex rewrite (dead end)"],
    ...overrides
  };
}

describe("validateRemediationPacket — the baton", () => {
  it("accepts a complete, well-formed packet", () => {
    const result = validateRemediationPacket(basePacket());
    expect(result.valid).toBe(true);
  });

  it("rejects a restart: empty artifact_paths is not a baton", () => {
    const result = validateRemediationPacket(basePacket({ artifact_paths: [] }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("artifact_paths");
    expect(result.warnings.join(" ")).toMatch(/restart/i);
  });

  it("rejects a missing salvaged artifact entirely", () => {
    const packet = basePacket();
    delete packet.artifact_paths;
    const result = validateRemediationPacket(packet);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("artifact_paths");
  });

  it("rejects a borrowed review lane (review must travel with the DEV)", () => {
    const result = validateRemediationPacket(basePacket({ review_lane_tier_index: 0 }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("review_lane_tier_index");
  });

  it("rejects skipping rungs (next tier must be tier_index + 1)", () => {
    const result = validateRemediationPacket(basePacket({ next_tier_index: 2, review_lane_tier_index: 2 }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("next_tier_index");
  });

  it("rejects a mutated acceptance bar (immutable across tiers)", () => {
    const result = validateRemediationPacket(
      basePacket({
        original_acceptance_bar: "the gate must FAIL the known-bad fixture and PASS the known-good fixture",
        acceptance_bar: "the gate should mostly work"
      })
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("acceptance_bar");
  });

  it("rejects an unknown failed_gate", () => {
    const result = validateRemediationPacket(basePacket({ failed_gate: "VIBES" }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("failed_gate");
  });

  it("warns (does not fail) when dead-end attempts are omitted", () => {
    const packet = basePacket();
    delete packet.attempts;
    const result = validateRemediationPacket(packet);
    expect(result.valid).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/attempts/);
  });
});

describe("doctrine resource ships no bindings", () => {
  it("step-up-ladder.yaml contains no concrete model names, lane ids, or cost multiples", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync("protocol/resources/step-up-ladder.yaml", "utf8");
    // The non-normative source roster must not leak into the shipped doctrine.
    expect(text).not.toMatch(/GLM-?5|GPT-?5|Opus|Sonnet|Haiku|Kimi|Nemotron|MiniMax|DeepSeek/i);
    expect(text).not.toMatch(/D[A-Z]?\/DEV-\d|DA\/QA-\d|12x|12×/i);
  });
});

describe("tier-indexing reconciliation — recipe-capture re-injection into Tier 1 reads true", () => {
  // QA-WAVE-1-REQA E027 blocker: the slice DoD says "re-inject into Tier 1"
  // (1-indexed) but the resources ship 0-indexed tier_0/tier 0. The resources
  // now explicitly bridge the two conventions so the criterion reads true.

  it("step-up-ladder.yaml states tiers are 0-indexed and tier_0 is the doctrine Tier 1", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync("protocol/resources/step-up-ladder.yaml", "utf8");
    expect(text).toMatch(/0-indexed/i);
    expect(text).toMatch(/tier_0/i);
    // The bridge note ties the 0-indexed base tier to the 1-indexed prose name.
    expect(text).toMatch(/base_tier_doctrine_name: Tier 1/i);
    expect(text).toMatch(/re-inject .* into Tier 1.*tier_0/i);
  });

  it("recipe-capture.yaml ties reinjection_target tier_0 to the doctrine Tier 1", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync("protocol/resources/recipe-capture.yaml", "utf8");
    expect(text).toMatch(/reinjection_target/i);
    expect(text).toMatch(/tier_0/i);
    // The re-injection criterion explicitly reads true: tier_0 == Tier 1.
    expect(text).toMatch(/tier_0 is the/i);
    expect(text).toMatch(/doctrine base.*Tier 1/i);
    // The criterion-spanning sentence (YAML line-wraps across "re-injecting ... recipe
    // at tier_0 IS"), so allow newlines in the match.
    expect(text).toMatch(/re-injecting[\s\S]*recipe at tier_0 IS/i);
  });
});
