import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../../src/mcp/server.js";

async function connectClient() {
  const server = createServer();
  const client = new Client({
    name: "odin-sentinel-test",
    version: "1.0.0"
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

function parseTextResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  const first = content[0];
  if (!first || first.type !== "text") {
    throw new Error("Expected text tool result");
  }

  return JSON.parse(first.text ?? "");
}

describe("ODIN MCP server", () => {
  it("registers the expected tools and resources", async () => {
    const { client, server } = await connectClient();

    try {
      const tools = await client.listTools();
      const resources = await client.listResources();

      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "odin.compile_session_report",
        "odin.compute_human_cmux_quad_layout",
        "odin.compute_surface_layout",
        "odin.compute_surface_layout_gate",
        "odin.evaluate_escalation_gate",
        "odin.evaluate_readiness_gate",
        "odin.export_protocol_snapshot",
        "odin.get_activation_gates",
        "odin.get_active_watch_packet",
        "odin.get_boot_receipt_examples",
        "odin.get_boot_receipt_schema",
        "odin.get_bootstrap_skill",
        "odin.get_closeout_checklist",
        "odin.get_delegation_packet",
        "odin.get_harness_probe_matrix",
        "odin.get_mission_frontrun_pack",
        "odin.get_onboarding_plan",
        "odin.get_role_card",
        "odin.get_role_profile",
        "odin.get_runtime_notice",
        "odin.get_startup_packet",
        "odin.get_telemetry_config",
        "odin.get_version",
        "odin.preview_telemetry_redaction",
        "odin.submit_session_report",
        "odin.validate_boot_receipt",
        "odin.validate_cmux_delivery_proof",
        "odin.validate_delegation_packet",
        "odin.validate_instruction_read_proof",
        "odin.validate_remediation_packet",
        "odin.validate_team_manifest"
      ]);
      expect(resources.resources.map((resource) => resource.uri).sort()).toEqual([
        "odin://protocol/bootstrap-skill",
        "odin://protocol/closeout",
        "odin://protocol/delegation",
        "odin://protocol/main",
        "odin://protocol/model-profiles",
        "odin://protocol/receipts/boot",
        "odin://protocol/receipts/team-manifest",
        "odin://protocol/recipe-capture",
        "odin://protocol/role-cards/dev-worker",
        "odin://protocol/role-cards/exec-asst",
        "odin://protocol/role-cards/exec-pm",
        "odin://protocol/role-cards/qa-worker",
        "odin://protocol/role-cards/team-pm",
        "odin://protocol/roles",
        "odin://protocol/skill-references/boot-receipt-examples",
        "odin://protocol/skill-references/canonical-introduction-prompt",
        "odin://protocol/skill-references/harness-skill-targets",
        "odin://protocol/skill-references/team-bootstrap-runbook",
        "odin://protocol/step-up-ladder",
        "odin://protocol/topology"
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("serves resources and tool calls over MCP", async () => {
    const { client, server } = await connectClient();

    try {
      const resources = [
        "odin://protocol/bootstrap-skill",
        "odin://protocol/closeout",
        "odin://protocol/delegation",
        "odin://protocol/main",
        "odin://protocol/model-profiles",
        "odin://protocol/receipts/boot",
        "odin://protocol/receipts/team-manifest",
        "odin://protocol/recipe-capture",
        "odin://protocol/roles",
        "odin://protocol/skill-references/boot-receipt-examples",
        "odin://protocol/skill-references/canonical-introduction-prompt",
        "odin://protocol/skill-references/harness-skill-targets",
        "odin://protocol/skill-references/team-bootstrap-runbook",
        "odin://protocol/step-up-ladder",
        "odin://protocol/topology"
      ];
      const toolCalls = [
        {
          name: "odin.get_delegation_packet",
          arguments: {
            sourceRole: "A/EXEC-PM",
            targetRoleSlot: "B/DEV-1",
            task: "Implement bounded change"
          }
        },
        {
          name: "odin.validate_delegation_packet",
          arguments: {
            packet: {
              receipt_type: "SCP-DELEGATE",
              source_role: "A/EXEC-PM",
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
            }
          }
        },
        {
          name: "odin.get_version",
          arguments: {}
        },
        {
          name: "odin.get_boot_receipt_schema",
          arguments: {}
        },
        {
          name: "odin.get_boot_receipt_examples",
          arguments: {}
        },
        {
          name: "odin.get_runtime_notice",
          arguments: {}
        },
        {
          name: "odin.get_startup_packet",
          arguments: {}
        },
        {
          name: "odin.get_role_profile",
          arguments: {
            role: "A/EXEC-PM"
          }
        },
        {
          name: "odin.validate_boot_receipt",
          arguments: {
            receipt: {
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
            }
          }
        },
        {
          name: "odin.validate_team_manifest",
          arguments: {
            manifest: {
              session_id: "session-1",
              topology: {},
              executive_office: ["A/EXEC-PM", "A/EXEC-ODIN"],
              development_pods: ["B"],
              odin_mesh: {},
              model_profile: {},
              handoff_sources: [".odin/handoffs/"],
              startup_objectives: ["bootstrap"]
            }
          }
        },
        {
          name: "odin.evaluate_readiness_gate",
          arguments: {
            execPmAuthorized: true,
            cmuxAvailable: true,
            userProvisioningAnswer: "yes",
            slots: [
              {
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
              }
            ]
          }
        },
        {
          name: "odin.get_active_watch_packet",
          arguments: {
            role: "A/EXEC-ODIN"
          }
        },
        {
          name: "odin.get_harness_probe_matrix",
          arguments: {
            intendedHarnesses: ["OpenHands"],
            observations: [{ harness: "OpenHands", text: "missing API inference credentials" }]
          }
        },
        {
          name: "odin.get_onboarding_plan",
          arguments: {
            intendedHarnesses: ["Codex"],
            installedHarnesses: ["Codex"],
            userProvisioningAnswer: "yes",
            computerUseAvailable: false,
            observations: [{ harness: "Codex", mcpConfigured: true, scpSkillInstalled: true, authStatus: "AUTH_READY", visibleContent: true }]
          }
        },
        {
          name: "odin.get_closeout_checklist",
          arguments: {
            mode: "FULL_SESSION_SHUTDOWN"
          }
        },
        {
          name: "odin.export_protocol_snapshot",
          arguments: {}
        },
        {
          name: "odin.compute_surface_layout",
          arguments: { teamCount: 5 }
        },
        {
          name: "odin.compute_human_cmux_quad_layout",
          arguments: { teamCount: 3 }
        },
        {
          name: "odin.compute_surface_layout_gate",
          arguments: { fromTeamCount: 4, toTeamCount: 5 }
        },
        {
          name: "odin.get_telemetry_config",
          arguments: {}
        },
        {
          name: "odin.compile_session_report",
          arguments: {
            teamCount: 4,
            violations: [],
            halts: [],
            layoutDriftEvents: 0,
            peakContextPct: 50,
            closeoutClean: true,
            modelSignals: []
          }
        },
        {
          name: "odin.preview_telemetry_redaction",
          arguments: {
            report: {
              version: "0.4.5",
              compiledAt: new Date(0).toISOString(),
              teamCount: 4,
              violations: [{ class: "path_probe", description: "ran from " + "/" + "Users/" + "example/repo" }],
              halts: [],
              layoutDriftEvents: 0,
              peakContextPct: 50,
              closeoutClean: true,
              modelSignals: [],
              violationCount: 1,
              haltCount: 0
            }
          }
        },
        {
          name: "odin.submit_session_report",
          arguments: {
            userConsentConfirmed: true,
            report: {
              version: "0.4.5",
              compiledAt: new Date(0).toISOString(),
              teamCount: 4,
              violations: [],
              halts: [],
              layoutDriftEvents: 0,
              peakContextPct: 50,
              closeoutClean: true,
              modelSignals: [],
              violationCount: 0,
              haltCount: 0
            }
          }
        },
        {
          name: "odin.get_bootstrap_skill",
          arguments: {}
        },
        {
          name: "odin.get_activation_gates",
          arguments: {}
        },
        {
          name: "odin.validate_cmux_delivery_proof",
          arguments: {
            proof: {
              target_surface_locator: "workspace:1 pane:b surface:qa-1",
              submitted: true,
              verification_method: "cmux read-screen",
              observed_processing_state: "DELIVERED_ACKED",
              timestamp: "2026-01-01T00:00:00Z",
              sender_role: "A/EXEC-PM"
            }
          }
        },
        {
          name: "odin.validate_instruction_read_proof",
          arguments: {
            proof: {
              role: "B/DEV-1",
              generated_at: "2026-01-01T00:00:00Z",
              files: [{ path: "protocol/SCP.md", bytes: 4175, lines: 87, sha256: "abc" }]
            }
          }
        }
      ];
      const version = parseTextResult(await client.callTool(toolCalls[2]));
      const resource = await client.readResource({ uri: "odin://protocol/main" });

      expect(version).toMatchObject({
        name: "odin-sentinel",
        version: expect.any(String)
      });
      expect(resource.contents[0]).toMatchObject({
        uri: "odin://protocol/main",
        mimeType: "text/markdown"
      });
      expect("text" in resource.contents[0] ? resource.contents[0].text : "").toContain("Sentinel Coordination Protocol");

      for (const uri of resources) {
        const result = await client.readResource({ uri });
        expect(result.contents[0]).toMatchObject({ uri });
      }

      for (const call of toolCalls) {
        const result = await client.callTool(call);
        if (call.name === "odin.get_bootstrap_skill") {
          const content = result.content as Array<{ type: string; text?: string }>;
          expect(content[0].type).toBe("text");
          expect(content[0].text).toContain("Sentinel Coordination Protocol");
        } else {
          expect(parseTextResult(result)).toBeDefined();
        }
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("defaults compute_surface_layout to the canonical human_cmux_quad profile", async () => {
    const { client, server } = await connectClient();

    try {
      const layout = parseTextResult(await client.callTool({
        name: "odin.compute_surface_layout",
        arguments: { teamCount: 3 }
      })) as { profile?: string; workspace?: { execPmSameWorkspaceRequired?: boolean }; regions?: unknown[] };

      expect(layout.profile).toBe("human_cmux_quad");
      expect(layout.workspace?.execPmSameWorkspaceRequired).toBe(true);
      expect(layout.regions).toHaveLength(4);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a harness-aware onboarding plan and offers assisted setup only when computer use is available", async () => {
    const { client, server } = await connectClient();

    type OnboardingResult = {
      recommendedMode: string;
      zeroSecretOutput: boolean;
      ledgerPath: string;
      nextUserAction: string;
      guidedSetupSteps: unknown[];
      setupModes: { assisted: { eligible: boolean; candidateHarnesses: string[] } };
    };

    try {
      const guided = parseTextResult(await client.callTool({
        name: "odin.get_onboarding_plan",
        arguments: {
          intendedHarnesses: ["Codex"],
          installedHarnesses: ["Codex"],
          userProvisioningAnswer: "yes",
          computerUseAvailable: false,
          observations: [{ harness: "Codex", mcpConfigured: true, scpSkillInstalled: true, authStatus: "AUTH_READY", visibleContent: true }]
        }
      })) as OnboardingResult;

      expect(guided.recommendedMode).toBe("guided");
      expect(guided.setupModes.assisted.eligible).toBe(false);
      expect(Array.isArray(guided.guidedSetupSteps)).toBe(true);
      expect(guided.zeroSecretOutput).toBe(true);
      expect(typeof guided.ledgerPath).toBe("string");
      expect(typeof guided.nextUserAction).toBe("string");

      const assisted = parseTextResult(await client.callTool({
        name: "odin.get_onboarding_plan",
        arguments: {
          intendedHarnesses: ["Codex"],
          installedHarnesses: ["Codex"],
          userProvisioningAnswer: "yes",
          computerUseAvailable: true,
          preferredSetupMode: "assisted",
          observations: [{ harness: "Codex", mcpConfigured: true, scpSkillInstalled: true, authStatus: "AUTH_READY", visibleContent: true }]
        }
      })) as OnboardingResult;

      expect(assisted.recommendedMode).toBe("assisted");
      expect(assisted.setupModes.assisted.eligible).toBe(true);
      expect(assisted.setupModes.assisted.candidateHarnesses.length).toBeGreaterThan(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("accepts the assisted_computer_use preferredSetupMode alias through MCP schema validation", async () => {
    const { client, server } = await connectClient();

    try {
      // SLICE-ODIN-ONBOARDING-HARDENING-DEV-001: the prose alias passes zod validation and maps
      // to canonical assisted, without bypassing computerUseAvailable.
      const aliasResult = await client.callTool({
        name: "odin.get_onboarding_plan",
        arguments: {
          intendedHarnesses: ["Codex"],
          installedHarnesses: ["Codex"],
          userProvisioningAnswer: "yes",
          computerUseAvailable: true,
          preferredSetupMode: "assisted_computer_use",
          observations: [{ harness: "Codex", mcpConfigured: true, scpSkillInstalled: true, authStatus: "AUTH_READY", visibleContent: true }]
        }
      });
      expect(aliasResult.isError).toBeFalsy();
      const aliasPlan = parseTextResult(aliasResult) as { recommendedMode: string; setupModes: { assisted: { eligible: boolean } } };
      expect(aliasPlan.recommendedMode).toBe("assisted");
      expect(aliasPlan.setupModes.assisted.eligible).toBe(true);

      const guided = parseTextResult(await client.callTool({
        name: "odin.get_onboarding_plan",
        arguments: {
          intendedHarnesses: ["Codex"],
          installedHarnesses: ["Codex"],
          userProvisioningAnswer: "yes",
          computerUseAvailable: false,
          preferredSetupMode: "assisted_computer_use"
        }
      })) as { recommendedMode: string; setupModes: { assisted: { eligible: boolean } } };
      expect(guided.recommendedMode).toBe("guided");
      expect(guided.setupModes.assisted.eligible).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("surfaces fail-closed governed readiness and hard-blocks activation through MCP tools", async () => {
    const { client, server } = await connectClient();

    try {
      const gates = parseTextResult(await client.callTool({ name: "odin.get_activation_gates", arguments: {} })) as Record<string, any>;
      expect(gates.governedContextProof.verifierScript).toBe("scripts/protocol/verify-governed-context.mjs");

      // A governed slot with full instruction/auth readiness but NO governed-context uptake proof
      // must not reach team activation.
      const blocked = parseTextResult(await client.callTool({
        name: "odin.evaluate_readiness_gate",
        arguments: {
          execPmAuthorized: true,
          cmuxAvailable: true,
          slots: [{
            roleSlot: "B/DEV-1",
            harness: "Claude Code",
            mcpAvailable: true,
            mcpVersion: "0.4.9",
            scpSkillAvailable: true,
            protocolTextSource: "native_skill",
            authStatus: "AUTH_READY",
            firstRunPermissionStatus: "CLEAR",
            modelStatus: "MODEL_READY",
            roleCompatibility: "ACCEPTS_ROLE",
            occupantState: "BOOTSTRAPPED_IDLE",
            hooksAvailable: true
          }]
        }
      })) as Record<string, any>;

      expect(blocked.readinessMatrix[0].governedReadiness).toBe("FIXABLE_BLOCKED");
      expect(blocked.readinessMatrix[0].activationAllowed).toBe(false);
      expect(blocked.activationStatus).toBe("TEAM_ACTIVATION_BLOCKED");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("accepts AX diagnostics through the MCP session report schema", async () => {
    const { client, server } = await connectClient();

    try {
      const result = parseTextResult(await client.callTool({
        name: "odin.compile_session_report",
        arguments: {
          teamCount: 2,
          violations: [],
          halts: [],
          layoutDriftEvents: 1,
          peakContextPct: 60,
          closeoutClean: false,
          modelSignals: [],
          ax: {
            roleSlots: [
              {
                role: "A/EXEC-ODIN",
                team: "A",
                harness: "Codex",
                model: "gpt-test",
                locator: { workspace: "workspace:1", pane: "pane:1", surface: "surface:2" },
                mcpAccess: { status: "verified" },
                mcpVersion: "0.4.5",
                minimumCompatibleMcpVersion: "0.4.5",
                skillAccess: { status: "missing", detail: "skill absent" },
                fullProtocolTextReceived: { status: "missing", detail: "short prompt only" },
                promptType: "short_boot_prompt",
                operatorAuthorityRecognized: { status: "verified" },
                readinessStatus: "blocked",
                bootReceiptStatus: "missing",
                activeWatchStatus: "passive",
                blockerClassification: ["missing_skill", "short_prompt", "passive_odin"]
              }
            ],
            childAgentQuestions: ["What role slot were you assigned?"],
            odinQuestions: ["Were you instructed to actively poll?"],
            layout: {
              sameWorkspace: false,
              splitWorkspace: true,
              spatialPodLayout: false,
              tabHeavyLayout: true,
              cmuxAvailable: true,
              degradedLayoutWarnings: ["split workspace"]
            },
            launchRunbook: {
              deterministicRunbookFollowed: false,
              missingPrompts: ["active watch prompt"],
              missingTools: ["cmux poller"],
              missingSchemas: ["ax"]
            },
            versions: {
              currentServerVersion: "0.4.5",
              minimumCompatibleVersion: "0.4.5",
              childReportedMcpVersions: [{ role: "B/DEV-1", version: "0.2.1" }],
              driftWarnings: ["B/DEV-1 reported stale MCP"]
            },
            artifacts: {
              planningArtifactsLocalOnly: true,
              publicTemplatesSanitized: true,
              privateArtifactWarnings: []
            }
          }
        }
      })) as { axSummary?: { blockerClassifications: string[]; degradedLayout: boolean; driftWarningCount: number } };

      expect(result.axSummary?.blockerClassifications).toEqual(
        expect.arrayContaining(["missing_skill", "short_prompt", "passive_odin", "split_workspace", "tab_heavy_layout", "runbook_improvisation", "stale_mcp_version"])
      );
      expect(result.axSummary?.degradedLayout).toBe(true);
      expect(result.axSummary?.driftWarningCount).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects unknown report fields for telemetry preview and submit tools", async () => {
    const { client, server } = await connectClient();

    try {
      const report = parseTextResult(await client.callTool({
        name: "odin.compile_session_report",
        arguments: {
          teamCount: 1,
          violations: [],
          halts: [],
          layoutDriftEvents: 0,
          peakContextPct: 10,
          closeoutClean: true,
          modelSignals: []
        }
      })) as Record<string, unknown>;
      const reportWithUnknown = {
        ...report,
        unexpectedSecretField: "sk-proj-" + "0123456789abcdefghijklmnopqrstuv_0123456789"
      };
      const reportWithNestedViolationUnknown = {
        ...report,
        violations: [{ class: "nested", unexpectedNestedSecret: "sk-proj-" + "0123456789abcdefghijklmnopqrstuv_0123456789" }]
      };
      const reportWithNestedAxUnknown = {
        ...report,
        ax: {
          roleSlots: [
            {
              role: "A/EXEC-ODIN",
              team: "A",
              harness: "Codex",
              model: "gpt-test",
              locator: { workspace: "workspace:1", pane: "pane:1", surface: "surface:1" },
              mcpAccess: { status: "verified" },
              skillAccess: { status: "verified" },
              fullProtocolTextReceived: { status: "verified" },
              promptType: "full_protocol",
              operatorAuthorityRecognized: { status: "verified" },
              readinessStatus: "ready",
              bootReceiptStatus: "emitted",
              activeWatchStatus: "active",
              blockerClassification: ["none"],
              unknownNested: "should be rejected"
            }
          ]
        }
      };

      const preview = await client.callTool({
        name: "odin.preview_telemetry_redaction",
        arguments: {
          report: reportWithUnknown
        }
      });
      const submit = await client.callTool({
        name: "odin.submit_session_report",
        arguments: {
          report,
          userConsentConfirmed: true,
          unexpectedTopLevel: "should be rejected"
        }
      });
      const missingConsent = await client.callTool({
        name: "odin.submit_session_report",
        arguments: {
          report
        }
      });
      const nestedViolation = await client.callTool({
        name: "odin.preview_telemetry_redaction",
        arguments: {
          report: reportWithNestedViolationUnknown
        }
      });
      const nestedAx = await client.callTool({
        name: "odin.preview_telemetry_redaction",
        arguments: {
          report: reportWithNestedAxUnknown
        }
      });

      expect(preview.isError).toBe(true);
      expect(submit.isError).toBe(true);
      expect(missingConsent.isError).toBe(true);
      expect(nestedViolation.isError).toBe(true);
      expect(nestedAx.isError).toBe(true);
      expect(JSON.stringify(preview.content)).not.toContain("0123456789abcdefghijklmnopqrstuv");
      expect(JSON.stringify(submit.content)).not.toContain("should be rejected");
      expect(JSON.stringify(missingConsent.content)).not.toContain("0123456789abcdefghijklmnopqrstuv");
      expect(JSON.stringify(nestedViolation.content)).not.toContain("0123456789abcdefghijklmnopqrstuv");
      expect(JSON.stringify(nestedAx.content)).not.toContain("should be rejected");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
