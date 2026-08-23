import { describe, expect, it } from "vitest";
import {
  EVIDENCE_CLASSES,
  VERDICT_CLASS_ARTIFACTS,
  evidenceClassSchema
} from "../../src/protocol/schemas.js";
import {
  getBootReceiptExamples,
  isVerdictClassArtifact,
  loadProtocolData,
  validateBootReceipt,
  validateClosureIndependence,
  validateEvidenceClassification
} from "../../src/protocol/service.js";

// STORY-AMEND-002 / RET-005 — typed evidence-class enum + service enforcement.
// One enum (observed | derived | claimed | provisional | blocked | rejected |
// accepted) is defined once in schemas.ts; verdict-class payloads (QA verdicts,
// [SCP-FEEDBACK] findings) REQUIRE evidence_class + source_binding at the
// validateEvidenceClassification choke point; every other payload may omit the
// fields (full backward compatibility); illegal values are rejected by name.

const CANONICAL_SEVEN = ["observed", "derived", "claimed", "provisional", "blocked", "rejected", "accepted"];

describe("evidence-class enum (schemas.ts)", () => {
  it("defines the enum once with exactly the seven ledger values", () => {
    expect([...EVIDENCE_CLASSES]).toEqual(CANONICAL_SEVEN);
    expect(new Set(EVIDENCE_CLASSES).size).toBe(7);
  });

  it("names the verdict-class artifact classes (QA verdicts and SCP-FEEDBACK findings)", () => {
    expect([...VERDICT_CLASS_ARTIFACTS]).toEqual(["qa_verdict", "feedback_finding"]);
    expect(isVerdictClassArtifact("qa_verdict")).toBe(true);
    expect(isVerdictClassArtifact("feedback_finding")).toBe(true);
    expect(isVerdictClassArtifact("SCP-FEEDBACK")).toBe(true);
    expect(isVerdictClassArtifact("boot_receipt")).toBe(false);
    expect(isVerdictClassArtifact(undefined)).toBe(false);
  });

  it("zod schema accepts each canonical value and rejects non-canonical values", () => {
    for (const value of CANONICAL_SEVEN) {
      expect(evidenceClassSchema.parse(value)).toBe(value);
    }
    expect(() => evidenceClassSchema.parse("gut_feel")).toThrow();
    expect(() => evidenceClassSchema.parse("OBSERVED")).toThrow();
    expect(() => evidenceClassSchema.parse("")).toThrow();
  });

  it("is referenced by both receipt YAML templates with the exact seven values", () => {
    const data = loadProtocolData();
    const bootEnum = (data.bootReceipt.optional_extension_fields as Record<string, Record<string, unknown>>).evidence_class.enum;
    const manifestEnum = (data.teamManifest.optional_extension_fields as Record<string, Record<string, unknown>>).evidence_class.enum;
    expect(bootEnum).toEqual(CANONICAL_SEVEN);
    expect(manifestEnum).toEqual(CANONICAL_SEVEN);
  });

  it("receipt examples demonstrate the field on verdict-class payloads", () => {
    const data = loadProtocolData();
    const examples = data.bootReceipt.evidence_class_examples as Record<string, Record<string, unknown>>;
    for (const name of ["qa_verdict", "feedback_finding"]) {
      const example = examples[name];
      expect(example.artifact_class).toBe(name);
      expect(CANONICAL_SEVEN).toContain(example.evidence_class);
      expect(typeof example.source_binding).toBe("string");
      expect(validateEvidenceClassification(example).valid).toBe(true);
    }
  });
});

describe("validateEvidenceClassification (verdict-class choke point)", () => {
  it("accepts a fully classified QA verdict", () => {
    const result = validateEvidenceClassification({
      artifact_class: "qa_verdict",
      verdict_kind: "SLICE_QA_PASS",
      result: "PASS",
      emitted_by: "B/QA-1",
      evidence_class: "observed",
      source_binding: ".edge-agentic/local/evidence/SLICE-1/verify.log"
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a fully classified SCP-FEEDBACK finding", () => {
    const result = validateEvidenceClassification({
      artifact_class: "feedback_finding",
      receipt_type: "SCP-FEEDBACK",
      severity: "MEDIUM",
      evidence_class: "derived",
      source_binding: "audit coverage matrix vs executed_scope"
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a QA verdict missing evidence_class, citing the field and artifact class", () => {
    const result = validateEvidenceClassification({
      artifact_class: "qa_verdict",
      source_binding: ".edge-agentic/local/evidence/SLICE-1/verify.log"
    });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("evidence_class");
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("EVIDENCE_CLASS_REQUIRED");
    expect(warnings).toContain('"evidence_class"');
    expect(warnings).toContain("qa_verdict");
  });

  it("rejects a QA verdict missing source_binding, citing the field and artifact class", () => {
    const result = validateEvidenceClassification({
      artifact_class: "qa_verdict",
      evidence_class: "observed"
    });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("source_binding");
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("SOURCE_BINDING_REQUIRED");
    expect(warnings).toContain('"source_binding"');
    expect(warnings).toContain("qa_verdict");
  });

  it("rejects an unclassified SCP-FEEDBACK finding on both required fields", () => {
    const result = validateEvidenceClassification({ artifact_class: "feedback_finding" });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("evidence_class");
    expect(result.invalid).toContain("source_binding");
    expect(result.warnings.join("\n")).toContain("feedback_finding");
  });

  it("rejects an illegal enum value by name on a verdict-class payload", () => {
    const result = validateEvidenceClassification({
      artifact_class: "qa_verdict",
      evidence_class: "gut_feel",
      source_binding: "reviewer intuition"
    });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("evidence_class");
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("EVIDENCE_CLASS_INVALID");
    expect(warnings).toContain('"gut_feel"');
    expect(warnings).toContain(CANONICAL_SEVEN.join(" | "));
  });

  it("rejects an illegal enum value by name on a NON-verdict payload too", () => {
    const result = validateEvidenceClassification({
      artifact_class: "boot_receipt",
      evidence_class: " vibes "
    });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("evidence_class");
    expect(result.warnings.join("\n")).toContain(" vibes ");
  });

  it("leaves non-verdict payloads valid without the field (backward compatible)", () => {
    const result = validateEvidenceClassification({ artifact_class: "boot_receipt", role: "B/DEV-1" });
    expect(result.valid).toBe(true);
    expect(result.invalid).not.toContain("evidence_class");
    expect(result.invalid).not.toContain("source_binding");
  });

  it("accepts optional canonical typing on a non-verdict payload", () => {
    const result = validateEvidenceClassification({
      artifact_class: "team_manifest",
      evidence_class: "provisional",
      source_binding: "readiness gate output"
    });
    expect(result.valid).toBe(true);
  });

  it("treats an undeclared artifact_class as non-verdict with a named advisory", () => {
    const result = validateEvidenceClassification({ note: "untyped payload" });
    expect(result.valid).toBe(true);
    expect(result.warnings.join("\n")).toContain("artifact_class");
  });
});

function closureClaim(verdicts: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    task_ref: "SLICE-42",
    implementer_lane: "B/DEV-1",
    closing_authority: "B/TEAM-PM",
    verdicts
  };
}

const INDEPENDENT_PAIR = [
  { verdict_kind: "SLICE_QA_PASS", result: "PASS", emitted_by: "B/QA-1" },
  { verdict_kind: "HOLDOUT_ACCEPTED", result: "PASS", emitted_by: "B/HLDT-1" }
];

describe("closure choke point (validateClosureIndependence) evidence-class wiring", () => {
  it("keeps pre-RET-005 verdicts valid (backward compatibility) with a named advisory", () => {
    const result = validateClosureIndependence(closureClaim(INDEPENDENT_PAIR));
    expect(result.valid).toBe(true);
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("EVIDENCE_CLASS_RECOMMENDED");
    expect(warnings).toContain("qa_verdict");
  });

  it("accepts closure verdicts carrying canonical evidence_class + source_binding", () => {
    const result = validateClosureIndependence(
      closureClaim(
        INDEPENDENT_PAIR.map((v) => ({
          ...v,
          evidence_class: "observed",
          source_binding: ".edge-agentic/local/evidence/SLICE-42/verify.log"
        }))
      )
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.join("\n")).not.toContain("EVIDENCE_CLASS_RECOMMENDED");
  });

  it("rejects a closure verdict carrying an illegal evidence_class, by name", () => {
    const result = validateClosureIndependence(
      closureClaim(
        INDEPENDENT_PAIR.map((v, i) =>
          i === 0
            ? { ...v, evidence_class: "trusted_me", source_binding: "chat message" }
            : { ...v, evidence_class: "observed", source_binding: "holdout log" }
        )
      )
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("verdicts");
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("EVIDENCE_CLASS_INVALID");
    expect(warnings).toContain('"trusted_me"');
  });
});

describe("non-verdict receipts remain valid without evidence_class", () => {
  it("boot receipts validate with no evidence_class field", () => {
    const result = validateBootReceipt({
      role: "A/EXEC-PM",
      authority_layer: "executive",
      team: "A",
      terminal_locator: "workspace:1 pane:a surface:pm",
      branch: "main",
      cwd: ".",
      model_harness: "Codex CLI",
      permission_mode: "workspace-write",
      may_implement: false,
      may_qa_accept: false,
      reports_to: "operator",
      write_scope: [],
      evidence_path: ".edge-agentic/local/evidence",
      current_task: "bootstrap"
    });
    expect(result.valid).toBe(true);
  });

  it("all canonical boot receipt examples still validate", () => {
    for (const example of Object.values(getBootReceiptExamples())) {
      expect(validateBootReceipt(example).valid).toBe(true);
    }
  });
});
