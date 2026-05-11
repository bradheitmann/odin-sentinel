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
        "odin.compute_surface_layout",
        "odin.compute_surface_layout_gate",
        "odin.export_protocol_snapshot",
        "odin.get_bootstrap_skill",
        "odin.get_closeout_checklist",
        "odin.get_delegation_packet",
        "odin.get_role_profile",
        "odin.get_runtime_notice",
        "odin.get_startup_packet",
        "odin.get_telemetry_config",
        "odin.get_version",
        "odin.preview_telemetry_redaction",
        "odin.submit_session_report",
        "odin.validate_boot_receipt",
        "odin.validate_delegation_packet",
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
        "odin://protocol/roles",
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
        "odin://protocol/roles",
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
              handoff_sources: ["docs/handoffs/"],
              startup_objectives: ["bootstrap"]
            }
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
            report: { note: "ran from " + "/" + "Users/" + "example/repo" }
          }
        },
        {
          name: "odin.submit_session_report",
          arguments: { report: { teamCount: 4 } }
        },
        {
          name: "odin.get_bootstrap_skill",
          arguments: {}
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
});
