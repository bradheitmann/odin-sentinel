import { describe, expect, it } from "vitest";
import {
  CHILD_AGENT_DIAGNOSTIC_QUESTIONS,
  ODIN_DIAGNOSTIC_QUESTIONS,
  compileSessionReport,
  getAxDiagnosticQuestions,
  type AxDiagnostics,
  type DiagnosticStatus,
  type SessionReportInput
} from "../../src/telemetry/index.js";

function check(status: DiagnosticStatus, detail?: string) {
  return { status, detail };
}

const baseHarnessFailures = {
  openHandsAuthApiCredentials: check("blocked", "OpenHands auth/API credentials unavailable"),
  kiloCodeLogin: check("blocked", "KiloCode login missing"),
  gooseLocalInferenceStall: check("blocked", "Goose local inference stalled"),
  crushPermissionPrompt: check("blocked", "Crush permission prompt blocked execution"),
  piRoleRefusal: check("blocked", "Pi refused assigned role"),
  staleMcpVersion: check("blocked", "child reported old MCP version")
};

function makeAx(): AxDiagnostics {
  return {
    roleSlots: [
      {
        role: "B/DEV-1",
        team: "B",
        harness: "OpenHands",
        model: "gpt-test",
        locator: { workspace: "workspace-main", pane: "pane-2", surface: "surface-left" },
        mcpAccess: check("verified"),
        mcpVersion: "0.2.1",
        minimumCompatibleMcpVersion: "0.4.5",
        skillAccess: check("missing", "missing native skill"),
        fullProtocolTextReceived: check("missing", "short boot prompt only"),
        promptType: "short_boot_prompt",
        operatorAuthorityRecognized: check("unknown"),
        readinessStatus: "blocked",
        bootReceiptStatus: "missing",
        activeWatchStatus: "not_applicable",
        blockerClassification: ["stale_mcp_version", "missing_skill", "short_prompt", "auth_blocker"]
      },
      {
        role: "A/EXEC-ODIN",
        team: "A",
        harness: "Codex CLI",
        model: "reasoning",
        locator: { workspace: "workspace-split", pane: "pane-9", surface: "tab-4" },
        mcpAccess: check("verified"),
        skillAccess: check("verified"),
        fullProtocolTextReceived: check("verified"),
        promptType: "full_protocol",
        operatorAuthorityRecognized: check("verified"),
        readinessStatus: "degraded",
        bootReceiptStatus: "emitted",
        activeWatchStatus: "passive",
        blockerClassification: ["passive_odin", "split_workspace", "tab_heavy_layout"]
      }
    ],
    childAgentQuestions: [...CHILD_AGENT_DIAGNOSTIC_QUESTIONS],
    odinQuestions: [...ODIN_DIAGNOSTIC_QUESTIONS],
    harnessFailures: baseHarnessFailures,
    layout: {
      sameWorkspace: false,
      splitWorkspace: true,
      spatialPodLayout: false,
      tabHeavyLayout: true,
      cmuxAvailable: false,
      degradedLayoutWarnings: ["split workspace", "tab-heavy layout"]
    },
    launchRunbook: {
      deterministicRunbookFollowed: false,
      firstImprovisationPoint: "manual child-agent interview",
      missingPrompts: ["exact polling prompt"],
      missingTools: ["readiness probe"],
      missingSchemas: ["AX report schema"]
    },
    readinessGates: {
      childMcpVerified: check("missing"),
      skillVerified: check("missing"),
      authVerified: check("blocked"),
      firstRunPromptVerified: check("missing"),
      modelSmokeVerified: check("blocked"),
      roleCompatibilityVerified: check("blocked")
    },
    versions: {
      currentServerVersion: "0.4.5",
      minimumCompatibleVersion: "0.4.5",
      childReportedMcpVersions: [{ role: "B/DEV-1", version: "0.2.1" }],
      driftWarnings: ["B/DEV-1 reported 0.2.1 below 0.4.5"]
    },
    artifacts: {
      planningArtifactsLocalOnly: true,
      publicTemplatesSanitized: true,
      privateArtifactWarnings: []
    },
    pastedChildContextWindows: [
      {
        role: "B/DEV-1",
        text: "Authorization: Bearer abcDEF0123456789xyz\nprovider=openai blocker=auth_blocker"
      }
    ]
  };
}

function makeInput(): SessionReportInput {
  return {
    teamCount: 3,
    violations: [],
    halts: [],
    layoutDriftEvents: 2,
    peakContextPct: 74,
    closeoutClean: false,
    modelSignals: [],
    ax: makeAx()
  };
}

describe("AX reporting telemetry helpers", () => {
  it("ships standard child-agent and ODIN diagnostic question sets", () => {
    expect(getAxDiagnosticQuestions("child")).toHaveLength(8);
    expect(getAxDiagnosticQuestions("odin")).toHaveLength(6);
    expect(getAxDiagnosticQuestions()).toHaveLength(14);
    expect(getAxDiagnosticQuestions("child").join(" ")).toContain("role slot");
    expect(getAxDiagnosticQuestions("child").join(" ")).toContain("MCP access");
    expect(getAxDiagnosticQuestions("child").join(" ")).toContain("native skill access");
    expect(getAxDiagnosticQuestions("child").join(" ")).toContain("full protocol text");
    expect(getAxDiagnosticQuestions("child").join(" ")).toContain("operator authority");
    expect(getAxDiagnosticQuestions("child").join(" ")).toContain("boot receipt");
    expect(getAxDiagnosticQuestions("child").join(" ")).toContain("blocker");
    expect(getAxDiagnosticQuestions("child").join(" ")).toContain("launch smoother");
    expect(getAxDiagnosticQuestions("odin").join(" ")).toContain("poll actively");
    expect(getAxDiagnosticQuestions("odin").join(" ")).toContain("watching");
    expect(getAxDiagnosticQuestions("odin").join(" ")).toContain("plan mode");
    expect(getAxDiagnosticQuestions("odin").join(" ")).toContain("exact polling prompt");
    expect(getAxDiagnosticQuestions("odin").join(" ")).toContain("terminal states");
  });

  it("compiles observed failure families into a concise redacted AX summary", () => {
    const report = compileSessionReport(makeInput(), "0.4.5");

    expect(report.ax?.roleSlots?.[0]).toMatchObject({
      role: "B/DEV-1",
      team: "B",
      harness: "OpenHands",
      model: "gpt-test",
      locator: { workspace: "workspace-main", pane: "pane-2", surface: "surface-left" },
      mcpVersion: "0.2.1",
      minimumCompatibleMcpVersion: "0.4.5",
      promptType: "short_boot_prompt",
      readinessStatus: "blocked",
      bootReceiptStatus: "missing"
    });
    expect(report.axSummary?.blockerClassifications).toEqual(
      expect.arrayContaining([
        "stale_mcp_version",
        "missing_skill",
        "short_prompt",
        "passive_odin",
        "split_workspace",
        "tab_heavy_layout",
        "auth_blocker",
        "permission_blocker",
        "local_inference_stall",
        "role_refusal",
        "missing_protocol_text",
        "receipt_missing",
        "runbook_improvisation"
      ])
    );
    expect(report.axSummary?.degradedLayout).toBe(true);
    expect(report.axSummary?.driftWarningCount).toBe(1);
    expect(report.ax?.readinessGates?.authVerified.status).toBe("blocked");
    expect(report.ax?.artifacts?.planningArtifactsLocalOnly).toBe(true);
    expect(JSON.stringify(report)).toContain("Bearer <TOKEN>");
    expect(JSON.stringify(report)).not.toContain("abcDEF0123456789xyz");
  });

  it("documents direct compile as a redaction boundary, not a strict schema boundary", () => {
    const input = {
      ...makeInput(),
      extraTopLevel: "retained diagnostic metadata",
      violations: [{ class: "custom", unexpectedNested: "retained nested metadata" }],
      ax: {
        roleSlots: [
          {
            role: "B/DEV-1",
            team: "B",
            harness: "OpenHands",
            model: "gpt-test",
            locator: { workspace: "workspace-main", pane: "pane-2", surface: "surface-left" },
            mcpAccess: check("verified"),
            skillAccess: check("missing", "native skill"),
            fullProtocolTextReceived: check("missing", "short prompt"),
            promptType: "short_boot_prompt" as const,
            operatorAuthorityRecognized: check("unknown"),
            readinessStatus: "blocked" as const,
            bootReceiptStatus: "missing" as const,
            activeWatchStatus: "not_applicable" as const,
            blockerClassification: ["auth_blocker" as const],
            childContextText: "OPENAI_API_KEY=sk-proj-0123456789abcdefghijklmnopqrstuv_0123456789",
            unexpectedNested: "retained AX metadata"
          }
        ]
      }
    } as unknown as SessionReportInput;

    const report = compileSessionReport(input, "0.4.5") as Record<string, unknown>;

    expect(report.extraTopLevel).toBe("retained diagnostic metadata");
    expect((report.violations as Array<Record<string, unknown>>)[0].unexpectedNested).toBe("retained nested metadata");
    expect(JSON.stringify(report)).toContain("unexpectedNested");
    expect(JSON.stringify(report)).not.toContain("sk-proj-0123456789abcdefghijklmnopqrstuv_0123456789");
    expect(JSON.stringify(report)).toContain("<ENV_VALUE>");
  });
});
