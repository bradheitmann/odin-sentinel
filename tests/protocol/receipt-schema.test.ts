import { describe, expect, it } from "vitest";
import { getBootReceiptExamples, getBootReceiptSchema, validateBootReceipt, validateTeamManifest } from "../../src/protocol/service.js";

function receipt(overrides: Record<string, unknown> = {}) {
  return {
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
    current_task: "bootstrap",
    ...overrides
  };
}

describe("canonical receipt and manifest schemas", () => {
  it("accepts empty-array write scope for unassigned no-write roles", () => {
    expect(validateBootReceipt(receipt()).valid).toBe(true);
  });

  it("rejects null write scope with a repair hint", () => {
    const result = validateBootReceipt(receipt({ write_scope: null }));

    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("write_scope");
    expect(result.warnings.join("\n")).toContain("use write_scope: []");
  });

  it("rejects string write scope values", () => {
    const result = validateBootReceipt(receipt({ write_scope: "src/x.ts" }));

    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("write_scope");
  });

  it("returns canonical examples for PM, ODIN, DEV, QA, and SHADOW", () => {
    const examples = getBootReceiptExamples();

    expect(Object.keys(examples).sort()).toEqual(["dev_waiting_for_scope", "odin", "pm", "qa", "shadow"]);
    for (const example of Object.values(examples)) {
      expect(validateBootReceipt(example).valid).toBe(true);
    }
  });

  it("exposes schema metadata and version drift warnings", () => {
    const schema = getBootReceiptSchema();
    const result = validateBootReceipt(receipt({ mcp_version: "0.2.1" }));

    expect(schema.minimumCompatibleMcpVersion).toBe("0.4.5");
    expect(result.invalid).toContain("mcp_version");
    expect(result.warnings.join("\n")).toContain("MCP_VERSION_TOO_OLD");
  });

  it("validates team manifest watcher assignments and governed locators", () => {
    const result = validateTeamManifest({
      session_id: "session-1",
      topology: {},
      executive_office: ["A/EXEC-PM", "A/EXEC-ODIN"],
      development_pods: ["B"],
      odin_mesh: {},
      model_profile: {},
      handoff_sources: [".odin/handoffs/"],
      startup_objectives: ["bootstrap"],
      role_slots: [
        {
          role_slot: "A/EXEC-ODIN",
          harness: "Codex",
          readiness_status: "PASS",
          scp_context_source: "native odin-scp skill",
          scp_skill_available: true,
          mcp_available: true,
          mcp_version: "0.4.5",
          layout_locator: { workspace: "workspace:1", pane: "pane:a", surface: "surface:odin" },
          watches: ["A/EXEC-PM", "B/ODIN"]
        }
      ]
    });

    expect(result.valid).toBe(true);
  });
});
