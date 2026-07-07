import { z } from "zod";

export const startupPacketInputShape = {
  role: z.string().optional(),
  pods: z.number().int().min(0).max(25).optional(),
  repoPath: z.string().optional(),
  handoffPaths: z.array(z.string()).optional(),
  userInstruction: z.string().optional(),
  governedMode: z.enum(["GOVERNED_TEAM", "NON_GOVERNED_ONE_SHOT_ONLY", "BLOCKED"]).optional(),
  parkedMode: z.boolean().optional(),
  layoutProfile: z.string().optional()
} as const;

export const startupPacketInputSchema = z.object(startupPacketInputShape);
export type StartupPacketInput = z.infer<typeof startupPacketInputSchema>;

export const delegationPacketInputShape = {
  sourceRole: z.string(),
  targetRoleSlot: z.string(),
  task: z.string(),
  scope: z.string().optional(),
  mayImplement: z.boolean().optional(),
  mayQaAccept: z.boolean().optional(),
  writeScope: z.array(z.string()).optional(),
  readScope: z.array(z.string()).optional(),
  prohibitedPaths: z.array(z.string()).optional(),
  reportBack: z.string().optional()
} as const;

export const delegationPacketInputSchema = z.object(delegationPacketInputShape);
export type DelegationPacketInput = z.infer<typeof delegationPacketInputSchema>;

export const recordInputShape = {
  packet: z.record(z.string(), z.unknown())
} as const;

export const roleProfileInputShape = {
  role: z.string()
} as const;

export const bootReceiptInputShape = {
  receipt: z.record(z.string(), z.unknown())
} as const;

export const teamManifestInputShape = {
  manifest: z.record(z.string(), z.unknown())
} as const;

export const cmuxDeliveryProofInputShape = {
  proof: z.record(z.string(), z.unknown())
} as const;

export const instructionReadProofInputShape = {
  proof: z.record(z.string(), z.unknown())
} as const;

export const closeoutModeSchema = z.enum(["PARK_FOR_CONTINUITY", "FULL_SESSION_SHUTDOWN"]);
export type CloseoutMode = z.infer<typeof closeoutModeSchema>;

export const closeoutChecklistInputShape = {
  mode: closeoutModeSchema
} as const;

export const surfaceLayoutInputShape = {
  teamCount: z.number().int().min(0).max(26),
  profile: z.enum(["legacy_columns", "human_cmux_quad"]).optional().default("human_cmux_quad")
} as const;

export const surfaceLayoutGateInputShape = {
  fromTeamCount: z.number().int().min(0).max(26),
  toTeamCount: z.number().int().min(1).max(26),
  cmuxAvailable: z.boolean().optional(),
  layoutMode: z.enum(["human_cmux_quad", "tab_only", "legacy_columns"]).optional(),
  degradedModeApproved: z.boolean().optional(),
  execPmWorkspaceMode: z.enum(["SAME_WORKSPACE", "SPLIT_WORKSPACE"]).optional(),
  splitWorkspaceRoutingProof: z.string().optional()
} as const;

export const readinessGateInputShape = {
  minimumMcpVersion: z.string().optional(),
  execPmAuthorized: z.boolean(),
  cmuxAvailable: z.boolean(),
  userProvisioningAnswer: z.enum(["yes", "no", "unknown"]).optional(),
  slots: z.array(
    z.object({
      roleSlot: z.string(),
      role: z.string().optional(),
      team: z.string().optional(),
      cwd: z.string().optional(),
      harness: z.string().optional(),
      mcpAvailable: z.boolean().optional(),
      mcpVersion: z.string().optional(),
      scpSkillAvailable: z.boolean().optional(),
      fullProtocolTextInjected: z.boolean().optional(),
      protocolTextSource: z.enum(["native_skill", "mcp_resource", "injected_full_text", "none"]).optional(),
      authStatus: z.enum(["AUTH_READY", "AUTH_PRESENT_UNVERIFIED", "AUTH_MISSING", "AUTH_PROVIDER_BLOCKED", "AUTH_LOGIN_REQUIRED", "AUTH_UNKNOWN"]).optional(),
      firstRunPermissionStatus: z.enum(["CLEAR", "PROMPT_WAITING", "DENIED", "UNKNOWN"]).optional(),
      modelStatus: z.enum(["MODEL_READY", "MODEL_SLOW", "MODEL_STALLED", "MODEL_REASONING_ONLY", "STREAMING_PROTOCOL_MISMATCH", "MODEL_UNREACHABLE"]).optional(),
      roleCompatibility: z.enum(["ACCEPTS_ROLE", "REFUSES_ROLE", "UNPROVEN"]).optional(),
      canHydrateDeferredMcpToolsAtBoot: z.boolean().optional(),
      canHydrateDeferredMcpToolsAfterSecondTurn: z.boolean().optional(),
      nativeSkillInvocation: z.boolean().optional(),
      waiver: z.enum(["WAIVED_BY_EXEC_PM", "SUBSTITUTION_APPROVED_BY_EXEC_PM"]).optional(),
      fallbackHarness: z.string().optional(),
      occupantState: z.string().optional(),
      required: z.boolean().optional(),
      // Fail-closed governed-context inputs: an embedded governed-context proof and liveness
      // signals. Presence is not authority; only a verified uptake proof can reach GOVERNED_READY.
      governedContextProof: z.record(z.string(), z.unknown()).optional(),
      hooksAvailable: z.boolean().optional(),
      deliveryState: z.string().optional(),
      livenessState: z.string().optional(),
      permissionBlocked: z.boolean().optional(),
      idleStalled: z.boolean().optional()
    })
  ).min(1)
} as const;

export const activeWatchPacketInputShape = {
  role: z.string(),
  parkedMode: z.boolean().optional(),
  planMode: z.boolean().optional(),
  pollIntervalSeconds: z.number().int().min(5).max(600).optional(),
  manifest: z.record(z.string(), z.unknown()).optional()
} as const;

// Shared harness-probe observation schema. Reused by the harness probe matrix and the
// onboarding plan so both validate observations against one taxonomy (no second readiness
// shape). Zero-secret: `text` is sanitized downstream, never echoed verbatim.
export const harnessProbeObservationSchema = z.object({
  harness: z.string(),
  text: z.string().optional(),
  exitCode: z.number().int().optional(),
  httpReachable: z.boolean().optional(),
  modelLoaded: z.boolean().optional(),
  visibleContent: z.boolean().optional(),
  reasoningContentOnly: z.boolean().optional(),
  elapsedSeconds: z.number().int().min(0).optional(),
  mcpManagementAvailable: z.boolean().optional(),
  mcpConfigured: z.boolean().optional(),
  scpSkillInstalled: z.boolean().optional(),
  fullProtocolTextInjected: z.boolean().optional(),
  authStatus: z.enum(["AUTH_READY", "AUTH_PRESENT_UNVERIFIED", "AUTH_MISSING", "AUTH_PROVIDER_BLOCKED", "AUTH_LOGIN_REQUIRED", "AUTH_UNKNOWN"]).optional(),
  autoLevel: z.enum(["none", "low", "medium", "high"]).optional(),
  taskAutonomy: z.enum(["read_only", "mission", "high_autonomy"]).optional(),
  // Fail-closed governed-context inputs. The embedded governed-context proof is validated for
  // uptake (a stable source marker actually observed); a bare boolean never qualifies.
  requestedRole: z.string().optional(),
  governedContextProof: z.record(z.string(), z.unknown()).optional(),
  hooksAvailable: z.boolean().optional(),
  deliveryState: z.string().optional(),
  livenessState: z.string().optional(),
  permissionBlocked: z.boolean().optional(),
  idleStalled: z.boolean().optional()
});

export const harnessProbeInputShape = {
  intendedHarnesses: z.array(z.string()).optional(),
  userProvisioningAnswer: z.enum(["yes", "no", "unknown"]).optional(),
  installedHarnesses: z.array(z.string()).optional(),
  providerStatuses: z.record(z.string(), z.boolean()).optional(),
  observations: z.array(harnessProbeObservationSchema).optional(),
  visibleOutputTimeoutSeconds: z.number().int().min(1).max(600).optional()
} as const;

// Onboarding plan input. Reuses harness probe classification (intendedHarnesses,
// installedHarnesses, userProvisioningAnswer, observations) and adds setup-mode steering:
// whether a computer-use-capable harness is available, the user's preferred mode, the
// install-ledger path to surface, and the platform. Zero-secret; no secret values accepted.
export const onboardingPlanInputShape = {
  intendedHarnesses: z.array(z.string()).optional(),
  installedHarnesses: z.array(z.string()).optional(),
  userProvisioningAnswer: z.enum(["yes", "no", "unknown"]).optional(),
  observations: z.array(harnessProbeObservationSchema).optional(),
  computerUseAvailable: z.boolean().optional(),
  preferredSetupMode: z.enum(["guided", "assisted", "assisted_computer_use", "unset"]).optional(),
  ledgerPath: z.string().optional(),
  platform: z.enum(["macos", "linux", "windows", "unknown"]).optional()
} as const;

const diagnosticStatusSchema = z.enum(["verified", "missing", "blocked", "unknown", "not_applicable"]);
const diagnosticCheckSchema = z.object({
  status: diagnosticStatusSchema,
  detail: z.string().optional(),
  evidence: z.string().optional()
}).strict();
const blockerClassificationSchema = z.enum([
  "none",
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
  "operator_authority_confusion",
  "receipt_missing",
  "runbook_improvisation",
  "readiness_gate_skipped"
]);
const roleSlotLocatorSchema = z.object({
  workspace: z.string().optional(),
  pane: z.string().optional(),
  surface: z.string().optional()
}).strict();
const roleSlotDiagnosticSchema = z.object({
  role: z.string(),
  team: z.string(),
  harness: z.string(),
  model: z.string(),
  locator: roleSlotLocatorSchema,
  mcpAccess: diagnosticCheckSchema,
  mcpVersion: z.string().optional(),
  minimumCompatibleMcpVersion: z.string().optional(),
  skillAccess: diagnosticCheckSchema,
  fullProtocolTextReceived: diagnosticCheckSchema,
  promptType: z.enum(["full_protocol", "short_boot_prompt", "handoff", "unknown"]),
  operatorAuthorityRecognized: diagnosticCheckSchema,
  readinessStatus: z.enum(["ready", "degraded", "blocked", "unknown"]),
  bootReceiptStatus: z.enum(["emitted", "missing", "invalid", "unknown", "not_applicable"]),
  activeWatchStatus: z.enum(["active", "passive", "idle", "blocked", "unknown", "not_applicable"]),
  blockerClassification: z.array(blockerClassificationSchema),
  childContextText: z.string().optional(),
  notes: z.array(z.string()).optional()
}).strict();
const harnessFailureDiagnosticsSchema = z.object({
  openHandsAuthApiCredentials: diagnosticCheckSchema,
  kiloCodeLogin: diagnosticCheckSchema,
  gooseLocalInferenceStall: diagnosticCheckSchema,
  crushPermissionPrompt: diagnosticCheckSchema,
  piRoleRefusal: diagnosticCheckSchema,
  staleMcpVersion: diagnosticCheckSchema
}).strict();
const layoutDiagnosticsSchema = z.object({
  sameWorkspace: z.union([z.boolean(), z.literal("unknown")]),
  splitWorkspace: z.boolean(),
  spatialPodLayout: z.union([z.boolean(), z.literal("unknown")]),
  tabHeavyLayout: z.boolean(),
  cmuxAvailable: z.union([z.boolean(), z.literal("unknown")]),
  degradedLayoutWarnings: z.array(z.string())
}).strict();
const launchRunbookDiagnosticsSchema = z.object({
  deterministicRunbookFollowed: z.union([z.boolean(), z.literal("unknown")]),
  firstImprovisationPoint: z.string().optional(),
  missingPrompts: z.array(z.string()),
  missingTools: z.array(z.string()),
  missingSchemas: z.array(z.string())
}).strict();
const readinessGateDiagnosticsSchema = z.object({
  childMcpVerified: diagnosticCheckSchema,
  skillVerified: diagnosticCheckSchema,
  authVerified: diagnosticCheckSchema,
  firstRunPromptVerified: diagnosticCheckSchema,
  modelSmokeVerified: diagnosticCheckSchema,
  roleCompatibilityVerified: diagnosticCheckSchema
}).strict();
const childReportedMcpVersionSchema = z.object({ role: z.string(), version: z.string() }).strict();
const releaseVersionDiagnosticsSchema = z.object({
  currentServerVersion: z.string(),
  minimumCompatibleVersion: z.string(),
  childReportedMcpVersions: z.array(childReportedMcpVersionSchema),
  driftWarnings: z.array(z.string())
}).strict();
const artifactDiagnosticsSchema = z.object({
  planningArtifactsLocalOnly: z.union([z.boolean(), z.literal("unknown")]),
  publicTemplatesSanitized: z.union([z.boolean(), z.literal("unknown")]),
  privateArtifactWarnings: z.array(z.string())
}).strict();
const childContextWindowSchema = z.object({ role: z.string(), text: z.string() }).strict();
export const axDiagnosticsInputSchema = z.object({
  roleSlots: z.array(roleSlotDiagnosticSchema).optional(),
  childAgentQuestions: z.array(z.string()).optional(),
  odinQuestions: z.array(z.string()).optional(),
  harnessFailures: harnessFailureDiagnosticsSchema.optional(),
  layout: layoutDiagnosticsSchema.optional(),
  launchRunbook: launchRunbookDiagnosticsSchema.optional(),
  readinessGates: readinessGateDiagnosticsSchema.optional(),
  versions: releaseVersionDiagnosticsSchema.optional(),
  artifacts: artifactDiagnosticsSchema.optional(),
  pastedChildContextWindows: z.array(childContextWindowSchema).optional()
}).strict();

const violationEntrySchema = z.object({
  class: z.string(),
  description: z.string().optional()
}).strict();
const haltEntrySchema = z.object({
  source: z.string(),
  target: z.string(),
  trigger: z.string()
}).strict();
const modelSignalSchema = z.object({
  role: z.string(),
  model: z.string(),
  violations: z.number().int().min(0)
}).strict();

export const sessionReportInputShape = {
  teamCount: z.number().int().min(0).max(26),
  violations: z.array(violationEntrySchema),
  halts: z.array(haltEntrySchema),
  layoutDriftEvents: z.number().int().min(0),
  peakContextPct: z.number().int().min(0).max(100),
  closeoutClean: z.boolean(),
  modelSignals: z.array(modelSignalSchema),
  ax: axDiagnosticsInputSchema.optional()
} as const;

export const sessionReportOutputShape = {
  ...sessionReportInputShape,
  version: z.string(),
  compiledAt: z.string(),
  violationCount: z.number().int().min(0),
  haltCount: z.number().int().min(0),
  axSummary: z.object({
    roleSlotCount: z.number().int().min(0),
    blockerClassifications: z.array(z.string()),
    degradedLayout: z.boolean(),
    driftWarningCount: z.number().int().min(0)
  }).strict().optional()
} as const;

export const sessionReportOutputSchema = z.object(sessionReportOutputShape).strict();
export const reportRecordInputSchema = z.object({
  report: sessionReportOutputSchema
}).strict();

export const submitSessionReportInputSchema = z.object({
  report: sessionReportOutputSchema,
  userConsentConfirmed: z.literal(true)
}).strict();

export const reportRecordInputShape = {
  report: sessionReportOutputSchema
} as const;

export const submitSessionReportInputShape = {
  report: sessionReportOutputSchema,
  userConsentConfirmed: z.literal(true)
} as const;

// BootReceipt: TypeScript interface for governed occupant boot receipts.
// Required fields align with protocol/receipts/boot-receipt.yaml required_fields.
// Optional fields are additive and never break existing receipts.
export interface BootReceipt {
  role: string;
  authority_layer: string;
  team: string;
  terminal_locator: string;
  branch: string;
  cwd: string;
  model_harness: string;
  permission_mode: string;
  may_implement: boolean;
  may_qa_accept: boolean;
  reports_to: string;
  write_scope: string[];
  evidence_path: string;
  current_task: string;
  // Optional recommended fields
  upstream?: string;
  head_sha?: string;
  cost_tier?: string;
  capability_profile?: string;
  delegates_to?: string;
  prohibited_paths?: string[];
  proof_source?: string;
  staffed_by?: string;
  parent_surface_ref?: string;
  column_index?: number | string;
  team_letter?: string;
  lifecycle_state?: string;
  mcp_version?: string;
  scp_context_source?: string;
  instruction_read_proof?: Record<string, unknown>;
  // BootReceiptExtension: new optional fields for performance/portability program
  scp_skill_sha256?: string;
  role_card_sha256?: string;
  harness_id?: string;
}

// ReceiptType: union of all recognized receipt type strings.
// SCP_BOOT_RECEIPT and SCP_MIN_BOOT_RECEIPT are the original types from boot-receipt.yaml.
// POLL_OBSERVATION, POLL_INTERVENTION, DELIVERY_PROOF are new types added by this program.
export type ReceiptType =
  | "SCP_BOOT_RECEIPT"
  | "SCP_MIN_BOOT_RECEIPT"
  | "POLL_OBSERVATION"
  | "POLL_INTERVENTION"
  | "DELIVERY_PROOF";

// Runtime-present const object (holdout asserts runtime existence via `in` check)
export const CapabilityFlag = {
  SEND: "SEND",
  ENTER_PROOF: "ENTER_PROOF",
  READ_SCREEN: "READ_SCREEN",
  WAIT_IDLE: "WAIT_IDLE",
  EVENTS: "EVENTS",
  PERSISTENCE: "PERSISTENCE",
  RECORDING: "RECORDING",
} as const;

// Derived type for TypeScript type annotations
export type CapabilityFlag = (typeof CapabilityFlag)[keyof typeof CapabilityFlag];

export type SubstrateType = "cmux" | "tmux" | "minimux" | "herdr" | "plain";

export interface SubstrateCapability {
  substrate_id: SubstrateType;
  capabilities: CapabilityFlag[];
  tier: number;
}

export type WakeVerdict =
  | "WORKING"
  | "WAITING_APPROVAL"
  | "BLOCKED"
  | "CRASHED"
  | "DEV_COMPLETE_QA_PENDING"
  | "QA_COMPLETE"
  | "IDLE"
  | "UNKNOWN_NEEDS_READ";

export type PromptBudgetClass = "silent" | "compact" | "diagnostic" | "forensic";

export interface WakeState {
  schema_version: "1.0";
  ts: string;
  surface: string;
  pane_id: string;
  substrate: SubstrateType;
  task?: string;
  state: WakeVerdict;
  wake: 0 | 1;
  reason_codes: string[];
  head?: string;
  branch?: string;
  dirty_paths: string[];
  dirty_out_of_scope: string[];
  screen_hash: string;
  screen_changed: boolean;
  last_marker?: string;
  prompt_budget_class: PromptBudgetClass;
  next_mandatory_audit_due: string;
}

export type PacingEventType =
  | "PROMPT_DELIVERY"
  | "IDLE_WAIT"
  | "MODAL_BLOCK"
  | "PERMISSION_BLOCK"
  | "CRASH"
  | "RECOVERY"
  | "MILESTONE";

export interface HarnessPacingEvent {
  harness_id: string;
  event_type: PacingEventType;
  ts: string;
  duration_ms?: number;
  payload_bytes?: number;
  verdict?: string;
  notes?: string;
  crash_signature_hash?: string;
  crash_signature_summary?: string;
  recovery_action?: string;
  // EPIC-020 additive submit/format fields (legacy events without them remain valid).
  submitted?: boolean;             // Enter-delivered vs input-bar-only, per event
  submit_behavior?: string;        // observed submit semantics (e.g. "submits_on_every_newline")
  message_format?: HarnessMessageFormat;
}

export interface DeliveryReceiptPacingExtension {
  prompt_byte_count?: number;
  prompt_line_count?: number;
  prior_wait_seconds?: number;
  delivery_verdict?: string;
  harness_id?: string;
}

// RoleCard: structured response for odin.get_role_card tool.
export interface RoleCard {
  role_id: string;
  role_name: string;
  version: string;
  payload_bytes: number;
  content_sha256: string;
  content: string;
}

export const roleCardInputShape = {
  role_id: z.string().describe("Role ID: exec-pm | team-pm | dev-worker | qa-worker | exec-asst")
} as const;

// MissionFrontrunPack: input schema for odin.get_mission_frontrun_pack.
// Assembles a governance contract pack for Factory Mission front-running via the
// --append-system-prompt-file seam (PROVEN, live-verified 2026-06-12).
export const missionFrontrunInputShape = {
  mission_name: z.string().describe("Human-readable mission name for logging and receipt headers."),
  repo_path: z.string().describe("Absolute path to the target repository root."),
  write_scope: z.array(z.string()).describe("Files the mission worker is allowed to modify. Use [] for no current assignment."),
  task_id: z.string().describe("Task or slice ID binding this mission to ODIN planning (e.g., SLICE-SCPPERF-E010-DEV-001).")
} as const;

export const missionFrontrunInputSchema = z.object(missionFrontrunInputShape);
export type MissionFrontrunInput = z.infer<typeof missionFrontrunInputSchema>;

// MissionFrontrunPack: structured return type for getMissionFrontrunPack().
export interface MissionFrontrunPack {
  mission_name: string;
  repo_path: string;
  task_id: string;
  write_scope: string[];
  contracts: {
    orchestrator: string;
    worker: string;
    scrutiny_validator: string;
    scrutiny_feature_reviewer: string;
    droids_scrutiny_feature_reviewer: string;
  };
  launch_command_template: string;
  boot_contract_receipt_template: {
    role: string;
    session_id: string;
    contract_path: string;
    byte_count: string;
    sha256: string;
    timestamp: string;
  };
  notes: {
    proven_seam: string;
    unproven_seam: string;
    tool: string;
  };
}

// ---------------------------------------------------------------------------
// EPIC-027 — Step-Up Remediation Ladder (odin://protocol/step-up-ladder)
// ---------------------------------------------------------------------------

export const escalationGateVerdictSchema = z.enum([
  "DONE",
  "REMEDIATE",
  "ESCALATE_OPERATOR",
  "INSUFFICIENT_EVIDENCE"
]);
export type EscalationGateVerdict = z.infer<typeof escalationGateVerdictSchema>;

export const escalationFailedGateSchema = z.enum(["QA_REJECT", "HOLDOUT_FAIL", "SELF_PROOF_GAP"]);
export type EscalationFailedGate = z.infer<typeof escalationFailedGateSchema>;

export const escalationGateInputShape = {
  // Ladder shape is configuration: only the tier count matters to the gate.
  tierCount: z.number().int().min(2).max(16),
  currentTierIndex: z.number().int().min(0),
  observations: z.object({
    qa_verdict: z.enum(["PASS", "REJECT"]).optional(),
    holdout_result: z.enum(["PASS", "FAIL"]).optional(),
    self_proof: z.enum(["HOLDS", "GAP"]).optional(),
    self_tool_green: z.boolean().optional(),
    budget_exhausted: z.boolean().optional(),
    blocked: z.boolean().optional()
  }),
  taskRef: z.string().optional()
} as const;
export const escalationGateInputSchema = z.object(escalationGateInputShape);
export type EscalationGateInput = z.infer<typeof escalationGateInputSchema>;

export interface EscalationGateResult {
  verdict: EscalationGateVerdict;
  failed_gates: string[];
  next_tier_index: number | null;
  reasons: string[];
  remediation_requirements: string[] | null;
}

export const remediationPacketInputShape = {
  packet: z.record(z.string(), z.unknown())
} as const;

// ---------------------------------------------------------------------------
// EPIC-020 — Harness-aware delivery: per-harness message-format matrix.
// Field origin (2026-06-27 incident): messages with embedded newlines sent to
// GLM-5.2/Pi were submitted one line per prompt ("machine-gunning"), jamming
// the recipient. The trigger is the embedded \n itself — not multiple send
// calls — so the contract names it explicitly and the safe path auto-flattens.
// ---------------------------------------------------------------------------

/**
 * How a harness turns typed text into a submitted prompt.
 * - single_line_flatten: submits on EVERY newline; messages must be one line
 *   (flatten \n/CR/tab to spaces; use a field separator such as " ;; ").
 * - double_enter: standard send + a second Enter to submit (2nd Enter on busy).
 * - single_enter_verify: exactly one Enter, then read-screen verify; a blind
 *   second Enter interrupts reply generation.
 */
export type SubmitProfile = "single_line_flatten" | "double_enter" | "single_enter_verify";

export type NewlinePolicy = "flatten_to_space" | "preserve";

export interface HarnessMessageFormat {
  harness_id: string;
  submit_profile: SubmitProfile;
  newline_policy: NewlinePolicy;
  multi_line_ok: boolean;
  field_separator?: string;        // e.g. " ;; " for single-line harnesses
  second_enter_on_busy?: boolean;  // long paste during a busy transition needs a 2nd Enter
  notes?: string;
}
