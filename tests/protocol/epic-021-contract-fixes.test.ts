import { describe, expect, it } from "vitest";
import { getRoleProfile, validateBootReceipt } from "../../src/protocol/index.js";

// EPIC-021 / S-021.1 — role-profile lookup accepts bare (un-numbered) worker slots.
// Field origin: `odin.get_role_profile` rejected "B/QA" during the 2026-06-20 fleet sweep.
describe("role-profile normalization: bare team-prefixed slots", () => {
  it("resolves B/QA to the QA_WORKER profile", () => {
    const profile = getRoleProfile("B/QA") as { title: string };
    expect(profile.title).toBeTruthy();
    expect(profile).toEqual(getRoleProfile("QA_WORKER"));
  });

  it("resolves B/DEV to the DEV_WORKER profile", () => {
    expect(getRoleProfile("B/DEV")).toEqual(getRoleProfile("DEV_WORKER"));
  });

  it("resolves bare team PM slots (C/PM, D/PM) to TEAM_PM", () => {
    expect(getRoleProfile("C/PM")).toEqual(getRoleProfile("TEAM_PM"));
    expect(getRoleProfile("D/PM")).toEqual(getRoleProfile("TEAM_PM"));
  });

  it("resolves bare SHADOW to SHADOW_REVIEWER", () => {
    expect(getRoleProfile("B/SHADOW")).toEqual(getRoleProfile("SHADOW_REVIEWER"));
  });

  it("does not regress numbered slots or exec slots", () => {
    expect(getRoleProfile("B/QA-1")).toEqual(getRoleProfile("QA_WORKER"));
    expect(getRoleProfile("B/DEV-2")).toEqual(getRoleProfile("DEV_WORKER"));
    expect(getRoleProfile("A/EXEC-PM")).toEqual(getRoleProfile("EXEC_PM"));
    expect(getRoleProfile("A/EXEC-QA")).toEqual(getRoleProfile("EXEC_QA"));
    expect(getRoleProfile("B/ODIN")).toEqual(getRoleProfile("TEAM_ODIN"));
  });

  it("still rejects genuinely unknown roles", () => {
    expect(() => getRoleProfile("B/HLDT")).toThrow("Unknown ODIN/SCP role");
    expect(() => getRoleProfile("NOT_A_ROLE")).toThrow("Unknown ODIN/SCP role");
  });
});

// EPIC-021 / S-021.2 — Team-B staffing-audit fields hard-fail, not warn.
function baseReceipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: "QA WORKER",
    authority_layer: "worker",
    team: "B",
    terminal_locator: "cmux workspace:1 pane:2 surface:87",
    branch: "main",
    cwd: "/repo",
    model_harness: "GLM-5.1 on Crush",
    permission_mode: "standard",
    may_implement: false,
    may_qa_accept: true,
    reports_to: "B/TEAM-PM",
    write_scope: [],
    evidence_path: ".odin/audit/session-1/",
    current_task: "parked",
    staffed_by: "A/EXEC-PM",
    parent_surface_ref: "surface:87",
    column_index: 1,
    team_letter: "B",
    ...overrides
  };
}

describe("boot receipt: conditional Team-B staffing fields", () => {
  it("accepts a complete Team-B receipt", () => {
    const result = validateBootReceipt(baseReceipt());
    expect(result.valid).toBe(true);
  });

  it("hard-fails a Team-B receipt missing the staffing-audit fields", () => {
    const receipt = baseReceipt();
    delete receipt.staffed_by;
    delete receipt.parent_surface_ref;
    delete receipt.column_index;
    delete receipt.team_letter;
    const result = validateBootReceipt(receipt);
    expect(result.valid).toBe(false);
    for (const field of ["staffed_by", "parent_surface_ref", "column_index", "team_letter"]) {
      expect(result.missing).toContain(field);
    }
  });

  it("does not require staffing fields on a Team-A (executive office) receipt", () => {
    const receipt = baseReceipt({ team: "A", role: "EXEC ASST", reports_to: "A/EXEC-PM" });
    delete receipt.staffed_by;
    delete receipt.parent_surface_ref;
    delete receipt.column_index;
    delete receipt.team_letter;
    const result = validateBootReceipt(receipt);
    expect(result.valid).toBe(true);
  });

  it("rejects self-staffing (staffed_by other than the canonical authority)", () => {
    const result = validateBootReceipt(baseReceipt({ staffed_by: "B/TEAM-PM" }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("staffed_by");
  });

  it("rejects a team_letter that does not match the team prefix", () => {
    const result = validateBootReceipt(baseReceipt({ team_letter: "C" }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("team_letter");
  });
});
