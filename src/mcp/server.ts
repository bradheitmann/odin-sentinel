import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import YAML from "yaml";
import {
  VERSION,
  evaluateReadinessGate,
  exportProtocolSnapshot,
  getActivationGates,
  getActiveWatchPacket,
  getBootReceiptExamples,
  getBootReceiptSchema,
  getCloseoutChecklist,
  getDelegationPacket,
  getHarnessProbeMatrix,
  getMissionFrontrunPack,
  getOnboardingPlan,
  getRoleCard,
  getRoleProfile,
  getRuntimeNotice,
  getStartupPacket,
  getVersionMetadata,
  loadProtocolData,
  evaluateEscalationGate,
  evaluateBlockedPodRollover,
  evaluateSliceHealth,
  validateAuthorityAction,
  validateBootReceipt,
  validateClosureIndependence,
  validateControlRecipe,
  validateCommitGate,
  validateFallbackContract,
  validateOutageHandoff,
  validateRemediationPacket,
  validateSuccessorContract,
  validateCmuxDeliveryProof,
  validateDelegationPacket,
  validateInstructionReadProof,
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
  cmuxDeliveryProofInputShape,
  delegationPacketInputShape,
  harnessProbeInputShape,
  instructionReadProofInputShape,
  missionFrontrunInputShape,
  onboardingPlanInputShape,
  recordInputShape,
  readinessGateInputShape,
  reportRecordInputShape,
  reportRecordInputSchema,
  roleCardInputShape,
  roleProfileInputShape,
  sessionReportInputShape,
  submitSessionReportInputSchema,
  startupPacketInputShape,
  surfaceLayoutGateInputShape,
  surfaceLayoutInputShape,
  teamManifestInputShape,
  blockedPodRolloverInputShape,
  escalationGateInputShape,
  remediationPacketInputShape,
  sliceHealthInputShape
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

const ROLE_CARD_ID_TO_KEY: Record<string, keyof ReturnType<typeof loadProtocolData>["roleCards"]> = {
  "exec-pm": "execPm",
  "team-pm": "teamPm",
  "dev-worker": "devWorker",
  "qa-worker": "qaWorker",
  "exec-asst": "execAsst"
};

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
      name: "step-up-ladder",
      uri: "odin://protocol/step-up-ladder",
      title: "Step-Up Remediation Ladder",
      description: "Configurable capability-tiered remediation doctrine: cheap-first, step up only on real gate failure, rework-not-restart, reserve top tier.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().stepUpLadder)
    },
    {
      name: "recipe-capture",
      uri: "odin://protocol/recipe-capture",
      title: "Recipe Capture Artifact",
      description: "Solve-hard-once, scale-cheap: reusable recipe artifact captured when a strong tier cracks a hard class, re-injected at tier 0.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().recipeCapture)
    },
    {
      name: "qa-independence",
      uri: "odin://protocol/qa-independence",
      title: "QA Closure Independence",
      description: "Closure-independence contract: self-asserted verdicts forbidden and actively detected; slice-QA-pass is not holdout-accepted; internal validators are advisory.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().qaIndependence)
    },
    {
      name: "commit-gate",
      uri: "odin://protocol/commit-gate",
      title: "Exec-Gated Commit Mode",
      description: "commit_gate: exec state machine and authorization-token semantics; a PM cannot authorize its own pod's commit.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().commitGate)
    },
    {
      name: "harness-control-matrix",
      uri: "odin://protocol/harness-control-matrix",
      title: "Harness Control Matrix",
      description: "Arrow-free, version-pinned control recipes per harness; 9 fail-state guardrails; courier transport + tiered/behavioral delivery verification for alt-screen TUIs.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().harnessControlMatrix)
    },
    {
      name: "authority-chain",
      uri: "odin://protocol/authority-chain",
      title: "Authority Chain",
      description: "Standing Team-A authority model: order sources, roster ownership and lock, report-up chain (no lateral roster negotiation).",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().authorityChain)
    },
    {
      name: "blocked-pod-rollover",
      uri: "odin://protocol/blocked-pod-rollover",
      title: "Blocked-Pod Rollover",
      description: "Pause a blocked pod and spin the next team letter (B->C->D->E); STOP at F -> escalate; rollover is a new team, never a re-staff; blocked state preserved.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().blockedPodRollover)
    },
    {
      name: "slice-health-sentinels",
      uri: "odin://protocol/slice-health-sentinels",
      title: "Slice Health Sentinels",
      description: "OVERSIZED_SLICE, QA_WINDOW_TOO_SMALL, and SPEC_DEFECT heuristics that surface planning defects to the PM without auto-blocking.",
      mimeType: "application/yaml",
      read: () => yamlResource(loadProtocolData().sliceHealthSentinels)
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
    },
    {
      name: "skill-reference-boot-receipt-examples",
      uri: "odin://protocol/skill-references/boot-receipt-examples",
      title: "SCP Boot Receipt Examples",
      description: "Canonical SCP_MIN_BOOT_RECEIPT and SCP_BOOT_RECEIPT examples for visible role activation.",
      mimeType: "text/markdown",
      read: () => loadProtocolData().skillReferences.bootReceiptExamples
    },
    {
      name: "skill-reference-canonical-introduction-prompt",
      uri: "odin://protocol/skill-references/canonical-introduction-prompt",
      title: "SCP Canonical Introduction Prompt",
      description: "Official prompt for landing SCP with an EXEC PM pane before activation or dissemination.",
      mimeType: "text/markdown",
      read: () => loadProtocolData().skillReferences.canonicalIntroductionPrompt
    },
    {
      name: "skill-reference-harness-skill-targets",
      uri: "odin://protocol/skill-references/harness-skill-targets",
      title: "SCP Harness Skill Targets",
      description: "Harness native-skill and adapter target matrix plus fallback policy.",
      mimeType: "text/markdown",
      read: () => loadProtocolData().skillReferences.harnessSkillTargets
    },
    {
      name: "skill-reference-team-bootstrap-runbook",
      uri: "odin://protocol/skill-references/team-bootstrap-runbook",
      title: "SCP Team Bootstrap Runbook",
      description: "CMUX team bootstrap, harness launch, dispatch, teardown, and hygiene runbook.",
      mimeType: "text/markdown",
      read: () => loadProtocolData().skillReferences.teamBootstrapRunbook
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

  // Role card resources (one per role)
  const roleCardIds = ["exec-pm", "team-pm", "dev-worker", "qa-worker", "exec-asst"] as const;
  for (const role_id of roleCardIds) {
    const cardKey = ROLE_CARD_ID_TO_KEY[role_id];
    server.registerResource(
      `role-card-${role_id}`,
      `odin://protocol/role-cards/${role_id}`,
      {
        title: `SCP Role Card: ${role_id}`,
        description: `Quick-start role card (<=4KB) for the ${role_id} role.`,
        mimeType: "text/markdown"
      },
      (uri) => textResource(uri.href, loadProtocolData().roleCards[cardKey], "text/markdown")
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
      description:
        "Build a self-contained visible-role delegation packet without relying on outside local extensions. Includes the CMUX delivery-proof contract: a dispatch counts as delivered only after submit (Enter) plus verified processing on the target surface; input-bar text is not delivery.",
      inputSchema: delegationPacketInputShape
    },
    (input) => jsonText(getDelegationPacket(input))
  );

  server.registerTool(
    "odin.validate_delegation_packet",
    {
      title: "Validate Delegation Packet",
      description:
        "Check a delegation packet for required ODIN fields and role-separation warnings, and validate any attached CMUX delivery_proof (warns when a CMUX dispatch requires delivery proof but omits it).",
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
    "odin.get_role_card",
    {
      title: "Get Role Card",
      description:
        "Return the quick-start role card for a given SCP role ID. Returns role_id, role_name, version, payload_bytes, content_sha256, and content. Valid role_ids: exec-pm, team-pm, dev-worker, qa-worker, exec-asst.",
      inputSchema: roleCardInputShape
    },
    (input) => jsonText(getRoleCard(input.role_id))
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
    "odin.evaluate_escalation_gate",
    {
      title: "Evaluate Escalation Gate",
      description:
        "Step-Up Remediation Ladder gate: given tier position and independent gate observations (QA verdict, sealed holdout, self-proof), return DONE, REMEDIATE (next tier, rework-not-restart), ESCALATE_OPERATOR (reserve-tier failure), or INSUFFICIENT_EVIDENCE (self-tool green never passes).",
      inputSchema: escalationGateInputShape
    },
    (input) => jsonText(evaluateEscalationGate(input))
  );

  server.registerTool(
    "odin.validate_remediation_packet",
    {
      title: "Validate Remediation Packet",
      description:
        "Validate a step-up remediation packet (the baton): non-empty salvaged artifact, exact failure reason, immutable acceptance bar, one-rung step, and a review lane that travels with the DEV.",
      inputSchema: remediationPacketInputShape
    },
    (input) => jsonText(validateRemediationPacket(input.packet))
  );

  server.registerTool(
    "odin.validate_fallback_contract",
    {
      title: "Validate Fallback Contract",
      description:
        "Validate a dev-pod pre-staged fallback contract: every rung pins model + flags (never a harness default), no-substitute resolves to PAUSE_ESCALATE, billing errors are not failover triggers, and the post-relaunch model re-verify is required.",
      inputSchema: recordInputShape
    },
    (input) => jsonText(validateFallbackContract(input.packet))
  );

  server.registerTool(
    "odin.validate_successor_contract",
    {
      title: "Validate Successor Contract",
      description:
        "Validate an exec-team successor contract: locked roster, in-flight worklist, canonical hashes, roster mutation restricted to operator/Team-A EXEC, and report-up (no lateral roster negotiation).",
      inputSchema: recordInputShape
    },
    (input) => jsonText(validateSuccessorContract(input.packet))
  );

  server.registerTool(
    "odin.validate_outage_handoff",
    {
      title: "Validate Outage Handoff",
      description:
        "Validate an [SCP-OUTAGE-HANDOFF] pre-dark receipt for provider-credit mass outages: affected slots enumerated, provider-diverse surviving continuity seat, bounded expiring exception, and a real restoration trigger.",
      inputSchema: recordInputShape
    },
    (input) => jsonText(validateOutageHandoff(input.packet))
  );

  server.registerTool(
    "odin.validate_closure_independence",
    {
      title: "Validate Closure Independence",
      description:
        "Actively detect QA-independence breaches at closure: self-asserted verdicts, reviewer == implementer lane, missing verdicts, slice-QA-pass-only evidence, and advisory internal validators counted as closure.",
      inputSchema: recordInputShape
    },
    (input) => jsonText(validateClosureIndependence(input.packet))
  );

  server.registerTool(
    "odin.validate_commit_gate",
    {
      title: "Validate Commit Gate",
      description:
        "Validate an exec-gated commit record (commit_gate: exec): EXEC-issued token after independent ground-truth verification, no self-issued authorization, and post-commit EXEC re-verification.",
      inputSchema: recordInputShape
    },
    (input) => jsonText(validateCommitGate(input.packet))
  );

  server.registerTool(
    "odin.validate_control_recipe",
    {
      title: "Validate Control Recipe",
      description:
        "Validate a harness control-matrix entry: recipes must be arrow/nav-token-free, version-pinned to the verified harness release, and quit by in-app verb (never ctrl+c).",
      inputSchema: recordInputShape
    },
    (input) => jsonText(validateControlRecipe(input.packet))
  );

  server.registerTool(
    "odin.validate_authority_action",
    {
      title: "Validate Authority Action",
      description:
        "Check a staffing/roster action against the standing authority chain: no worker self-re-staffing or self binding changes; roster mutation only by operator/Team-A EXEC; lateral roster negotiation rejected.",
      inputSchema: recordInputShape
    },
    (input) => jsonText(validateAuthorityAction(input.packet))
  );

  server.registerTool(
    "odin.evaluate_blocked_pod_rollover",
    {
      title: "Evaluate Blocked-Pod Rollover",
      description:
        "Decide a blocked-pod rollover: next team letter (B->C->D->E), STOP at F -> ESCALATE_OPERATOR; rejects re-staff framing and dropped blocked-pod state.",
      inputSchema: blockedPodRolloverInputShape
    },
    (input) => jsonText(evaluateBlockedPodRollover(input))
  );

  server.registerTool(
    "odin.evaluate_slice_health",
    {
      title: "Evaluate Slice Health",
      description:
        "Run the OVERSIZED_SLICE / QA_WINDOW_TOO_SMALL / SPEC_DEFECT sentinels over run events; returns surface-to-PM signals, never auto-blocks.",
      inputSchema: sliceHealthInputShape
    },
    (input) => jsonText(evaluateSliceHealth(input))
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
    "odin.validate_cmux_delivery_proof",
    {
      title: "Validate CMUX Delivery Proof",
      description:
        "Check a CMUX delivery proof. A dispatch is delivered only when submitted=true with verified processing on the target surface; unsubmitted sends and INPUT_BAR_ONLY text fail. Required fields: target_surface_locator, submitted, verification_method, observed_processing_state, timestamp, sender_role.",
      inputSchema: cmuxDeliveryProofInputShape
    },
    (input) => jsonText(validateCmuxDeliveryProof(input.proof))
  );

  server.registerTool(
    "odin.validate_instruction_read_proof",
    {
      title: "Validate Instruction-Read Proof",
      description:
        "Check the shape of a full-instruction-read proof (role, generated_at, and files[] each with path, byte or line count, and sha256). Activated roles must produce this before implementation, QA acceptance, or ACTIVE_WATCH. Disk verification is performed by scripts/protocol/verify-instruction-read.mjs.",
      inputSchema: instructionReadProofInputShape
    },
    (input) => jsonText(validateInstructionReadProof(input.proof))
  );

  server.registerTool(
    "odin.get_activation_gates",
    {
      title: "Get Activation Gates",
      description:
        "Return the SCP activation gates an agent must satisfy before acting: CMUX delivery proof (submit + verify; input-bar text is not delivery), full-instruction-read proof (path + count + sha256 per file), and governed-context proof (fail-closed: MCP configured or a skill on disk is NOT enough — protocol uptake must be verified at adequate assurance). Includes verifier/installer script paths and validation tool names."
    },
    () => jsonText(getActivationGates())
  );

  server.registerTool(
    "odin.evaluate_readiness_gate",
    {
      title: "Evaluate Governed Launch Readiness Gate",
      description:
        "Return the governed launch readiness matrix before occupant launch. Output is zero-secret and classifies MCP, SCP skill, auth, permission, model, and role-compatibility blockers. Each slot also reports a fail-closed governedReadiness state (GOVERNED_READY, FIXABLE_BLOCKED, NON_GOVERNED_ONE_SHOT_ONLY, UNSUPPORTED): presence of MCP/skill is not authority, and PM/ODIN roles require the highest assurance the harness supports.",
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
    "odin.get_onboarding_plan",
    {
      title: "Get Harness-Aware Onboarding Plan",
      description:
        "Return a zero-secret onboarding plan that reuses harness readiness classification and presents two setup choices: guided manual setup (safe default) and assisted computer-use setup (offered only when computerUseAvailable is true). Includes readiness rows, classifications, recommended mode, guided steps, assisted-mode eligibility, install-ledger path, blocker summary, and next user action. MCP returns plans only; actual GUI/computer use is performed by an available computer-use-capable harness after the user chooses. Reports secret/provider readiness by status only and never accepts or prints secrets.",
      inputSchema: onboardingPlanInputShape
    },
    (input) => jsonText(getOnboardingPlan(input))
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

  server.registerTool(
    "odin.get_mission_frontrun_pack",
    {
      title: "Get Factory Mission Front-Runner Contract Pack",
      description:
        "Assemble a Factory Mission governance contract pack using the PROVEN --append-system-prompt-file seam (live-verified 2026-06-12). Returns four role contracts (orchestrator, worker, scrutiny-validator, scrutiny-feature-reviewer), the .factory/droids/scrutiny-feature-reviewer.md file content, a launch command template, a boot_contract_receipt template with all six required fields (role, session_id, contract_path, byte_count, sha256, timestamp), and a notes block distinguishing PROVEN vs UNPROVEN seams. All placeholder tokens ({{WRITE_SCOPE}}, {{TASK_ID}}, {{REPO_PATH}}, {{MISSION_NAME}}) are substituted from input.",
      inputSchema: missionFrontrunInputShape
    },
    (input) => jsonText(getMissionFrontrunPack(input))
  );

  return server;
}
