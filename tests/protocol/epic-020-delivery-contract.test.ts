import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateCmuxDeliveryProof } from "../../src/protocol/index.js";

// EPIC-020 — harness-aware delivery. Field origin 2026-06-27: embedded newlines
// sent to GLM-5.2/Pi submit one line per prompt ("machine-gunning") even with
// Enter sent; the trigger is the newline itself, not multiple send calls.

function baseProof(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    target_surface_locator: "cmux workspace:9 surface:143",
    submitted: true,
    verification_method: "read-screen",
    observed_processing_state: "DELIVERED_ACKED",
    timestamp: "2026-07-06T20:00:00Z",
    sender_role: "A/EXEC-PM",
    ...overrides
  };
}

describe("validateCmuxDeliveryProof — send != submit (existing contract preserved)", () => {
  it("accepts a submitted + confirmed proof", () => {
    expect(validateCmuxDeliveryProof(baseProof()).valid).toBe(true);
  });

  it("still fails a sent-but-not-submitted proof", () => {
    const result = validateCmuxDeliveryProof(baseProof({ submitted: false }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("submitted");
  });

  it("still fails INPUT_BAR_ONLY", () => {
    const result = validateCmuxDeliveryProof(baseProof({ observed_processing_state: "INPUT_BAR_ONLY" }));
    expect(result.valid).toBe(false);
  });
});

describe("MULTILINE_TO_SINGLE_SUBMIT_HARNESS — the machine-gunning verdict", () => {
  it("fails a multi-line payload to a single-submit harness EVEN WITH Enter sent", () => {
    const result = validateCmuxDeliveryProof(
      baseProof({
        target_submit_profile: "single_line_flatten",
        payload_preview: "line one\nline two\nline three"
      })
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("payload_contains_newline");
    expect(result.warnings.join(" ")).toMatch(/MULTILINE_TO_SINGLE_SUBMIT_HARNESS/);
    expect(result.warnings.join(" ")).toMatch(/embedded newlines/);
  });

  it("accepts the same payload once the canonical helper flattened it", () => {
    const result = validateCmuxDeliveryProof(
      baseProof({
        target_submit_profile: "single_line_flatten",
        payload_contains_newline: true,
        newlines_flattened: true
      })
    );
    expect(result.valid).toBe(true);
  });

  it("accepts a genuinely single-line payload to a single-submit harness", () => {
    const result = validateCmuxDeliveryProof(
      baseProof({
        target_submit_profile: "single_line_flatten",
        payload_preview: "BOOT ;; role=C/PM ;; branch=main ;; ack with receipt"
      })
    );
    expect(result.valid).toBe(true);
  });

  it("does not flag multi-line payloads to multi-line-capable harnesses", () => {
    const result = validateCmuxDeliveryProof(
      baseProof({
        target_submit_profile: "double_enter",
        payload_preview: "line one\nline two"
      })
    );
    expect(result.valid).toBe(true);
  });

  it("detects carriage returns as embedded newlines too", () => {
    const result = validateCmuxDeliveryProof(
      baseProof({ target_submit_profile: "single_line_flatten", payload_preview: "a\rb" })
    );
    expect(result.valid).toBe(false);
  });
});

describe("pre-dispatch dry-run", () => {
  it("validates format compatibility BEFORE the send (no submitted/state required)", () => {
    const result = validateCmuxDeliveryProof({
      dry_run: true,
      target_surface_locator: "cmux workspace:9 surface:143",
      sender_role: "A/EXEC-PM",
      timestamp: "2026-07-06T20:00:00Z",
      target_submit_profile: "single_line_flatten",
      payload_preview: "single line only ;; ready"
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/dry_run/);
  });

  it("fails a dry-run whose payload would machine-gun the target", () => {
    const result = validateCmuxDeliveryProof({
      dry_run: true,
      target_surface_locator: "cmux workspace:9 surface:143",
      sender_role: "A/EXEC-PM",
      timestamp: "2026-07-06T20:00:00Z",
      target_submit_profile: "single_line_flatten",
      payload_preview: "boot contract:\n- step 1\n- step 2"
    });
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/MULTILINE_TO_SINGLE_SUBMIT_HARNESS/);
  });
});

describe("per-harness format matrix (seeds)", () => {
  const seed = (name: string) =>
    JSON.parse(readFileSync(new URL(`../../src/harness-pacing/seeds/${name}.json`, import.meta.url), "utf8"));

  it("pi is single_line_flatten with ' ;; ' separators and multi_line_ok=false", () => {
    const pi = seed("pi");
    expect(pi.message_format.submit_profile).toBe("single_line_flatten");
    expect(pi.message_format.newline_policy).toBe("flatten_to_space");
    expect(pi.message_format.multi_line_ok).toBe(false);
    expect(pi.message_format.field_separator).toBe(" ;; ");
  });

  it("glm-droid is double_enter with second-Enter-on-busy", () => {
    const droid = seed("glm-droid");
    expect(droid.message_format.submit_profile).toBe("double_enter");
    expect(droid.message_format.second_enter_on_busy).toBe(true);
    expect(droid.message_format.multi_line_ok).toBe(true);
  });

  it("legacy seeds without format-era event fields still parse (additive schema)", () => {
    for (const name of ["cmux", "crush", "glm-droid"]) {
      const s = seed(name);
      expect(s.harness_id).toBe(name);
      expect(Array.isArray(s.events)).toBe(true);
    }
  });
});
