import { describe, expect, it } from "vitest";
import { evaluateReadinessGate } from "../../src/protocol/service.js";

describe("governed launch readiness gate", () => {
  it("passes a fully governed occupant and allows launch", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "A/EXEC-PM",
        harness: "Codex",
        mcpAvailable: true,
        mcpVersion: "0.4.5",
        scpSkillAvailable: true,
        authStatus: "AUTH_READY",
        firstRunPermissionStatus: "CLEAR",
        modelStatus: "MODEL_READY",
        roleCompatibility: "ACCEPTS_ROLE",
        canHydrateDeferredMcpToolsAtBoot: true,
        nativeSkillInvocation: true,
        occupantState: "BOOTSTRAPPED_IDLE"
      }]
    }) as { overallStatus: string; readinessMatrix: Array<{ status: string; launchAllowed: boolean }> };

    expect(result.overallStatus).toBe("PASS");
    expect(result.readinessMatrix[0]).toMatchObject({ status: "PASS", launchAllowed: true });
  });

  it("fails stale MCP versions with MCP_VERSION_TOO_OLD", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      slots: [{
        roleSlot: "B/DEV-1",
        harness: "Droid",
        mcpAvailable: true,
        mcpVersion: "0.2.1",
        scpSkillAvailable: true,
        authStatus: "AUTH_READY",
        firstRunPermissionStatus: "CLEAR",
        modelStatus: "MODEL_READY",
        roleCompatibility: "ACCEPTS_ROLE",
        occupantState: "BOOTSTRAPPED_IDLE"
      }]
    }) as { activationStatus: string; readinessMatrix: Array<{ status: string; launchAllowed: boolean; activationAllowed: boolean; classifications: string[] }> };

    expect(result.readinessMatrix[0].status).toBe("FAIL");
    expect(result.readinessMatrix[0].launchAllowed).toBe(false);
    expect(result.readinessMatrix[0].activationAllowed).toBe(false);
    expect(result.readinessMatrix[0].classifications).toContain("MCP_VERSION_TOO_OLD");
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_BLOCKED");
  });

  it("honors EXEC PM waiver and substitution statuses", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      slots: [
        {
          roleSlot: "B/DEV-1",
          harness: "Droid",
          authStatus: "AUTH_MISSING",
          waiver: "WAIVED_BY_EXEC_PM",
          occupantState: "BOOTSTRAPPED_IDLE"
        },
        {
          roleSlot: "B/QA-1",
          harness: "Crush",
          mcpAvailable: true,
          mcpVersion: "0.4.5",
          scpSkillAvailable: true,
          authStatus: "AUTH_READY",
          firstRunPermissionStatus: "CLEAR",
          modelStatus: "MODEL_READY",
          roleCompatibility: "ACCEPTS_ROLE",
          waiver: "SUBSTITUTION_APPROVED_BY_EXEC_PM",
          fallbackHarness: "Codex",
          occupantState: "AGENT_SUBSTITUTION_REQUIRED"
        }
      ]
    }) as { readinessMatrix: Array<{ status: string; launchAllowed: boolean; activationAllowed: boolean }> };

    expect(result.readinessMatrix[0]).toMatchObject({ status: "WAIVED_BY_EXEC_PM", launchAllowed: true });
    expect(result.readinessMatrix[1]).toMatchObject({ status: "SUBSTITUTION_APPROVED_BY_EXEC_PM", launchAllowed: true, activationAllowed: false });
  });

  it("blocks empty teams before launch or activation", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      slots: []
    }) as { overallStatus: string; activationStatus: string; readinessMatrix: unknown[] };

    expect(result.overallStatus).toBe("FAIL");
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_BLOCKED");
    expect(result.readinessMatrix).toEqual([]);
  });

  it("blocks rows and team activation when CMUX or EXEC PM authorization is missing", () => {
    const slot = {
      roleSlot: "B/DEV-1",
      harness: "Codex",
      mcpAvailable: true,
      mcpVersion: "0.4.5",
      scpSkillAvailable: true,
      authStatus: "AUTH_READY" as const,
      firstRunPermissionStatus: "CLEAR" as const,
      modelStatus: "MODEL_READY" as const,
      roleCompatibility: "ACCEPTS_ROLE" as const,
      occupantState: "BOOTSTRAPPED_IDLE"
    };

    expect(evaluateReadinessGate({ execPmAuthorized: false, cmuxAvailable: true, userProvisioningAnswer: "yes", slots: [slot] })).toMatchObject({
      overallStatus: "FAIL",
      activationStatus: "TEAM_ACTIVATION_BLOCKED",
      readinessMatrix: [expect.objectContaining({
        status: "FAIL",
        launchAllowed: false,
        activationAllowed: false,
        classifications: expect.arrayContaining(["EXEC_PM_AUTHORIZATION_REQUIRED"])
      })]
    });
    expect(evaluateReadinessGate({ execPmAuthorized: true, cmuxAvailable: false, userProvisioningAnswer: "yes", slots: [slot] })).toMatchObject({
      overallStatus: "FAIL",
      activationStatus: "TEAM_ACTIVATION_BLOCKED",
      readinessMatrix: [expect.objectContaining({
        status: "FAIL",
        launchAllowed: false,
        activationAllowed: false,
        classifications: expect.arrayContaining(["CMUX_UNAVAILABLE"])
      })]
    });
    expect(evaluateReadinessGate({ execPmAuthorized: true, userProvisioningAnswer: "yes", slots: [slot] })).toMatchObject({
      overallStatus: "FAIL",
      activationStatus: "TEAM_ACTIVATION_BLOCKED",
      readinessMatrix: [expect.objectContaining({
        status: "FAIL",
        launchAllowed: false,
        activationAllowed: false,
        classifications: expect.arrayContaining(["CMUX_UNAVAILABLE"])
      })]
    });
  });

  it("fails MCP access without version proof", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "B/DEV-1",
        harness: "Droid",
        mcpAvailable: true,
        scpSkillAvailable: true,
        authStatus: "AUTH_READY",
        firstRunPermissionStatus: "CLEAR",
        modelStatus: "MODEL_READY",
        roleCompatibility: "ACCEPTS_ROLE",
        occupantState: "BOOTSTRAPPED_IDLE"
      }]
    }) as { overallStatus: string; activationStatus: string; readinessMatrix: Array<{ status: string; launchAllowed: boolean; activationAllowed: boolean; classifications: string[] }> };

    expect(result.overallStatus).toBe("FAIL");
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_BLOCKED");
    expect(result.readinessMatrix[0].status).toBe("FAIL");
    expect(result.readinessMatrix[0].launchAllowed).toBe(false);
    expect(result.readinessMatrix[0].activationAllowed).toBe(false);
    expect(result.readinessMatrix[0].classifications).toContain("MCP_VERSION_UNVERIFIED");
  });

  it("does not let EXEC PM waiver activate failed occupants or hard blockers", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "A/EXEC-ODIN",
        harness: "Codex",
        mcpAvailable: true,
        mcpVersion: "0.2.1",
        scpSkillAvailable: false,
        authStatus: "AUTH_MISSING",
        firstRunPermissionStatus: "DENIED",
        modelStatus: "MODEL_UNREACHABLE",
        roleCompatibility: "REFUSES_ROLE",
        canHydrateDeferredMcpToolsAtBoot: false,
        fullProtocolTextInjected: false,
        occupantState: "FAILED",
        waiver: "WAIVED_BY_EXEC_PM"
      }]
    }) as { overallStatus: string; activationStatus: string; readinessMatrix: Array<{ status: string; launchAllowed: boolean; activationAllowed: boolean; classifications: string[] }> };

    expect(result.overallStatus).toBe("FAIL");
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_BLOCKED");
    expect(result.readinessMatrix[0].status).toBe("NON_GOVERNED_ONE_SHOT_ONLY");
    expect(result.readinessMatrix[0].launchAllowed).toBe(false);
    expect(result.readinessMatrix[0].activationAllowed).toBe(false);
    expect(result.readinessMatrix[0].classifications).toEqual(
      expect.arrayContaining(["MCP_VERSION_TOO_OLD", "BLOCKED_BY_PERMISSION", "MODEL_UNREACHABLE", "ROLE_COMPATIBILITY_FAILED", "UNSUITABLE_FOR_ODIN_ROLE", "NON_GOVERNED_ONE_SHOT_ONLY"])
    );
  });

  it("does not let substitution approval activate blocked occupants without a validated fallback", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "B/DEV-1",
        harness: "Crush",
        mcpAvailable: true,
        mcpVersion: "0.2.1",
        scpSkillAvailable: true,
        authStatus: "AUTH_READY",
        firstRunPermissionStatus: "PROMPT_WAITING",
        modelStatus: "MODEL_UNREACHABLE",
        roleCompatibility: "REFUSES_ROLE",
        occupantState: "AGENT_SUBSTITUTION_REQUIRED",
        waiver: "SUBSTITUTION_APPROVED_BY_EXEC_PM",
        fallbackHarness: "Codex"
      }]
    }) as { overallStatus: string; activationStatus: string; readinessMatrix: Array<{ status: string; launchAllowed: boolean; activationAllowed: boolean; classifications: string[] }> };

    expect(result.overallStatus).toBe("FAIL");
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_BLOCKED");
    expect(result.readinessMatrix[0].status).toBe("FAIL");
    expect(result.readinessMatrix[0].launchAllowed).toBe(false);
    expect(result.readinessMatrix[0].activationAllowed).toBe(false);
  });

  it("allows non-required vacant role slots without treating them as non-governed agents", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "B/SHADOW-1",
        harness: "none",
        occupantState: "VACANT_ROLE_SLOT",
        required: false
      }]
    }) as { overallStatus: string; activationStatus: string; readinessMatrix: Array<{ status: string; launchAllowed: boolean; activationAllowed: boolean; classifications: string[] }> };

    expect(result.overallStatus).toBe("PASS");
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_ALLOWED");
    expect(result.readinessMatrix[0].status).toBe("PASS");
    expect(result.readinessMatrix[0].launchAllowed).toBe(true);
    expect(result.readinessMatrix[0].activationAllowed).toBe(true);
    expect(result.readinessMatrix[0].classifications).toContain("VACANT_ROLE_SLOT");
    expect(result.readinessMatrix[0].classifications).not.toContain("NON_GOVERNED_ONE_SHOT_ONLY");
  });

  it("allows substitution activation only for explicitly optional vacant fallback slots", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "B/QA-1",
        harness: "none",
        occupantState: "VACANT_ROLE_SLOT",
        required: false,
        waiver: "SUBSTITUTION_APPROVED_BY_EXEC_PM",
        fallbackHarness: "Codex"
      }]
    }) as { overallStatus: string; activationStatus: string; readinessMatrix: Array<{ status: string; launchAllowed: boolean; activationAllowed: boolean; classifications: string[] }> };

    expect(result.overallStatus).toBe("PASS");
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_ALLOWED");
    expect(result.readinessMatrix[0]).toMatchObject({
      status: "SUBSTITUTION_APPROVED_BY_EXEC_PM",
      launchAllowed: true,
      activationAllowed: true
    });
    expect(result.readinessMatrix[0].classifications).toContain("VACANT_ROLE_SLOT");
  });

  it("blocks vacant role slots unless required=false is explicit", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "B/SHADOW-1",
        harness: "none",
        occupantState: "VACANT_ROLE_SLOT"
      }]
    }) as { overallStatus: string; activationStatus: string; readinessMatrix: Array<{ status: string; launchAllowed: boolean; activationAllowed: boolean; classifications: string[] }> };

    expect(result.overallStatus).toBe("FAIL");
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_BLOCKED");
    expect(result.readinessMatrix[0].status).toBe("FAIL");
    expect(result.readinessMatrix[0].launchAllowed).toBe(false);
    expect(result.readinessMatrix[0].activationAllowed).toBe(false);
    expect(result.readinessMatrix[0].classifications).toContain("VACANT_SLOT_REQUIREMENT_UNVERIFIED");
  });

  it("marks short-prompt harnesses as non-governed one-shot only", () => {
    const result = evaluateReadinessGate({
      slots: [{
        roleSlot: "B/SHADOW-1",
        harness: "unknown",
        mcpAvailable: false,
        scpSkillAvailable: false,
        fullProtocolTextInjected: false,
        authStatus: "AUTH_READY",
        firstRunPermissionStatus: "CLEAR",
        modelStatus: "MODEL_READY",
        roleCompatibility: "ACCEPTS_ROLE"
      }]
    }) as { readinessMatrix: Array<{ status: string; classifications: string[]; notes: string[] }> };

    expect(result.readinessMatrix[0].classifications).toContain("NON_GOVERNED_ONE_SHOT_ONLY");
    expect(result.readinessMatrix[0].notes.join("\n")).toContain("no ongoing authority");
  });

  it("does not treat MCP availability alone as governed SCP context", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "B/DEV-1",
        harness: "Droid",
        mcpAvailable: true,
        mcpVersion: "0.4.5",
        scpSkillAvailable: false,
        fullProtocolTextInjected: false,
        authStatus: "AUTH_READY",
        firstRunPermissionStatus: "CLEAR",
        modelStatus: "MODEL_READY",
        roleCompatibility: "ACCEPTS_ROLE",
        occupantState: "BOOTSTRAPPED_IDLE"
      }]
    }) as { overallStatus: string; activationStatus: string; readinessMatrix: Array<{ status: string; launchAllowed: boolean; activationAllowed: boolean; classifications: string[] }> };

    expect(result.overallStatus).toBe("FAIL");
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_BLOCKED");
    expect(result.readinessMatrix[0]).toMatchObject({
      status: "NON_GOVERNED_ONE_SHOT_ONLY",
      launchAllowed: false,
      activationAllowed: false
    });
    expect(result.readinessMatrix[0].classifications).toEqual(expect.arrayContaining(["SCP_SKILL_MISSING", "NON_GOVERNED_ONE_SHOT_ONLY"]));
  });

  it("treats an MCP bootstrap resource as launchable context but blocks governed activation without an uptake proof", () => {
    // Updated for SLICE-ODIN-GOVERNED-READINESS-DEV-001 (A/EXEC-PM test-only amendment): an MCP
    // resource is launchable SCP context, but fail-closed governed activation requires verified
    // protocol uptake. MCP-resource presence alone no longer reaches TEAM_ACTIVATION_ALLOWED.
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "B/DEV-1",
        harness: "Droid",
        mcpAvailable: true,
        mcpVersion: "0.4.5",
        scpSkillAvailable: false,
        protocolTextSource: "mcp_resource",
        authStatus: "AUTH_READY",
        firstRunPermissionStatus: "CLEAR",
        modelStatus: "MODEL_READY",
        roleCompatibility: "ACCEPTS_ROLE",
        occupantState: "BOOTSTRAPPED_IDLE"
      }]
    }) as { overallStatus: string; activationStatus: string; readinessMatrix: Array<{ status: string; launchAllowed: boolean; activationAllowed: boolean; governedReadiness: string; classifications: string[]; notes: string[] }> };

    expect(result.overallStatus).toBe("PASS");
    expect(result.readinessMatrix[0].status).toBe("PASS");
    expect(result.readinessMatrix[0].launchAllowed).toBe(true);
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_BLOCKED");
    expect(result.readinessMatrix[0].activationAllowed).toBe(false);
    expect(result.readinessMatrix[0].governedReadiness).toBe("FIXABLE_BLOCKED");
    expect(result.readinessMatrix[0].classifications).toContain("SCP_SKILL_MISSING");
    expect(result.readinessMatrix[0].classifications).not.toContain("NON_GOVERNED_ONE_SHOT_ONLY");
  });

  it("allows governed activation for an MCP-only harness with a verified governed-context uptake proof", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "B/DEV-1",
        harness: "Droid",
        mcpAvailable: true,
        mcpVersion: "0.4.5",
        scpSkillAvailable: false,
        protocolTextSource: "mcp_resource",
        authStatus: "AUTH_READY",
        firstRunPermissionStatus: "CLEAR",
        modelStatus: "MODEL_READY",
        roleCompatibility: "ACCEPTS_ROLE",
        occupantState: "BOOTSTRAPPED_IDLE",
        hooksAvailable: true,
        governedContextProof: {
          schema: "odin.governed_context_proof.v1",
          role: "B/DEV-1",
          harness: "Droid",
          source_type: "mcp_bootstrap",
          control_source: { marker: "SCP_PUBLIC_VERSION: 0.4.9" },
          uptake_receipt: { method: "quoted_marker", evidence_marker: "SCP_PUBLIC_VERSION: 0.4.9", observed: true, observed_at: "2026-06-04T05:00:00Z" },
          generated_at: "2026-06-04T05:00:00Z"
        }
      }]
    }) as { activationStatus: string; readinessMatrix: Array<{ activationAllowed: boolean; governedReadiness: string }> };

    expect(result.readinessMatrix[0].governedReadiness).toBe("GOVERNED_READY");
    expect(result.readinessMatrix[0].activationAllowed).toBe(true);
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_ALLOWED");
  });

  it("surfaces a role-compatibility smoke test and supported secret providers without secrets", () => {
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "A/EXEC-PM",
        harness: "Codex",
        mcpAvailable: true,
        mcpVersion: "0.4.5",
        scpSkillAvailable: true,
        authStatus: "AUTH_READY",
        firstRunPermissionStatus: "CLEAR",
        modelStatus: "MODEL_READY",
        roleCompatibility: "ACCEPTS_ROLE",
        occupantState: "BOOTSTRAPPED_IDLE"
      }]
    }) as {
      roleCompatibilitySmokeTest: { questions: string[]; failClassification: string; runBeforeAssignment: boolean };
      supportedSecretProviders: string[];
    };

    expect(result.roleCompatibilitySmokeTest.questions).toHaveLength(4);
    expect(result.roleCompatibilitySmokeTest.questions.join(" ")).toMatch(/fictional roleplay/);
    expect(result.roleCompatibilitySmokeTest.failClassification).toBe("ROLE_COMPATIBILITY_FAILED");
    expect(result.roleCompatibilitySmokeTest.runBeforeAssignment).toBe(true);
    expect(result.supportedSecretProviders).toEqual(
      expect.arrayContaining(["Doppler", "1Password CLI (op)", "environment variable names", "GitHub auth", "local provider config files"])
    );
    expect(JSON.stringify(result)).not.toMatch(/sk-[A-Za-z0-9]|bearer\s+[A-Za-z0-9]/i);
  });

  it("does not downgrade a proof-only governed slot lacking legacy context-source fields (hardening)", () => {
    // QA LOW finding (SLICE-ODIN-GOVERNED-READINESS-HARDENING-DEV-001): a valid governed-context
    // proof with no legacy protocolTextSource/scpSkillAvailable must SUPPLY the context source,
    // not be downgraded to NON_GOVERNED_ONE_SHOT_ONLY via the legacy path. Fail-closed rules hold.
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "B/DEV-1",
        harness: "Claude Code",
        authStatus: "AUTH_READY",
        firstRunPermissionStatus: "CLEAR",
        modelStatus: "MODEL_READY",
        roleCompatibility: "ACCEPTS_ROLE",
        occupantState: "BOOTSTRAPPED_IDLE",
        hooksAvailable: true,
        deliveryState: "DELIVERED_ACKED",
        governedContextProof: {
          schema: "odin.governed_context_proof.v1",
          role: "B/DEV-1",
          harness: "Claude Code",
          source_type: "native_skill",
          control_source: { marker: "SCP_PUBLIC_VERSION: 0.4.9" },
          uptake_receipt: { method: "quoted_marker", evidence_marker: "SCP_PUBLIC_VERSION: 0.4.9", observed: true, observed_at: "2026-06-04T05:00:00Z" },
          generated_at: "2026-06-04T05:00:00Z"
        }
      }]
    }) as { activationStatus: string; readinessMatrix: Array<{ status: string; activationAllowed: boolean; governedReadiness: string; scpContextSources: string[]; classifications: string[] }> };

    const row = result.readinessMatrix[0];
    expect(row.classifications).not.toContain("NON_GOVERNED_ONE_SHOT_ONLY");
    expect(row.scpContextSources).toContain("native sentinel-coordination-protocol skill");
    expect(row.governedReadiness).toBe("GOVERNED_READY");
    expect(row.status).toBe("PASS");
    expect(row.activationAllowed).toBe(true);
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_ALLOWED");
  });

  it("fails closed when a legacy context-source contradicts the governed-context proof (hardening)", () => {
    // Legacy says MCP-resource; proof attests native-skill. Must fail closed as a conflict, never
    // silently pick the more permissive source.
    const result = evaluateReadinessGate({
      execPmAuthorized: true,
      cmuxAvailable: true,
      userProvisioningAnswer: "yes",
      slots: [{
        roleSlot: "B/DEV-1",
        harness: "Claude Code",
        protocolTextSource: "mcp_resource",
        authStatus: "AUTH_READY",
        firstRunPermissionStatus: "CLEAR",
        modelStatus: "MODEL_READY",
        roleCompatibility: "ACCEPTS_ROLE",
        occupantState: "BOOTSTRAPPED_IDLE",
        hooksAvailable: true,
        deliveryState: "DELIVERED_ACKED",
        governedContextProof: {
          schema: "odin.governed_context_proof.v1",
          role: "B/DEV-1",
          harness: "Claude Code",
          source_type: "native_skill",
          control_source: { marker: "SCP_PUBLIC_VERSION: 0.4.9" },
          uptake_receipt: { method: "quoted_marker", evidence_marker: "SCP_PUBLIC_VERSION: 0.4.9", observed: true, observed_at: "2026-06-04T05:00:00Z" },
          generated_at: "2026-06-04T05:00:00Z"
        }
      }]
    }) as { activationStatus: string; readinessMatrix: Array<{ status: string; launchAllowed: boolean; activationAllowed: boolean; governedReadiness: string; classifications: string[] }> };

    const row = result.readinessMatrix[0];
    expect(row.classifications).toContain("CONTEXT_SOURCE_CONFLICT");
    expect(row.status).toBe("FAIL");
    expect(row.launchAllowed).toBe(false);
    expect(row.activationAllowed).toBe(false);
    expect(row.governedReadiness).toBe("FIXABLE_BLOCKED");
    expect(result.activationStatus).toBe("TEAM_ACTIVATION_BLOCKED");
  });
});
