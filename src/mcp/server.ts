import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import YAML from "yaml";
import {
  VERSION,
  evaluateReadinessGate,
  exportProtocolSnapshot,
  getActiveWatchPacket,
  getBootReceiptExamples,
  getBootReceiptSchema,
  getCloseoutChecklist,
  getDelegationPacket,
  getHarnessProbeMatrix,
  getRoleProfile,
  getRuntimeNotice,
  getStartupPacket,
  getVersionMetadata,
  loadProtocolData,
  validateBootReceipt,
  validateDelegationPacket,
  validateTeamManifest
} from "../protocol/service.js";
import {
  computeSurfaceLayout,
  computeSurfaceLayoutGate,
  computeHumanCmuxQuadLayout,
  renderSurfaceLayoutAscii
} from "../protocol/surface-layout.js";
import {
  compileSessionReport,
  publicTelemetryConfig,
  readTelemetryConfig,
  redactPayload,
  submitSessionReport,
  type SessionReportInput
} from "../telemetry/index.js";
import {
  bootReceiptInputShape,
  activeWatchPacketInputShape,
  closeoutChecklistInputShape,
  delegationPacketInputShape,
  harnessProbeInputShape,
  recordInputShape,
  readinessGateInputShape,
  reportRecordInputShape,
  reportRecordInputSchema,
  roleProfileInputShape,
  sessionReportInputShape,
  submitSessionReportInputSchema,
  startupPacketInputShape,
  surfaceLayoutGateInputShape,
  surfaceLayoutInputShape,
  teamManifestInputShape
} from "../protocol/schemas.js";

function jsonText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

type ResourceSpec = {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: string;
  read: () => string;
};

function textResource(uri: string, text: string, mimeType: string) {
  return {
    contents: [
      {
        uri,
        mimeType,
        text
      }
    ]
  };
}

function yamlResource(value: unknown): string {
  return YAML.stringify(value);
}

function registerProtocolResources(server: McpServer) {
  const resources: ResourceSpec[] = [
    {
      name: "protocol-main",
      uri: "odin://protocol/main",
      title: "ODIN Sentinel Protocol",
      description: "Portable ODIN/SCP coordination protocol.",
      mimeType: "text/markdown",
      read: () => loadProtocolData().protocol
    },
    {
      name: "delegation",
      uri: "odin://protocol/delegation",
      title: "Delegation Contract",
      description: "Native ODIN delegation packet contract and validation rules.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().delegation)
    },
    {
      name: "boot-receipt",
      uri: "odin://protocol/receipts/boot",
      title: "Boot Receipt Template",
      description: "Required startup receipt fields for visible ODIN/SCP roles.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().bootReceipt)
    },
    {
      name: "team-manifest",
      uri: "odin://protocol/receipts/team-manifest",
      title: "Team Manifest Template",
      description: "Required team topology manifest fields for ODIN/SCP startup.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().teamManifest)
    },
    {
      name: "roles",
      uri: "odin://protocol/roles",
      title: "ODIN Role Contracts",
      description: "Generic role definitions and authority defaults.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().roles)
    },
    {
      name: "topology",
      uri: "odin://protocol/topology",
      title: "Default Topology",
      description: "Executive office, development pod, and ODIN mesh defaults.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().topology)
    },
    {
      name: "model-profiles",
      uri: "odin://protocol/model-profiles",
      title: "Model Harness Profiles",
      description: "Default model and harness profile map.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().modelProfiles)
    },
    {
      name: "closeout",
      uri: "odin://protocol/closeout",
      title: "Closeout Protocol",
      description: "Continuity parking and full shutdown checklists.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().closeout)
    },
    {
      name: "bootstrap-skill",
      uri: "odin://protocol/bootstrap-skill",
      title: "Sentinel Coordination Protocol Skill",
      description:
        "Full SCP governance skill: self-bootstrap, role topology, EXEC/TEAM/WORKER assignment, boot receipts, delegation, delivery proof, heartbeat cadence, adversarial QA, finish audit. Read this resource at session start.",
      mimeType: "text/markdown",
      read: () => loadProtocolData().bootstrapSkill
    }
  ];

  for (const resource of resources) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType
      },
      (uri) => textResource(uri.href, resource.read(), resource.mimeType)
    );
  }
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "odin-sentinel",
    version: VERSION
  });

  registerProtocolResources(server);

  server.registerTool(
    "odin.get_delegation_packet",
    {
      title: "Get Delegation Packet",
      description: "Build a self-contained visible-role delegation packet without relying on outside local extensions.",
      inputSchema: delegationPacketInputShape
    },
    (input) => jsonText(getDelegationPacket(input))
  );

  server.registerTool(
    "odin.validate_delegation_packet",
    {
      title: "Validate Delegation Packet",
      description: "Check a delegation packet for required ODIN fields and role-separation warnings.",
      inputSchema: recordInputShape
    },
    (input) => jsonText(validateDelegationPacket(input.packet))
  );

  server.registerTool(
    "odin.get_version",
    {
      title: "Get ODIN Sentinel Version",
      description: "Return server and protocol version metadata."
    },
    () => jsonText(getVersionMetadata())
  );

  server.registerTool(
    "odin.get_boot_receipt_schema",
    {
      title: "Get Boot Receipt Schema",
      description: "Return canonical boot receipt fields, types, lifecycle states, examples, and minimum MCP version."
    },
    () => jsonText(getBootReceiptSchema())
  );

  server.registerTool(
    "odin.get_boot_receipt_examples",
    {
      title: "Get Boot Receipt Examples",
      description: "Return valid PM, ODIN, DEV waiting-for-scope, QA, and SHADOW receipt examples."
    },
    () => jsonText(getBootReceiptExamples())
  );

  server.registerTool(
    "odin.get_runtime_notice",
    {
      title: "Get Runtime Notice",
      description: "Return cost, privacy, inference, telemetry, and standalone runtime boundaries."
    },
    () => jsonText(getRuntimeNotice())
  );

  server.registerTool(
    "odin.get_startup_packet",
    {
      title: "Get Startup Packet",
      description: "Return a generic SCP/ODIN startup packet for a role and pod count.",
      inputSchema: startupPacketInputShape
    },
    (input) => jsonText(getStartupPacket(input))
  );

  server.registerTool(
    "odin.get_role_profile",
    {
      title: "Get Role Profile",
      description: "Return the authority profile for a generic ODIN/SCP role.",
      inputSchema: roleProfileInputShape
    },
    (input) => jsonText(getRoleProfile(input.role))
  );

  server.registerTool(
    "odin.validate_boot_receipt",
    {
      title: "Validate Boot Receipt",
      description: "Check a boot receipt for required ODIN/SCP fields and basic authority warnings.",
      inputSchema: bootReceiptInputShape
    },
    (input) => jsonText(validateBootReceipt(input.receipt))
  );

  server.registerTool(
    "odin.validate_team_manifest",
    {
      title: "Validate Team Manifest",
      description: "Check a team manifest for required ODIN/SCP topology fields.",
      inputSchema: teamManifestInputShape
    },
    (input) => jsonText(validateTeamManifest(input.manifest))
  );

  server.registerTool(
    "odin.evaluate_readiness_gate",
    {
      title: "Evaluate Governed Launch Readiness Gate",
      description:
        "Return the governed launch readiness matrix before occupant launch. Output is zero-secret and classifies MCP, SCP skill, auth, permission, model, and role-compatibility blockers.",
      inputSchema: readinessGateInputShape
    },
    (input) => jsonText(evaluateReadinessGate(input))
  );

  server.registerTool(
    "odin.get_active_watch_packet",
    {
      title: "Get ODIN Active Watch Packet",
      description:
        "Return exact ACTIVE_WATCH prompt text, watch targets, cadence, blocker taxonomy, interventions, and terminal states for an ODIN role.",
      inputSchema: activeWatchPacketInputShape
    },
    (input) => jsonText(getActiveWatchPacket(input))
  );

  server.registerTool(
    "odin.get_harness_probe_matrix",
    {
      title: "Get Harness Probe Matrix",
      description:
        "Classify harness readiness, auth/login/permission blockers, local inference visible-output smoke results, and skill/MCP capability flags without emitting secret values.",
      inputSchema: harnessProbeInputShape
    },
    (input) => jsonText(getHarnessProbeMatrix(input))
  );

  server.registerTool(
    "odin.get_closeout_checklist",
    {
      title: "Get Closeout Checklist",
      description: "Return the checklist for continuity parking or full session shutdown.",
      inputSchema: closeoutChecklistInputShape
    },
    (input) => jsonText(getCloseoutChecklist(input.mode))
  );

  server.registerTool(
    "odin.export_protocol_snapshot",
    {
      title: "Export Protocol Snapshot",
      description: "Return generated fallback protocol files for clients that cannot use MCP."
    },
    () => jsonText({ version: VERSION, files: exportProtocolSnapshot() })
  );

  server.registerTool(
    "odin.compute_surface_layout",
    {
      title: "Compute Surface Layout",
      description:
        "Return the deterministic CMUX surface layout for a given team count. EXEC PM must call this before any spawn beyond A/EXEC to honor the surface custodianship contract.",
      inputSchema: surfaceLayoutInputShape
    },
    (input) => {
      const profile = input.profile ?? "human_cmux_quad";
      const layout = profile === "human_cmux_quad"
        ? computeHumanCmuxQuadLayout(input.teamCount)
        : computeSurfaceLayout(input.teamCount);
      return jsonText({
        ...layout,
        ascii: "columns" in layout ? renderSurfaceLayoutAscii(layout) : "[EXEC] [TEAM-B] [TEAM-C] [BLOCKERS]"
      });
    }
  );

  server.registerTool(
    "odin.compute_human_cmux_quad_layout",
    {
      title: "Compute Human CMUX Quad Layout",
      description:
        "Return the canonical human_cmux_quad governed team layout with one workspace, four panes, explicit role-slot surfaces, empty pre-launch slots, and machine CMUX instructions.",
      inputSchema: surfaceLayoutInputShape
    },
    (input) => jsonText(computeHumanCmuxQuadLayout(input.teamCount))
  );

  server.registerTool(
    "odin.compute_surface_layout_gate",
    {
      title: "Compute Surface Layout Gate",
      description:
        "Return the pre-staffing checklist EXEC PM must complete when growing the team roster from fromTeamCount to toTeamCount.",
      inputSchema: surfaceLayoutGateInputShape
    },
    (input) => jsonText(computeSurfaceLayoutGate(input.fromTeamCount, input.toTeamCount, input))
  );

  server.registerTool(
    "odin.get_bootstrap_skill",
    {
      title: "Get Bootstrap Skill",
      description:
        "Return the full Sentinel Coordination Protocol skill content. Agents on any MCP-capable host can invoke this at session start to load the SCP governance contract, self-bootstrap procedure, and role topology rules without needing a Claude Code skill installed locally."
    },
    () => ({
      content: [
        {
          type: "text" as const,
          text: loadProtocolData().bootstrapSkill
        }
      ]
    })
  );

  server.registerTool(
    "odin.get_telemetry_config",
    {
      title: "Get Telemetry Config",
      description:
        "Return current telemetry configuration. Telemetry is opt-in; reports are never sent unless ODIN_TELEMETRY_ENDPOINT is set in the environment."
    },
    () => jsonText(publicTelemetryConfig(readTelemetryConfig()))
  );

  server.registerTool(
    "odin.compile_session_report",
    {
      title: "Compile Session Report",
      description:
        "Build a structured end-of-session report from counts and class labels. EXEC PM should call this at closeout. The compiled report is returned to the caller; user review and explicit submission are required before any network transmission.",
      inputSchema: sessionReportInputShape
    },
    (input) =>
      jsonText(compileSessionReport(input as SessionReportInput, VERSION))
  );

  server.registerTool(
    "odin.preview_telemetry_redaction",
    {
      title: "Preview Telemetry Redaction",
      description:
        "Return the redacted form of a report payload (file paths, emails, and common secret tokens replaced). Use this for user-facing consent flows before any submission.",
      inputSchema: reportRecordInputSchema
    },
    (input) => jsonText(redactPayload(input.report as Record<string, unknown>))
  );

  server.registerTool(
    "odin.submit_session_report",
    {
      title: "Submit Session Report",
      description:
        "Submit a redacted session report to the configured telemetry endpoint. Telemetry is disabled by default; this tool returns {submitted: false, reason: ...} unless ODIN_TELEMETRY_ENDPOINT is set. Only invoke after explicit user consent for the current session.",
      inputSchema: submitSessionReportInputSchema
    },
    async (input) => jsonText(await submitSessionReport(input.report as Record<string, unknown>, { userConsentConfirmed: input.userConsentConfirmed === true }))
  );

  return server;
}
