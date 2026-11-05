import { describe, expect, it } from "vitest";
import { getHarnessProbeMatrix, validateGovernedContextProof } from "../../src/protocol/service.js";
import { redactSecretLikeText } from "../../src/protocol/validators.js";
import { SECRET_TOKEN_PATTERNS } from "../../src/telemetry/redactor.js";

// @ts-ignore - governed-context verifier is an ESM .mjs module without declaration files.
const gc = await import("../../scripts/protocol/verify-governed-context.mjs");

// synthetic sample built at runtime so tracked bytes carry no detector-shaped literal; value is not real
const sample = (...parts: string[]): string => parts.join("");
const FILLER = "0123456789abcdefghijklmnopqrstuvwxyz";

const SHAPES: ReadonlyArray<{ label: string; secret: string; text: string }> = (() => {
  // synthetic sample built at runtime so tracked bytes carry no detector-shaped literal; value is not real
  const doppler = sample("dp", ".st.", FILLER.slice(0, 32));
  // synthetic sample built at runtime so tracked bytes carry no detector-shaped literal; value is not real
  const google = sample("AI", "za", FILLER.slice(0, 35));
  // synthetic sample built at runtime so tracked bytes carry no detector-shaped literal; value is not real
  const jsonValue = sample("value", FILLER.slice(0, 20));
  return [
    { label: "Doppler service token", secret: doppler, text: `crush config uses ${doppler} for inference` },
    { label: "Google AIza key", secret: google, text: `provider key ${google} rejected` },
    { label: "JSON apiKey field", secret: jsonValue, text: sample('{"provider":"x","api', 'Key":"', jsonValue, '"}') }
  ];
})();

function probeRowObservation(text: string): string {
  const result = getHarnessProbeMatrix({ intendedHarnesses: ["crush"], observations: [{ harness: "crush", text }] });
  return JSON.stringify(result);
}

describe("F-21: the probe matrix redacts every token shape the telemetry redactor knows", () => {
  it.each(SHAPES)("$label is not echoed by odin.get_harness_probe_matrix", ({ secret, text }) => {
    expect(probeRowObservation(text).includes(secret)).toBe(false);
  });

  it.each(SHAPES)("$label is redacted by redactSecretLikeText", ({ secret, text }) => {
    const redacted = redactSecretLikeText(text);
    expect(redacted.includes(secret)).toBe(false);
    expect(redacted).toContain("[REDACTED]");
  });

  it("the telemetry token-shape list is the shared source for the token shapes", () => {
    const [doppler, google] = SHAPES;
    for (const shape of [doppler, google]) {
      expect(SECRET_TOKEN_PATTERNS.some((pattern) => new RegExp(pattern.source, pattern.flags.replace("g", "")).test(shape.secret)), shape.label).toBe(true);
    }
  });
});

describe("F-22: secret patterns need a leading word boundary", () => {
  const VALID_PROOF = {
    schema: "odin.governed_context_proof.v1",
    role: "B/DEV-1",
    harness: "Claude Code",
    source_type: "native_skill",
    control_source: { marker: "SCP_PUBLIC_VERSION: 0.4.9" },
    uptake_receipt: { method: "quoted_marker", evidence_marker: "SCP_PUBLIC_VERSION: 0.4.9", observed: true, observed_at: "2026-06-04T05:00:00Z" },
    generated_at: "2026-06-04T05:00:00Z"
  };

  it("validateGovernedContextProof does not read risk-assessment or task-management as a secret", () => {
    for (const note of ["risk-assessment complete", "task-management done", "desk-organisation"]) {
      const result = validateGovernedContextProof({ ...VALID_PROOF, note });
      expect(result.reasons, note).not.toContain("governed-context proof contains a secret-looking value");
      expect(result.valid, note).toBe(true);
    }
  });

  it("redactSecretLikeText leaves harmless hyphenated words untouched", () => {
    const text = "risk-assessment and task-management notes";
    expect(redactSecretLikeText(text)).toBe(text);
  });

  it("the verify-governed-context.mjs copy agrees: no false positive, a real shape still flagged", () => {
    expect(gc.containsSecretLikeValue("risk-assessment complete")).toBe(false);
    expect(gc.containsSecretLikeValue("task-management done")).toBe(false);
    // synthetic sample built at runtime so tracked bytes carry no detector-shaped literal; value is not real
    expect(gc.containsSecretLikeValue(sample("token ", "sk", "-", FILLER))).toBe(true);
  });

  it("a standalone prefixed token is still redacted and still rejected", () => {
    // synthetic sample built at runtime so tracked bytes carry no detector-shaped literal; value is not real
    const token = sample("gh", "p_", FILLER);
    expect(redactSecretLikeText(`see ${token}`).includes(token)).toBe(false);
    expect(validateGovernedContextProof({ ...VALID_PROOF, note: token }).reasons).toContain(
      "governed-context proof contains a secret-looking value"
    );
  });
});
