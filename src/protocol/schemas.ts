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
