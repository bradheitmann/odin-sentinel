import { redactPayload } from "./redactor.js";

export type ViolationEntry = {
  class: string;
  description?: string;
};

export type HaltEntry = {
  source: string;
  target: string;
  trigger: string;
};

export type ModelSignal = {
  role: string;
  model: string;
  violations: number;
};

export type DiagnosticStatus = "verified" | "missing" | "blocked" | "unknown" | "not_applicable";

export type DiagnosticCheck = {
  status: DiagnosticStatus;
  detail?: string;
  evidence?: string;
};

export type PromptType = "full_protocol" | "short_boot_prompt" | "handoff" | "unknown";
export type ReadinessStatus = "ready" | "degraded" | "blocked" | "unknown";
export type ReceiptStatus = "emitted" | "missing" | "invalid" | "unknown" | "not_applicable";
export type WatchStatus = "active" | "passive" | "idle" | "blocked" | "unknown" | "not_applicable";

export type BlockerClassification =
  | "none"
  | "stale_mcp_version"
  | "missing_skill"
  | "short_prompt"
  | "passive_odin"
  | "split_workspace"
  | "tab_heavy_layout"
  | "auth_blocker"
  | "permission_blocker"
  | "local_inference_stall"
  | "role_refusal"
  | "missing_protocol_text"
  | "operator_authority_confusion"
  | "receipt_missing"
  | "runbook_improvisation"
  | "readiness_gate_skipped";

export type RoleSlotLocator = {
  workspace?: string;
  pane?: string;
  surface?: string;
};

export type RoleSlotDiagnostic = {
  role: string;
  team: string;
  harness: string;
  model: string;
  locator: RoleSlotLocator;
  mcpAccess: DiagnosticCheck;
  mcpVersion?: string;
  minimumCompatibleMcpVersion?: string;
  skillAccess: DiagnosticCheck;
  fullProtocolTextReceived: DiagnosticCheck;
  promptType: PromptType;
  operatorAuthorityRecognized: DiagnosticCheck;
  readinessStatus: ReadinessStatus;
  bootReceiptStatus: ReceiptStatus;
  activeWatchStatus: WatchStatus;
  blockerClassification: BlockerClassification[];
  childContextText?: string;
  notes?: string[];
};

export type HarnessFailureDiagnostics = {
  openHandsAuthApiCredentials: DiagnosticCheck;
  kiloCodeLogin: DiagnosticCheck;
  gooseLocalInferenceStall: DiagnosticCheck;
  crushPermissionPrompt: DiagnosticCheck;
  piRoleRefusal: DiagnosticCheck;
  staleMcpVersion: DiagnosticCheck;
};

export type LayoutDiagnostics = {
  sameWorkspace: boolean | "unknown";
  splitWorkspace: boolean;
  spatialPodLayout: boolean | "unknown";
  tabHeavyLayout: boolean;
  cmuxAvailable: boolean | "unknown";
  degradedLayoutWarnings: string[];
};

export type LaunchRunbookDiagnostics = {
  deterministicRunbookFollowed: boolean | "unknown";
  firstImprovisationPoint?: string;
  missingPrompts: string[];
  missingTools: string[];
  missingSchemas: string[];
};

export type ReadinessGateDiagnostics = {
  childMcpVerified: DiagnosticCheck;
  skillVerified: DiagnosticCheck;
  authVerified: DiagnosticCheck;
  firstRunPromptVerified: DiagnosticCheck;
  modelSmokeVerified: DiagnosticCheck;
  roleCompatibilityVerified: DiagnosticCheck;
};

export type ReleaseVersionDiagnostics = {
  currentServerVersion: string;
  minimumCompatibleVersion: string;
  childReportedMcpVersions: Array<{ role: string; version: string }>;
  driftWarnings: string[];
};

export type ArtifactDiagnostics = {
  planningArtifactsLocalOnly: boolean | "unknown";
  publicTemplatesSanitized: boolean | "unknown";
  privateArtifactWarnings: string[];
};

export type ChildContextWindow = {
  role: string;
  text: string;
};

export type AxDiagnostics = {
  roleSlots: RoleSlotDiagnostic[];
  childAgentQuestions: string[];
  odinQuestions: string[];
  harnessFailures: HarnessFailureDiagnostics;
  layout: LayoutDiagnostics;
  launchRunbook: LaunchRunbookDiagnostics;
  readinessGates: ReadinessGateDiagnostics;
  versions: ReleaseVersionDiagnostics;
  artifacts: ArtifactDiagnostics;
  pastedChildContextWindows?: ChildContextWindow[];
};

export type AxSummary = {
  roleSlotCount: number;
  blockerClassifications: BlockerClassification[];
  degradedLayout: boolean;
  driftWarningCount: number;
};

export type SessionReportInput = {
  teamCount: number;
  violations: ViolationEntry[];
  halts: HaltEntry[];
  layoutDriftEvents: number;
  peakContextPct: number;
  closeoutClean: boolean;
  modelSignals: ModelSignal[];
  ax?: Partial<AxDiagnostics>;
};

export type SessionReport = SessionReportInput & {
  version: string;
  compiledAt: string;
  violationCount: number;
  haltCount: number;
  axSummary?: AxSummary;
};

export const CHILD_AGENT_DIAGNOSTIC_QUESTIONS = [
  "What role slot, team, harness, model, workspace, pane, and surface were you assigned?",
  "Did you have ODIN Sentinel MCP access, and what MCP version did you see?",
  "Did you have native skill access for the requested role, or was a required skill missing?",
  "Did you receive the full protocol text, a handoff, or only a short boot prompt?",
  "Did you recognize A/EXEC-PM operator authority and your own implementation/QA limits?",
  "Did you emit the required boot receipt or explain why receipt emission was blocked?",
  "What blocker or confusion stopped progress, using the closest standard classification?",
  "What exact prompt, tool, schema, layout, auth, or runbook change would make launch smoother next time?"
] as const;

export const ODIN_DIAGNOSTIC_QUESTIONS = [
  "Were you explicitly instructed to poll actively, or did you interpret the role as passive observation?",
  "Which workspaces, panes, surfaces, agents, files, queues, or receipts were you watching?",
  "Did plan mode, read-only mode, permission prompts, or role boundaries conflict with active intervention?",
  "What exact polling prompt or cadence would have made the watch loop unambiguous?",
  "Which terminal states did you detect: idle, blocked, still thinking, input-bar-only, delivered-no-ack, or done?",
  "What intervention would you have issued if active polling authority had been clear?"
] as const;

const HARNESS_BLOCKER_MAP: Array<[keyof HarnessFailureDiagnostics, BlockerClassification]> = [
  ["openHandsAuthApiCredentials", "auth_blocker"],
  ["kiloCodeLogin", "auth_blocker"],
  ["gooseLocalInferenceStall", "local_inference_stall"],
  ["crushPermissionPrompt", "permission_blocker"],
  ["piRoleRefusal", "role_refusal"],
  ["staleMcpVersion", "stale_mcp_version"]
];

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isBlocking(status: DiagnosticStatus): boolean {
  return status === "missing" || status === "blocked";
}

function summarizeAx(ax: Partial<AxDiagnostics> | undefined): AxSummary | undefined {
  if (!ax) return undefined;
  const blockers: BlockerClassification[] = [];
  for (const roleSlot of ax.roleSlots ?? []) {
    blockers.push(...roleSlot.blockerClassification.filter((entry) => entry !== "none"));
    if (roleSlot.promptType === "short_boot_prompt") blockers.push("short_prompt");
    if (roleSlot.fullProtocolTextReceived.status === "missing") blockers.push("missing_protocol_text");
    if (roleSlot.skillAccess.status === "missing") blockers.push("missing_skill");
    if (roleSlot.activeWatchStatus === "passive" || roleSlot.activeWatchStatus === "idle") blockers.push("passive_odin");
    if (roleSlot.bootReceiptStatus === "missing") blockers.push("receipt_missing");
  }
  if (ax.harnessFailures) {
    for (const [key, classification] of HARNESS_BLOCKER_MAP) {
      if (isBlocking(ax.harnessFailures[key].status)) blockers.push(classification);
    }
  }
  if (ax.layout?.splitWorkspace) blockers.push("split_workspace");
  if (ax.layout?.tabHeavyLayout) blockers.push("tab_heavy_layout");
  if (ax.launchRunbook?.deterministicRunbookFollowed === false) blockers.push("runbook_improvisation");
  if ((ax.versions?.driftWarnings.length ?? 0) > 0) blockers.push("stale_mcp_version");

  return {
    roleSlotCount: ax.roleSlots?.length ?? 0,
    blockerClassifications: uniq(blockers),
    degradedLayout: Boolean(ax.layout?.splitWorkspace || ax.layout?.tabHeavyLayout || (ax.layout?.degradedLayoutWarnings.length ?? 0) > 0),
    driftWarningCount: ax.versions?.driftWarnings.length ?? 0
  };
}

export function getAxDiagnosticQuestions(scope: "child" | "odin" | "all" = "all"): string[] {
  if (scope === "child") return [...CHILD_AGENT_DIAGNOSTIC_QUESTIONS];
  if (scope === "odin") return [...ODIN_DIAGNOSTIC_QUESTIONS];
  return [...CHILD_AGENT_DIAGNOSTIC_QUESTIONS, ...ODIN_DIAGNOSTIC_QUESTIONS];
}

export function compileSessionReport(input: SessionReportInput, version: string): SessionReport {
  const redacted = redactPayload(input) as SessionReportInput;
  return {
    ...redacted,
    version,
    compiledAt: new Date().toISOString(),
    violationCount: redacted.violations.length,
    haltCount: redacted.halts.length,
    axSummary: summarizeAx(redacted.ax)
  };
}
