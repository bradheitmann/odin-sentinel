/**
 * EPIC-052 Wave-0: GD-DIAG-001 displacement detector.
 *
 * Pure function over fixture-shaped input only. No runtime wiring, no storage,
 * no MCP integration. Wave-1 will wire this evaluator against live event feeds.
 */

export const GD_DIAG_001_ID = "GD-DIAG-001" as const;

/** Fixture-shaped input for the displacement diagnostic. */
export interface DisplacementCase {
  case_id: string;
  required_terminal_outputs_missing: string[];
  attempt_count: number;
  governance_growth_without_outcome_movement: boolean;
  additional_signals: Record<string, boolean>;
}

/** Result of running GD-DIAG-001 over a displacement case. */
export interface DisplacementResult {
  diagnosis_id: typeof GD_DIAG_001_ID;
  positive: boolean;
  matched_fingerprints: string[];
  matched_count: number;
  required_met: boolean;
  additional_met: boolean;
}

export const REQUIRED_FINGERPRINTS = [
  "GD-FP-001",
  "GD-FP-002",
  "GD-FP-003",
] as const;

export const ADDITIONAL_FINGERPRINTS = [
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
] as const;

const ADDITIONAL_MINIMUM = 2;

/**
 * Evaluate a displacement case against GD-DIAG-001.
 *
 * POSITIVE iff:
 *   GD-FP-001 (required_terminal_outputs_missing > 0) AND
 *   GD-FP-002 (attempt_count > 3) AND
 *   GD-FP-003 (governance_growth_without_outcome_movement) AND
 *   >= 2 of GD-FP-004..013 are true in additional_signals.
 */
export function evaluateDisplacement(input: DisplacementCase): DisplacementResult {
  const fp001 = input.required_terminal_outputs_missing.length > 0;
  const fp002 = input.attempt_count > 3;
  const fp003 = input.governance_growth_without_outcome_movement;

  const matched: string[] = [];
  if (fp001) matched.push("GD-FP-001");
  if (fp002) matched.push("GD-FP-002");
  if (fp003) matched.push("GD-FP-003");

  let additionalCount = 0;
  for (const fp of ADDITIONAL_FINGERPRINTS) {
    if (input.additional_signals[fp] === true) {
      matched.push(fp);
      additionalCount++;
    }
  }

  const requiredMet = fp001 && fp002 && fp003;
  const additionalMet = additionalCount >= ADDITIONAL_MINIMUM;
  const positive = requiredMet && additionalMet;

  return {
    diagnosis_id: GD_DIAG_001_ID,
    positive,
    matched_fingerprints: matched,
    matched_count: matched.length,
    required_met: requiredMet,
    additional_met: additionalMet,
  };
}

/** Convenience: classify a case as a boolean without the full result. */
export function isDisplacementPositive(input: DisplacementCase): boolean {
  return evaluateDisplacement(input).positive;
}
