import { describe, expect, it } from "vitest";
import {
  VERSION,
  createProtocolService,
  getCloseoutChecklist,
  getDelegationPacket,
  getRoleProfile,
  getRuntimeNotice,
  getStartupPacket,
  validateBootReceipt,
  validateDelegationPacket,
  validateTeamManifest
} from "../../src/protocol/index.js";
import type { ProtocolData } from "../../src/protocol/index.js";

function minimalProtocolData(): ProtocolData {
  return {
    protocol: "# Test protocol",
    roles: {
      roles: {
        EXEC_LEAD_PM: {
          title: "EXEC LEAD PM"
        }
      }
    },
    topology: {
      default_topology: {
        executive_office: ["A/EXEC-LEAD-PM"]
      }
    },
    modelProfiles: {
      profiles: {
        "A/EXEC-PM": {
          harness: "fallback"
        },
        "A/EXEC-LEAD-PM": {
          harness: "mapped"
        }
      }
    },
    closeout: {
      modes: {
        FULL_SESSION_SHUTDOWN: {
          required_steps: []
        }
      }
    },
    delegation: {
      delegation_contract: {
        required_fields: [],
        authority_fields: [],
        visibility_fields: [],
        receipt_types: ["SCP-DELEGATE"]
      }
    },
    bootReceipt: {
      required_fields: []
    },
    teamManifest: {
      required_fields: []
    },
    bootstrapSkill: "# Test bootstrap skill",
    skillReferences: {
      bootReceiptExamples: "# Boot examples",
      canonicalIntroductionPrompt: "# Canonical prompt",
      harnessSkillTargets: "# Harness targets",
      teamBootstrapRunbook: "# Team bootstrap"
    }
  };
}

describe("ODIN protocol helpers", () => {
  it("builds a default startup packet with one pod", () => {
    const packet = getStartupPacket();

    expect(packet.version).toBe(VERSION);
    expect(packet.role).toBe("A/EXEC-PM");
    expect(packet.pods).toBe(1);
    expect(packet.resourcesToRead).toContain("odin://protocol/main");
    expect(packet.resourcesToRead).toContain("odin://protocol/delegation");
    expect(packet.resourcesToRead).toContain("odin://protocol/receipts/boot");
    expect(packet.resourcesToRead).toContain("odin://protocol/skill-references/team-bootstrap-runbook");
    expect(packet.resourcesToRead).toContain(".odin/handoffs/");
    expect(packet.startupPrompt).toContain("Bootstrap executive office plus 1 development pod");
    expect(packet.startupPrompt).not.toContain("$delegate");
    expect(packet.modelProfile).toMatchObject({ harness: "Codex CLI" });
  });

  it("returns role profiles by generic role name", () => {
    const profile = getRoleProfile("B/ODIN") as { title: string };

    expect(profile.title).toBe("TEAM ODIN");
  });

  it("maps multi-underscore executive roles to hyphenated model-profile slots", () => {
    const service = createProtocolService({
      path: (...segments: string[]) => segments.join("/"),
      load: minimalProtocolData
    });

    const packet = service.getStartupPacket({ role: "EXEC_LEAD_PM" });

    expect(packet.modelProfile).toMatchObject({ harness: "mapped" });
  });

  it("validates boot receipt required fields", () => {
    const result = validateBootReceipt({
      role: "EXEC PM",
      authority_layer: "executive",
      team: "A"
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toContain("terminal_locator");
  });

  it("warns when non-exec receipt omits staffing audit fields", () => {
    const result = validateBootReceipt({
      role: "B/DEV-1",
      authority_layer: "implementation",
      team: "B",
      terminal_locator: "pane-2",
      branch: "main",
      cwd: ".",
      model_harness: "Codex CLI",
      permission_mode: "workspace-write",
      may_implement: true,
      may_qa_accept: false,
      reports_to: "B/TEAM-PM",
      write_scope: ["src/x.ts"],
      evidence_path: ".odin/evidence",
      current_task: "implement x"
    });

    expect(result.warnings.some((w) => w.includes("staffed_by"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("parent_surface_ref"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("column_index"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("team_letter"))).toBe(true);
  });

  it("warns when staffed_by is not the canonical A/EXEC-PM authority", () => {
    const result = validateBootReceipt({
      role: "B/DEV-1",
      authority_layer: "implementation",
      team: "B",
      terminal_locator: "pane-2",
      branch: "main",
      cwd: ".",
      model_harness: "Codex CLI",
      permission_mode: "workspace-write",
      may_implement: true,
      may_qa_accept: false,
      reports_to: "B/TEAM-PM",
      write_scope: ["src/x.ts"],
      evidence_path: ".odin/evidence",
      current_task: "implement x",
      staffed_by: "B/TEAM-PM",
      parent_surface_ref: "surface:7",
      column_index: 1,
      team_letter: "B"
    });

    expect(result.warnings.some((w) => w.includes("staffing authority belongs solely to A/EXEC-PM"))).toBe(true);
  });

  it("does not warn about staffing audit on exec-team receipts", () => {
    const result = validateBootReceipt({
      role: "A/EXEC-PM",
      authority_layer: "executive",
      team: "A",
      terminal_locator: "pane-1",
      branch: "main",
      cwd: ".",
      model_harness: "Codex CLI",
      permission_mode: "workspace-write",
      may_implement: false,
      may_qa_accept: false,
      reports_to: "user",
      write_scope: [],
      evidence_path: ".odin/evidence",
      current_task: "bootstrap"
    });

    expect(result.warnings.every((w) => !w.includes("staffing audit"))).toBe(true);
    expect(result.warnings.every((w) => !w.includes("staffed_by"))).toBe(true);
  });

  it("flags invalid column_index types", () => {
    const result = validateBootReceipt({
      role: "B/DEV-1",
      authority_layer: "implementation",
      team: "B",
      terminal_locator: "pane-2",
      branch: "main",
      cwd: ".",
      model_harness: "Codex CLI",
      permission_mode: "workspace-write",
      may_implement: true,
      may_qa_accept: false,
      reports_to: "B/TEAM-PM",
      write_scope: ["src/x.ts"],
      evidence_path: ".odin/evidence",
      current_task: "implement x",
      staffed_by: "A/EXEC-PM",
      parent_surface_ref: "surface:7",
      column_index: -1,
      team_letter: "B"
    });

    expect(result.invalid).toContain("column_index");
  });

  it("accepts a minimally complete team manifest", () => {
    const result = validateTeamManifest({
      session_id: "session-1",
      topology: {},
      executive_office: ["A/EXEC-PM", "A/EXEC-ODIN"],
      development_pods: ["B"],
      odin_mesh: {},
      model_profile: {},
      handoff_sources: ["docs/handoffs/"],
      startup_objectives: ["bootstrap"]
    });

    expect(result.valid).toBe(true);
  });

  it("rejects weakened role slots that omit schema-required fields", () => {
    const result = validateTeamManifest({
      session_id: "session-1",
      topology: {},
      executive_office: ["A/EXEC-PM", "A/EXEC-ODIN"],
      development_pods: ["B"],
      odin_mesh: {},
      model_profile: {},
      handoff_sources: ["docs/handoffs/"],
      startup_objectives: ["bootstrap"],
      role_slots: [
        {
          role_slot: "A/EXEC-ODIN",
          harness: "Codex",
          readiness_status: "PASS",
          layout_locator: { workspace: "workspace:1" },
          scp_context_source: "unknown context source",
          mcp_available: true,
          mcp_version: "0.4.5",
          watches: ["A/EXEC-PM"]
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.invalid).toEqual(
      expect.arrayContaining([
        "role_slots.0.layout_locator.pane",
        "role_slots.0.layout_locator.surface",
        "role_slots.0.scp_context_source"
      ])
    );
  });

  it("rejects each required role slot field when omitted or invalid", () => {
    const baseManifest = {
      session_id: "session-1",
      topology: {},
      executive_office: ["A/EXEC-PM", "A/EXEC-ODIN"],
      development_pods: ["B"],
      odin_mesh: {},
      model_profile: {},
      handoff_sources: ["docs/handoffs/"],
      startup_objectives: ["bootstrap"]
    };
    const validSlot = {
      role_slot: "A/EXEC-ODIN",
      harness: "Codex",
      readiness_status: "PASS",
      layout_locator: { workspace: "workspace:1", pane: "pane:1", surface: "surface:1" },
      scp_context_source: "native odin-scp skill",
      scp_skill_available: true,
      mcp_available: true,
      mcp_version: "0.4.5",
      watches: ["A/EXEC-PM"]
    };

    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["missing role_slot", { ...validSlot, role_slot: undefined }, "role_slots.0.role_slot"],
      ["missing harness", { ...validSlot, harness: undefined }, "role_slots.0.harness"],
      ["missing readiness_status", { ...validSlot, readiness_status: undefined }, "role_slots.0.readiness_status"],
      ["invalid readiness_status", { ...validSlot, readiness_status: "READY" }, "role_slots.0.readiness_status"],
      ["missing layout_locator", { ...validSlot, layout_locator: undefined }, "role_slots.0.layout_locator"],
      ["missing layout workspace", { ...validSlot, layout_locator: { pane: "pane:1", surface: "surface:1" } }, "role_slots.0.layout_locator.workspace"],
      ["missing scp_context_source", { ...validSlot, scp_context_source: undefined }, "role_slots.0.scp_context_source"]
    ];

    for (const [, slot, expectedInvalid] of cases) {
      const result = validateTeamManifest({ ...baseManifest, role_slots: [slot] });
      expect(result.valid).toBe(false);
      expect(result.invalid).toContain(expectedInvalid);
    }
  });

  it("returns full shutdown closeout checklist", () => {
    const checklist = getCloseoutChecklist("FULL_SESSION_SHUTDOWN") as {
      required_steps: string[];
    };

    expect(checklist.required_steps).toContain("quit_each_agent_occupant");
  });

  it("builds and validates native delegation packets", () => {
    const packet = getDelegationPacket({
      sourceRole: "EXEC PM",
      targetRoleSlot: "B/DEV-1",
      task: "Implement bounded change",
      mayImplement: true,
      writeScope: ["src/example.ts"]
    });

    expect(packet.receipt_type).toBe("SCP-DELEGATE");
    expect(validateDelegationPacket(packet).valid).toBe(true);
  });

  it("flags incomplete delegation authority", () => {
    const result = validateDelegationPacket({
      receipt_type: "SCP-DELEGATE",
      source_role: "EXEC PM",
      target_role_slot: "B/DEV-1",
      task: "Implement bounded change",
      scope: "src",
      authority: {},
      report_back: "status",
      visibility: {}
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toContain("authority.may_implement");
    expect(result.missing).toContain("visibility.requires_visible_role_slot");
  });

  it("rejects malformed receipts and delegation receipt types", () => {
    const receipt = validateBootReceipt({
      role: [],
      authority_layer: "executive",
      team: "A",
      terminal_locator: "pane-1",
      branch: "main",
      cwd: ".",
      model_harness: "Codex CLI",
      permission_mode: "workspace-write",
      may_implement: false,
      may_qa_accept: false,
      reports_to: "user",
      write_scope: [],
      evidence_path: ".odin/evidence",
      current_task: "bootstrap"
    });

    expect(receipt.valid).toBe(false);
    expect(receipt.invalid).toContain("role");

    const delegation = validateDelegationPacket({
      receipt_type: "WRONG",
      source_role: "EXEC PM",
      target_role_slot: "B/DEV-1",
      task: "Implement bounded change",
      scope: "src",
      authority: {
        may_implement: true,
        may_qa_accept: false,
        write_scope: ["src/example.ts"],
        read_scope: [],
        prohibited_paths: []
      },
      report_back: "status",
      visibility: {
        requires_visible_role_slot: true,
        hidden_agents_allowed: false,
        delivery_proof_required: true
      }
    });

    expect(delegation.valid).toBe(false);
    expect(delegation.invalid).toContain("receipt_type");
  });

  it("rejects malformed arrays and role-slot syntax", () => {
    const delegation = validateDelegationPacket({
      receipt_type: "SCP-DELEGATE",
      source_role: "EXEC PM",
      target_role_slot: "not-a-visible-slot",
      task: "Implement bounded change",
      scope: "src",
      authority: {
        may_implement: true,
        may_qa_accept: false,
        write_scope: [123],
        read_scope: [{}],
        prohibited_paths: [null]
      },
      report_back: "status",
      visibility: {
        requires_visible_role_slot: true,
        hidden_agents_allowed: false,
        delivery_proof_required: true
      }
    });

    expect(delegation.valid).toBe(false);
    expect(delegation.invalid).toContain("target_role_slot");
    expect(delegation.invalid).toContain("authority.write_scope");
    expect(delegation.invalid).toContain("authority.read_scope");
    expect(delegation.invalid).toContain("authority.prohibited_paths");
  });

  it("rejects malformed manifest arrays", () => {
    const result = validateTeamManifest({
      session_id: "session-1",
      topology: {},
      executive_office: ["not-a-slot"],
      development_pods: ["B"],
      odin_mesh: {},
      model_profile: {},
      handoff_sources: ["docs/handoffs/"],
      startup_objectives: ["bootstrap"]
    });

    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("executive_office.0");
  });

  it("rejects empty required manifest arrays", () => {
    const result = validateTeamManifest({
      session_id: "session-1",
      topology: {},
      executive_office: [],
      development_pods: [],
      odin_mesh: {},
      model_profile: {},
      handoff_sources: [],
      startup_objectives: []
    });

    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("executive_office");
    expect(result.invalid).toContain("development_pods");
    expect(result.invalid).toContain("handoff_sources");
    expect(result.invalid).toContain("startup_objectives");
  });

  it("rejects policy-breaking delegation visibility", () => {
    const result = validateDelegationPacket({
      receipt_type: "SCP-DELEGATE",
      source_role: "EXEC PM",
      target_role_slot: "B/DEV-1",
      task: "Implement bounded change",
      scope: "src",
      authority: {
        may_implement: true,
        may_qa_accept: false,
        write_scope: ["src/example.ts"],
        read_scope: [],
        prohibited_paths: []
      },
      report_back: "status",
      visibility: {
        requires_visible_role_slot: false,
        hidden_agents_allowed: true,
        delivery_proof_required: false
      }
    });

    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("visibility.hidden_agents_allowed");
    expect(result.invalid).toContain("visibility.requires_visible_role_slot");
    expect(result.invalid).toContain("visibility.delivery_proof_required");
  });

  it("rejects combined implementation and QA acceptance authority", () => {
    const delegation = validateDelegationPacket({
      receipt_type: "SCP-DELEGATE",
      source_role: "EXEC PM",
      target_role_slot: "B/DEV-1",
      task: "Implement bounded change",
      scope: "src",
      authority: {
        may_implement: true,
        may_qa_accept: true,
        write_scope: ["src/example.ts"],
        read_scope: [],
        prohibited_paths: []
      },
      report_back: "status",
      visibility: {
        requires_visible_role_slot: true,
        hidden_agents_allowed: false,
        delivery_proof_required: true
      }
    });

    expect(delegation.valid).toBe(false);
    expect(delegation.invalid).toContain("authority.may_qa_accept");
  });

  it("rejects invalid direct startup pod counts", () => {
    expect(() => getStartupPacket({ pods: -1 })).toThrow("Invalid development pod count");
    expect(() => getStartupPacket({ pods: 1.5 })).toThrow("Invalid development pod count");
  });

  it("rejects unknown startup roles", () => {
    expect(() => getStartupPacket({ role: "NOT_A_REAL_ROLE" })).toThrow("Unknown ODIN/SCP role");
  });

  it("reports local runtime cost and privacy boundaries", () => {
    const notice = getRuntimeNotice();

    expect(notice.inferenceProvider).toBe("none");
    expect(notice.hostedService).toBe(false);
    expect(notice.telemetry).toBe("local_optional");
    expect(notice.networkCalls).toBe("none_by_default_optional_on_submit");
    expect(notice.telemetryAutomaticCollection).toBe(false);
    expect(notice.telemetrySubmissionRequiresEndpoint).toBe(true);
    expect(notice.telemetrySubmissionRequiresExplicitInvocation).toBe(true);
    expect(notice.maintainerPaysForUserInference).toBe(false);
    expect(notice.externalOrchestrationBundled).toBe(false);
    expect(notice.notes.join(" ")).toContain("no automatic telemetry collection");
    expect(notice.notes.join(" ")).toContain("only after an endpoint is configured");
  });

  it("exports receipt templates in the fallback protocol snapshot", async () => {
    const { exportProtocolSnapshot } = await import("../../src/protocol/index.js");
    const snapshot = exportProtocolSnapshot();

    expect(snapshot).toHaveProperty("protocol/receipts/boot-receipt.yaml");
    expect(snapshot).toHaveProperty("protocol/receipts/team-manifest.yaml");
    expect(snapshot).toHaveProperty("protocol/bootstrap-skill.md");
    expect(snapshot).toHaveProperty("protocol/skill-references/team-bootstrap-runbook.md");
  });
});
