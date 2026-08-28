import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  evaluateSliceHealth,
  evaluateOversizedSliceSentinel,
  evaluateQaTimeoutSentinel,
  evaluateSpecDefectSentinel
} from "../../src/protocol/index.js";
import {
  isCoherentTimeoutPolicy,
  isNonEmptyIdentifier,
  isUsableSeconds,
  oversizedSliceSentinelInputShape,
  parseQaTimeoutPolicy,
  qaTimeoutSentinelInputShape,
  SENTINEL_IDENTIFIER_RULE,
  specDefectSentinelInputShape,
  TIMEOUT_POLICY_COHERENCE_MESSAGE,
  TIMEOUT_POLICY_COHERENCE_RULE
} from "../../src/protocol/schemas.js";

// STORY-GOVTRUTH-R5 — sentinel input hygiene. Every row below was an executed
// observation against the pre-fix implementation, where each one FIRED (or, for
// the incoherent policy, wrongly stayed silent). The sentinels are advisory, so
// a finding manufactured from absent input costs a real human owner under the
// 0.6.0 finding-ownership lifecycle. Insufficient input must yield NO finding;
// invalid input must refuse by name; nothing may coerce to a default.

const SLICE_REF = "SLICE-R5-QA-001";

/** A fully valid, coherent policy whose ceiling leaves room to scale. */
const SCALING_POLICY = { base_seconds: 120, per_file_seconds: 30, max_seconds: 1800 };

/**
 * A fully valid, coherent policy that is genuinely undersized: the ceiling
 * equals the floor, so the window can never grow with the review (AC3 boundary
 * probe + AC8 positive control).
 */
const CAPPED_POLICY = { base_seconds: 600, per_file_seconds: 30, max_seconds: 600 };

/** Operator-facing text must never carry a zero or negative window. */
function hasZeroOrNegativeWindow(text: string): boolean {
  return text.match(/(?:^|[^\d])(?:-\d+(?:\.\d+)?|0)s\b/) !== null;
}

describe("AC1 — an absent timeout policy produces no finding at any file count", () => {
  const absentPolicies: Array<[string, Record<string, unknown>]> = [
    ["no timeout_config key", {}],
    ["timeout_config: undefined", { timeout_config: undefined }],
    ["timeout_config: {}", { timeout_config: {} }],
    ["timeout_config: null", { timeout_config: null }],
    ["timeout_config: []", { timeout_config: [] }],
    ["timeout_config: \"600\"", { timeout_config: "600" }]
  ];

  for (const [label, policy] of absentPolicies) {
    for (const count of [0, 1, 3, 12, 40, 1000]) {
      it(`${label} at ${count} files returns null`, () => {
        expect(evaluateQaTimeoutSentinel({ ...policy, review_file_count: count, slice_ref: SLICE_REF })).toBeNull();
      });
    }
  }
});

describe("AC2 — all three seconds fields are required, finite, and strictly positive", () => {
  const partial: Array<[string, Record<string, unknown>]> = [
    ["base_seconds missing", { per_file_seconds: 30, max_seconds: 1800 }],
    ["per_file_seconds missing", { base_seconds: 120, max_seconds: 1800 }],
    ["max_seconds missing", { base_seconds: 120, per_file_seconds: 30 }]
  ];
  for (const [label, cfg] of partial) {
    it(`${label} is invalid input and returns null`, () => {
      expect(evaluateQaTimeoutSentinel({ timeout_config: cfg, review_file_count: 12, slice_ref: SLICE_REF })).toBeNull();
      expect(parseQaTimeoutPolicy(cfg)).toBeNull();
    });
  }

  const badValues: Array<[string, unknown]> = [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["zero", 0],
    ["negative", -100],
    ["a numeric string", "60"],
    ["null", null],
    ["a boolean", true]
  ];
  for (const [label, value] of badValues) {
    for (const field of ["base_seconds", "per_file_seconds", "max_seconds"] as const) {
      it(`${field} = ${label} is invalid input and returns null`, () => {
        const cfg = { ...CAPPED_POLICY, [field]: value };
        expect(isUsableSeconds(value)).toBe(false);
        expect(parseQaTimeoutPolicy(cfg)).toBeNull();
        expect(evaluateQaTimeoutSentinel({ timeout_config: cfg, review_file_count: 12, slice_ref: SLICE_REF })).toBeNull();
      });
    }
  }

  it("the whole-negative policy from the executed matrix no longer fires", () => {
    expect(
      evaluateQaTimeoutSentinel({
        timeout_config: { base_seconds: -100, per_file_seconds: -5, max_seconds: -1 },
        review_file_count: 12,
        slice_ref: SLICE_REF
      })
    ).toBeNull();
  });

  it("the string-typed policy from the executed matrix no longer fires", () => {
    expect(
      evaluateQaTimeoutSentinel({
        timeout_config: { base_seconds: "60", per_file_seconds: "30", max_seconds: "600" },
        review_file_count: 12,
        slice_ref: SLICE_REF
      })
    ).toBeNull();
  });
});

describe(`AC3 — the ${TIMEOUT_POLICY_COHERENCE_RULE} coherence check`, () => {
  const INCOHERENT = { base_seconds: 600, per_file_seconds: 30, max_seconds: 60 };

  it(`is named ${TIMEOUT_POLICY_COHERENCE_RULE} and reads max_seconds against base_seconds`, () => {
    expect(TIMEOUT_POLICY_COHERENCE_RULE).toBe("max_seconds_gte_base_seconds");
    expect(TIMEOUT_POLICY_COHERENCE_MESSAGE).toContain(TIMEOUT_POLICY_COHERENCE_RULE);
    expect(isCoherentTimeoutPolicy(INCOHERENT.base_seconds, INCOHERENT.max_seconds)).toBe(false);
    expect(isCoherentTimeoutPolicy(CAPPED_POLICY.base_seconds, CAPPED_POLICY.max_seconds)).toBe(true);
    expect(isCoherentTimeoutPolicy(SCALING_POLICY.base_seconds, SCALING_POLICY.max_seconds)).toBe(true);
  });

  it("rejects a ceiling below the floor: the direct library call returns null", () => {
    expect(parseQaTimeoutPolicy(INCOHERENT)).toBeNull();
    expect(
      evaluateQaTimeoutSentinel({ timeout_config: INCOHERENT, review_file_count: 12, slice_ref: SLICE_REF })
    ).toBeNull();
  });

  it("rejects a ceiling below the floor at the MCP boundary, by rule name", () => {
    const parsed = z.object(qaTimeoutSentinelInputShape).safeParse({
      timeout_config: INCOHERENT,
      review_file_count: 12,
      slice_ref: SLICE_REF
    });
    expect(parsed.success).toBe(false);
    const issues = parsed.success ? [] : parsed.error.issues;
    const coherenceIssue = issues.find((issue) => issue.message.includes(TIMEOUT_POLICY_COHERENCE_RULE));
    expect(coherenceIssue).toBeDefined();
    expect(coherenceIssue?.path).toEqual(["timeout_config", "max_seconds"]);
  });

  it("accepts the max_seconds == base_seconds boundary as coherent and VALID", () => {
    expect(parseQaTimeoutPolicy(CAPPED_POLICY)).toEqual(CAPPED_POLICY);
    expect(
      z.object(qaTimeoutSentinelInputShape).safeParse({
        timeout_config: CAPPED_POLICY,
        review_file_count: 12,
        slice_ref: SLICE_REF
      }).success
    ).toBe(true);
  });
});

describe("AC4 — no zero or negative window reaches operator-facing text", () => {
  it("recognizes the forbidden window strings it is guarding against", () => {
    expect(hasZeroOrNegativeWindow("flat 0s window sized for ~1 files")).toBe(true);
    expect(hasZeroOrNegativeWindow("flat -100s window sized for ~1 files")).toBe(true);
    expect(hasZeroOrNegativeWindow("flat 600s window sized for ~1 files")).toBe(false);
  });

  it("emits no such text across the whole executed input matrix", () => {
    const inputs: Array<Record<string, unknown>> = [
      { review_file_count: 12 },
      { timeout_config: {}, review_file_count: 12 },
      { timeout_config: null, review_file_count: 12 },
      { timeout_config: { base_seconds: -100, per_file_seconds: -5, max_seconds: -1 }, review_file_count: 12 },
      { timeout_config: { base_seconds: 0, per_file_seconds: 0, max_seconds: 0 }, review_file_count: 12 },
      { timeout_config: { base_seconds: "60", per_file_seconds: "30", max_seconds: "600" }, review_file_count: 12 },
      { timeout_config: { base_seconds: 600, per_file_seconds: 30, max_seconds: 60 }, review_file_count: 12 },
      { timeout_config: CAPPED_POLICY, review_file_count: 12 },
      { timeout_config: SCALING_POLICY, review_file_count: 400 }
    ];
    for (const input of inputs) {
      const signal = evaluateQaTimeoutSentinel({ ...input, slice_ref: SLICE_REF });
      if (signal === null) continue;
      expect(hasZeroOrNegativeWindow(signal.details)).toBe(false);
      expect(hasZeroOrNegativeWindow(signal.recommended_response)).toBe(false);
      expect(hasZeroOrNegativeWindow(signal.classification)).toBe(false);
    }
  });

  it("declines rather than rendering a window for a zero-valued policy", () => {
    expect(
      evaluateSliceHealth({
        qaReview: { slice_ref: SLICE_REF, reviewed_file_count: 12, flat_timeout_seconds: 0, sized_for_file_count: 1 }
      })
    ).toHaveLength(0);
    expect(
      evaluateSliceHealth({
        qaReview: { slice_ref: SLICE_REF, reviewed_file_count: 12, flat_timeout_seconds: -100, sized_for_file_count: 1 }
      })
    ).toHaveLength(0);
  });
});

describe(`AC5 — identifiers obey ${SENTINEL_IDENTIFIER_RULE}`, () => {
  const blanks: Array<[string, unknown]> = [
    ["the empty string", ""],
    ["whitespace only", "   "],
    ["a tab", "\t"],
    ["undefined", undefined],
    ["null", null],
    ["a number", 12]
  ];

  for (const [label, value] of blanks) {
    it(`evaluateOversizedSliceSentinel declines on ${label}`, () => {
      expect(isNonEmptyIdentifier(value)).toBe(false);
      expect(evaluateOversizedSliceSentinel({ slice_ref: value, dnf_agents: ["agent-a", "agent-b"] })).toBeNull();
    });

    it(`evaluateSpecDefectSentinel declines on ${label}`, () => {
      expect(evaluateSpecDefectSentinel({ prohibited_path: value, convergent_agents: ["agent-a", "agent-b"] })).toBeNull();
    });

    it(`evaluateQaTimeoutSentinel declines on ${label} rather than inventing one`, () => {
      expect(
        evaluateQaTimeoutSentinel({ timeout_config: CAPPED_POLICY, review_file_count: 12, slice_ref: value })
      ).toBeNull();
    });
  }

  it("evaluateSpecDefectSentinel declines when the path key is absent entirely", () => {
    expect(evaluateSpecDefectSentinel({ convergent_agents: ["agent-a", "agent-b"] })).toBeNull();
  });

  it("evaluateSliceHealth omits DNF events carrying an empty slice_ref", () => {
    expect(
      evaluateSliceHealth({
        dnfEvents: [
          { slice_ref: "", agent: "agent-a" },
          { slice_ref: "  ", agent: "agent-b" }
        ]
      })
    ).toHaveLength(0);
  });

  it("evaluateSliceHealth omits prohibited-path writes carrying an empty path", () => {
    expect(
      evaluateSliceHealth({
        prohibitedPathWrites: [
          { path: "", agent: "agent-a" },
          { path: "   ", agent: "agent-b" }
        ]
      })
    ).toHaveLength(0);
  });

  it("evaluateSliceHealth omits a QA review carrying an empty slice_ref", () => {
    expect(
      evaluateSliceHealth({
        qaReview: { slice_ref: "  ", reviewed_file_count: 12, flat_timeout_seconds: 600, sized_for_file_count: 1 }
      })
    ).toHaveLength(0);
  });

  it("the timeout sentinel carries the caller's identifier, never the old hardcoded one", () => {
    const signal = evaluateQaTimeoutSentinel({
      timeout_config: CAPPED_POLICY,
      review_file_count: 12,
      slice_ref: `  ${SLICE_REF}  `
    });
    expect(signal?.slice_ref).toBe(SLICE_REF);
    expect(signal?.slice_ref).not.toBe("qa-review");
  });

  it("a valid identifier still produces the OVERSIZED_SLICE and SPEC_DEFECT signals", () => {
    expect(evaluateOversizedSliceSentinel({ slice_ref: SLICE_REF, dnf_agents: ["agent-a", "agent-b"] })?.slice_ref).toBe(SLICE_REF);
    expect(
      evaluateSpecDefectSentinel({ prohibited_path: "src/frozen.ts", convergent_agents: ["agent-a", "agent-b"] })?.slice_ref
    ).toBe("src/frozen.ts");
  });
});

describe("AC6 — the sentinels remain ADVISORY-ONLY", () => {
  it("every emitted signal is a SURFACE_TO_PM recommendation, never an enforcement action", () => {
    const signals = [
      evaluateQaTimeoutSentinel({ timeout_config: CAPPED_POLICY, review_file_count: 12, slice_ref: SLICE_REF }),
      evaluateOversizedSliceSentinel({ slice_ref: SLICE_REF, dnf_agents: ["agent-a", "agent-b"] }),
      evaluateSpecDefectSentinel({ prohibited_path: "src/frozen.ts", convergent_agents: ["agent-a", "agent-b"] })
    ];
    for (const signal of signals) {
      expect(signal).not.toBeNull();
      expect(signal?.action).toBe("SURFACE_TO_PM");
    }
  });
});

describe("AC7 — the MCP shapes mirror the runtime guard", () => {
  const qaSchema = z.object(qaTimeoutSentinelInputShape);

  it("takes review_file_count, and never the internal reviewed_file_count spelling", () => {
    expect(Object.keys(qaTimeoutSentinelInputShape)).toContain("review_file_count");
    expect(Object.keys(qaTimeoutSentinelInputShape)).not.toContain("reviewed_file_count");
    // The internal spelling is not a facade key: it is dropped at the boundary
    // and supplies no count, so the sentinel declines rather than counting it.
    const internalSpelling: Record<string, unknown> = {
      timeout_config: CAPPED_POLICY,
      reviewed_file_count: 12,
      slice_ref: SLICE_REF
    };
    const parsed = qaSchema.safeParse(internalSpelling);
    expect(parsed.success).toBe(true);
    expect(parsed.success ? Object.keys(parsed.data) : []).not.toContain("reviewed_file_count");
    expect(evaluateQaTimeoutSentinel(internalSpelling)).toBeNull();
  });

  it("rejects zero, negative, and non-finite seconds at the schema boundary", () => {
    for (const field of ["base_seconds", "per_file_seconds", "max_seconds"] as const) {
      for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "60"]) {
        const input = { timeout_config: { ...CAPPED_POLICY, [field]: value }, slice_ref: SLICE_REF };
        expect(qaSchema.safeParse(input).success).toBe(false);
      }
    }
  });

  it("requires the three seconds fields together", () => {
    expect(qaSchema.safeParse({ timeout_config: { base_seconds: 120 }, slice_ref: SLICE_REF }).success).toBe(false);
    expect(qaSchema.safeParse({ timeout_config: { base_seconds: 120, per_file_seconds: 30 }, slice_ref: SLICE_REF }).success).toBe(false);
  });

  it("rejects an empty identifier on every sentinel shape", () => {
    expect(qaSchema.safeParse({ timeout_config: CAPPED_POLICY, slice_ref: "" }).success).toBe(false);
    expect(qaSchema.safeParse({ timeout_config: CAPPED_POLICY, slice_ref: "   " }).success).toBe(false);
    expect(z.object(oversizedSliceSentinelInputShape).safeParse({ slice_ref: "", dnf_agents: [] }).success).toBe(false);
    expect(z.object(specDefectSentinelInputShape).safeParse({ prohibited_path: "" }).success).toBe(false);
  });

  it("accepts a well-formed payload with the optional slice_ref present", () => {
    expect(qaSchema.safeParse({ timeout_config: SCALING_POLICY, review_file_count: 40, slice_ref: SLICE_REF }).success).toBe(true);
    expect(z.object(oversizedSliceSentinelInputShape).safeParse({ slice_ref: SLICE_REF, dnf_agents: ["a", "b"] }).success).toBe(true);
    expect(z.object(specDefectSentinelInputShape).safeParse({ prohibited_path: "src/frozen.ts" }).success).toBe(true);
  });
});

describe("AC8 — the fix rejects bad input; it does not silence the sentinel", () => {
  it("fires on a valid coherent policy whose ceiling equals its floor", () => {
    const signal = evaluateQaTimeoutSentinel({
      timeout_config: CAPPED_POLICY,
      review_file_count: 12,
      slice_ref: SLICE_REF
    });
    expect(signal).not.toBeNull();
    expect(signal?.classification).toBe("QA_WINDOW_TOO_SMALL");
    expect(signal?.action).toBe("SURFACE_TO_PM");
    expect(signal?.slice_ref).toBe(SLICE_REF);
    expect(signal?.details).toBe("flat 600s window sized for ~1 files applied to a 12-file review");
    expect(signal?.recommended_response).toMatch(/scale the window/);
  });

  it("fires when a generous per-file rate is cut back by a binding ceiling", () => {
    const signal = evaluateQaTimeoutSentinel({
      timeout_config: SCALING_POLICY,
      review_file_count: 400,
      slice_ref: SLICE_REF
    });
    expect(signal).not.toBeNull();
    expect(signal?.details).toBe("flat 1800s window sized for ~1 files applied to a 400-file review");
  });

  it("stays silent once the ceiling leaves room for the scaled window", () => {
    expect(
      evaluateQaTimeoutSentinel({ timeout_config: SCALING_POLICY, review_file_count: 40, slice_ref: SLICE_REF })
    ).toBeNull();
  });

  it("stays silent below the reviewed-file threshold, which is unchanged", () => {
    expect(
      evaluateQaTimeoutSentinel({ timeout_config: CAPPED_POLICY, review_file_count: 2, slice_ref: SLICE_REF })
    ).toBeNull();
  });

  it("declines a review_file_count that is absent or not a whole non-negative number", () => {
    for (const count of [undefined, null, -1, 1.5, "12", Number.NaN]) {
      expect(
        evaluateQaTimeoutSentinel({ timeout_config: CAPPED_POLICY, review_file_count: count, slice_ref: SLICE_REF })
      ).toBeNull();
    }
  });
});
