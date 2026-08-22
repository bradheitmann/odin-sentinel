import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_FINGERPRINTS,
  evaluateDisplacement,
  GD_DIAG_001_ID,
  isDisplacementPositive,
  REQUIRED_FINGERPRINTS,
  type DisplacementCase,
  type DisplacementResult,
} from "../../src/protocol/event-registry/diagnostic.js";

interface RawFixture {
  case_id: string;
  required_terminal_outputs_missing: string[];
  attempt_count: number;
  governance_growth_without_outcome_movement: boolean;
  fingerprints: Record<string, boolean>;
}

const gdrFixture = (await import("../../tests/fixtures/govdisp/gdr-case-snapshot.json", {
  assert: { type: "json" },
})) as { default: RawFixture };

const healthyFixture = (await import("../../tests/fixtures/govdisp/healthy-control.json", {
  assert: { type: "json" },
})) as { default: RawFixture };

function caseFromFixture(raw: RawFixture): DisplacementCase {
  return {
    case_id: raw.case_id,
    required_terminal_outputs_missing: raw.required_terminal_outputs_missing,
    attempt_count: raw.attempt_count,
    governance_growth_without_outcome_movement: raw.governance_growth_without_outcome_movement,
    additional_signals: raw.fingerprints ?? {},
  };
}

describe("GD-DIAG-001 pure function", () => {
  it("exports the correct diagnosis id and fingerprint constants", () => {
    expect(GD_DIAG_001_ID).toBe("GD-DIAG-001");
    expect(REQUIRED_FINGERPRINTS).toEqual([
      "GD-FP-001",
      "GD-FP-002",
      "GD-FP-003",
    ]);
    expect(ADDITIONAL_FINGERPRINTS).toEqual([
      "GD-FP-004",
      "GD-FP-005",
      "GD-FP-006",
      "GD-FP-007",
      "GD-FP-008",
      "GD-FP-009",
      "GD-FP-010",
      "GD-FP-011",
      "GD-FP-012",
      "GD-FP-013",
    ]);
  });

  it("classifies the GDR case as POSITIVE", () => {
    const input = caseFromFixture(gdrFixture.default);
    const result = evaluateDisplacement(input);
    expect(result.diagnosis_id).toBe("GD-DIAG-001");
    expect(result.positive).toBe(true);
    expect(result.required_met).toBe(true);
    expect(result.additional_met).toBe(true);
    expect(result.matched_fingerprints).toContain("GD-FP-001");
    expect(result.matched_fingerprints).toContain("GD-FP-002");
    expect(result.matched_fingerprints).toContain("GD-FP-003");
    expect(result.matched_count).toBeGreaterThanOrEqual(5);
    expect(isDisplacementPositive(input)).toBe(true);
  });

  it("classifies the healthy control as NEGATIVE", () => {
    const input = caseFromFixture(healthyFixture.default);
    const result = evaluateDisplacement(input);
    expect(result.positive).toBe(false);
    expect(result.required_met).toBe(false);
    expect(result.additional_met).toBe(false);
    expect(result.matched_fingerprints).toHaveLength(0);
    expect(isDisplacementPositive(input)).toBe(false);
  });

  it("returns POSITIVE when all required fingerprints and >=2 additional are present", () => {
    const base: DisplacementCase = {
      case_id: "positive-control",
      required_terminal_outputs_missing: ["missing.md"],
      attempt_count: 5,
      governance_growth_without_outcome_movement: true,
      additional_signals: {
        "GD-FP-004": true,
        "GD-FP-005": true,
      },
    };
    const result = evaluateDisplacement(base);
    expect(result.positive).toBe(true);
    expect(result.required_met).toBe(true);
    expect(result.additional_met).toBe(true);
    expect(result.matched_fingerprints).toEqual([
      "GD-FP-001",
      "GD-FP-002",
      "GD-FP-003",
      "GD-FP-004",
      "GD-FP-005",
    ]);
  });

  it("returns NEGATIVE when only 1 additional fingerprint is present", () => {
    const base: DisplacementCase = {
      case_id: "one-additional",
      required_terminal_outputs_missing: ["missing.md"],
      attempt_count: 5,
      governance_growth_without_outcome_movement: true,
      additional_signals: {
        "GD-FP-004": true,
      },
    };
    const result = evaluateDisplacement(base);
    expect(result.positive).toBe(false);
    expect(result.required_met).toBe(true);
    expect(result.additional_met).toBe(false);
  });

  it("returns NEGATIVE when 0 additional fingerprints are present", () => {
    const base: DisplacementCase = {
      case_id: "zero-additional",
      required_terminal_outputs_missing: ["missing.md"],
      attempt_count: 5,
      governance_growth_without_outcome_movement: true,
      additional_signals: {},
    };
    const result = evaluateDisplacement(base);
    expect(result.positive).toBe(false);
    expect(result.required_met).toBe(true);
    expect(result.additional_met).toBe(false);
  });

  it("returns NEGATIVE when required_terminal_outputs_missing is empty (removing GD-FP-001)", () => {
    const base: DisplacementCase = {
      case_id: "no-fp001",
      required_terminal_outputs_missing: [],
      attempt_count: 5,
      governance_growth_without_outcome_movement: true,
      additional_signals: {
        "GD-FP-004": true,
        "GD-FP-005": true,
      },
    };
    const result = evaluateDisplacement(base);
    expect(result.positive).toBe(false);
    expect(result.required_met).toBe(false);
    expect(result.matched_fingerprints).not.toContain("GD-FP-001");
  });

  it("returns NEGATIVE when attempt_count <= 3 (removing GD-FP-002)", () => {
    const base: DisplacementCase = {
      case_id: "low-attempts",
      required_terminal_outputs_missing: ["missing.md"],
      attempt_count: 3,
      governance_growth_without_outcome_movement: true,
      additional_signals: {
        "GD-FP-004": true,
        "GD-FP-005": true,
      },
    };
    const result = evaluateDisplacement(base);
    expect(result.positive).toBe(false);
    expect(result.required_met).toBe(false);
    expect(result.matched_fingerprints).not.toContain("GD-FP-002");
  });

  it("returns NEGATIVE when governance_growth_without_outcome_movement is false (removing GD-FP-003)", () => {
    const base: DisplacementCase = {
      case_id: "no-growth",
      required_terminal_outputs_missing: ["missing.md"],
      attempt_count: 5,
      governance_growth_without_outcome_movement: false,
      additional_signals: {
        "GD-FP-004": true,
        "GD-FP-005": true,
      },
    };
    const result = evaluateDisplacement(base);
    expect(result.positive).toBe(false);
    expect(result.required_met).toBe(false);
    expect(result.matched_fingerprints).not.toContain("GD-FP-003");
  });

  it("ignores non-signature signals in the classification", () => {
    const base: DisplacementCase = {
      case_id: "non-sig-only",
      required_terminal_outputs_missing: [],
      attempt_count: 1,
      governance_growth_without_outcome_movement: false,
      additional_signals: {
        "GD-NS-001": true,
        "GD-NS-002": true,
        "GD-NS-003": true,
        "GD-NS-004": true,
      },
    };
    const result = evaluateDisplacement(base);
    expect(result.positive).toBe(false);
    expect(result.matched_fingerprints).toHaveLength(0);
  });
});
