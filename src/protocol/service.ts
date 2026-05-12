import YAML from "yaml";
import {
  createFileProtocolRepository,
  type ProtocolData,
  type ProtocolRepository
} from "./repository.js";
import type { CloseoutMode, DelegationPacketInput, StartupPacketInput } from "./schemas.js";
import {
  asRecord,
  buildValidationResult,
  isVisibleRoleSlot,
  isVersionBelow,
  redactSecretLikeText,
  requireRecord,
  requireStringArray,
  type ValidationResult,
  validateFieldTypes,
  validateNonEmptyArrays,
  validateRequiredFields
} from "./validators.js";
import { MINIMUM_COMPATIBLE_MCP_VERSION, PROTOCOL_SCHEMA_VERSION, PUBLIC_LATEST_VERSION, VERSION } from "./version.js";

const DEFAULT_ROLE_SLOT = "A/EXEC-PM";
const DEFAULT_HANDOFF_PATHS = [
  "docs/handoffs/",
  ".odin/handoffs/",
  ".odin/audit/"
];

export type { ProtocolData, ValidationResult };
export type { CloseoutMode, DelegationPacketInput, StartupPacketInput };
export { VERSION };

export type StartupPacket = {
  version: string;
  protocolVersion: string;
  publicLatestVersion: string;
  minimumCompatibleMcpVersion: string;
  role: string;
  pods: number;
  governedMode: "GOVERNED_TEAM" | "NON_GOVERNED_ONE_SHOT_ONLY" | "BLOCKED";
  layoutProfile: string;
  resourcesToRead: string[];
  requiredActions: string[];
  defaultTopology: unknown;
  modelProfile: unknown;
  bootReceiptRequiredFields: unknown;
  bootReceiptSchema: Record<string, unknown>;
  teamManifestLocator: string;
  activeWatch: Record<string, unknown>;
  startupPrompt: string;
};

export type RuntimeNotice = {
  inferenceProvider: "none";
  hostedService: false;
  telemetry: "local_optional";
  networkCalls: "none_by_default_optional_on_submit";
  maintainerPaysForUserInference: false;
  userPaysForHarnessInference: true;
  externalOrchestrationBundled: false;
  telemetryAutomaticCollection: false;
  telemetrySubmissionRequiresEndpoint: true;
  telemetrySubmissionRequiresExplicitInvocation: true;
  notes: string[];
};

let defaultRepository: ProtocolRepository | undefined;

function getDefaultRepository(): ProtocolRepository {
  defaultRepository ??= createFileProtocolRepository();
  return defaultRepository;
}

export function protocolPath(...segments: string[]): string {
  return getDefaultRepository().path(...segments);
}

function normalizeRoleName(role: string): string {
  const visibleSlot = role.includes("/") ? role.split("/").at(-1) ?? role : role;
  const normalized = visibleSlot.toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized === "ODIN") return "TEAM_ODIN";
  if (/^DEV_\d+$/.test(normalized)) return "DEV_WORKER";
  if (/^QA_\d+$/.test(normalized)) return "QA_WORKER";
  if (/^SHADOW_\d+$/.test(normalized)) return "SHADOW_REVIEWER";
  return normalized;
}

function modelProfileKeys(role: string): string[] {
  const normalized = normalizeRoleName(role);
  const executiveSlot = normalized.startsWith("EXEC_") ? `A/${normalized.replaceAll("_", "-")}` : undefined;
  return [role, executiveSlot, normalized].filter((key): key is string => Boolean(key));
}

function safeErrorText(value: string): string {
  const sanitized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (sanitized.length === 0) return "<empty>";
  return sanitized.length > 120 ? `${sanitized.slice(0, 117)}...` : sanitized;
}

const GOVERNED_LAUNCH_PHASES = [
  "SURFACE_PROVISIONED",
  "OCCUPANT_READINESS",
  "OCCUPANT_LAUNCH",
  "BOOT_RECEIPT_VALIDATION",
  "TEAM_ACTIVATION",
  "ACTIVE_WATCH"
] as const;

const ACTIVE_WATCH_TERMINAL_STATES = [
  "RELEASED_BY_OPERATOR",
  "HANDED_OFF",
  "PARKED_IDLE",
  "FAILED",
  "WATCH_UNSUPPORTED"
] as const;

const AUTH_STATUSES = [
  "AUTH_READY",
  "AUTH_PRESENT_UNVERIFIED",
  "AUTH_MISSING",
  "AUTH_PROVIDER_BLOCKED",
  "AUTH_LOGIN_REQUIRED",
  "AUTH_UNKNOWN"
] as const;

const MODEL_STATUSES = [
  "MODEL_READY",
  "MODEL_SLOW",
  "MODEL_STALLED",
  "MODEL_REASONING_ONLY",
  "STREAMING_PROTOCOL_MISMATCH",
  "MODEL_UNREACHABLE"
] as const;

type ReadinessStatus = "PASS" | "FAIL" | "WAIVED_BY_EXEC_PM" | "SUBSTITUTION_APPROVED_BY_EXEC_PM" | "NON_GOVERNED_ONE_SHOT_ONLY";

export type ReadinessSlotInput = {
  roleSlot: string;
  role?: string;
  team?: string;
  cwd?: string;
  harness?: string;
  mcpAvailable?: boolean;
  mcpVersion?: string;
  scpSkillAvailable?: boolean;
  fullProtocolTextInjected?: boolean;
  protocolTextSource?: "native_skill" | "mcp_resource" | "injected_full_text" | "none";
  authStatus?: (typeof AUTH_STATUSES)[number];
  firstRunPermissionStatus?: "CLEAR" | "PROMPT_WAITING" | "DENIED" | "UNKNOWN";
  modelStatus?: (typeof MODEL_STATUSES)[number];
  roleCompatibility?: "ACCEPTS_ROLE" | "REFUSES_ROLE" | "UNPROVEN";
  canHydrateDeferredMcpToolsAtBoot?: boolean;
  canHydrateDeferredMcpToolsAfterSecondTurn?: boolean;
  nativeSkillInvocation?: boolean;
  waiver?: "WAIVED_BY_EXEC_PM" | "SUBSTITUTION_APPROVED_BY_EXEC_PM";
  fallbackHarness?: string;
  occupantState?: string;
  required?: boolean;
};

export type ReadinessGateInput = {
  minimumMcpVersion?: string;
  execPmAuthorized?: boolean;
  cmuxAvailable?: boolean;
  userProvisioningAnswer?: "yes" | "no" | "unknown";
  slots: ReadinessSlotInput[];
};

export type ReadinessMatrixRow = {
  roleSlot: string;
  harness: string;
  status: ReadinessStatus;
  launchAllowed: boolean;
  activationAllowed: boolean;
  classifications: string[];
  safeOutcomes: string[];
  scpContextSources: string[];
  mcpVersion?: string;
  deferredMcpHydration: "AT_BOOT" | "AFTER_SECOND_TURN" | "UNPROVEN";
  nativeSkillInvocation: boolean;
  notes: string[];
};

export type ActiveWatchPacketInput = {
  role: string;
  parkedMode?: boolean;
  planMode?: boolean;
  pollIntervalSeconds?: number;
  manifest?: Record<string, unknown>;
};

export type HarnessProbeInput = {
  intendedHarnesses?: string[];
  userProvisioningAnswer?: "yes" | "no" | "unknown";
  installedHarnesses?: string[];
  providerStatuses?: Record<string, boolean>;
  observations?: Array<{
    harness: string;
    text?: string;
    exitCode?: number;
    httpReachable?: boolean;
    modelLoaded?: boolean;
    visibleContent?: boolean;
    reasoningContentOnly?: boolean;
    elapsedSeconds?: number;
  }>;
  visibleOutputTimeoutSeconds?: number;
};

function roleKind(roleSlot: string): string {
  return normalizeRoleName(roleSlot);
}

function isOdinRole(role: string): boolean {
  const normalized = roleKind(role);
  return normalized === "EXEC_ODIN" || normalized === "TEAM_ODIN";
}

function isGovernedRole(role: string): boolean {
  return ["EXEC_PM", "EXEC_ODIN", "EXEC_ASST", "EXEC_RSCH", "EXEC_QA", "TEAM_PM", "TEAM_ODIN", "DEV_WORKER", "QA_WORKER", "SHADOW_REVIEWER"].includes(roleKind(role));
}

function scpContextSources(slot: ReadinessSlotInput): string[] {
  const sources = new Set<string>();
  if (slot.scpSkillAvailable === true || slot.protocolTextSource === "native_skill") {
    sources.add("native sentinel-coordination-protocol skill");
  }
  if (slot.fullProtocolTextInjected === true || slot.protocolTextSource === "injected_full_text") {
    sources.add("full injected SCP protocol text");
  }
  if (slot.protocolTextSource === "mcp_resource") {
    sources.add("odin-sentinel MCP bootstrap resource");
  }
  return Array.from(sources);
}

function defaultSafeOutcomes(): string[] {
  return [
    "choose a different harness",
    "receive setup guidance without pasting secrets",
    "mark slot VACANT_ROLE_SLOT",
    "request EXEC PM-approved substitution"
  ];
}

function stringFieldPresent(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function classifyProbeText(harness: string, text: string): string[] {
  const safeText = redactSecretLikeText(text).toLowerCase();
  const classes: string[] = [];
  if (/permission|allow|approve|deny|press y|waiting for confirmation/.test(safeText)) classes.push("BLOCKED_BY_PERMISSION");
  if (/login|sign in|authenticate|kilo auth login|\/connect/.test(safeText)) classes.push("BLOCKED_BY_LOGIN");
  if (/api key|apikey|credential|inference credential|provider config|openhands/.test(safeText)) classes.push("BLOCKED_BY_API_KEY");
  if (/permission denied|eacces|operation not permitted/.test(safeText)) classes.push("BLOCKED_BY_PERMISSION");
  if (/roleplay|fiction|cannot accept role|not a real protocol/.test(safeText)) classes.push("ROLE_COMPATIBILITY_FAILED");
  if (harness.toLowerCase() === "kilocode" && /auth login|\/connect|login/.test(safeText)) classes.push("BLOCKED_BY_LOGIN");
  if (harness.toLowerCase() === "openhands" && /api|credential|provider/.test(safeText)) classes.push("AUTH_PROVIDER_BLOCKED");
  if (harness.toLowerCase() === "crush" && /permission|denied|approve/.test(safeText)) classes.push("BLOCKED_BY_PERMISSION");
  if (harness.toLowerCase() === "pi" && /role|mcp|skill|runtime proof|fiction/.test(safeText)) classes.push("ROLE_COMPATIBILITY_FAILED");
  return [...new Set(classes)];
}

function normalizePodCount(pods: number | undefined): number {
  const value = pods ?? 1;
  if (!Number.isInteger(value) || value < 0 || value > 25) {
    throw new Error(`Invalid development pod count: ${value}`);
  }
  return value;
}

export function loadProtocolData(repository: ProtocolRepository = getDefaultRepository()): ProtocolData {
  return repository.load();
}

export function getRoleProfile(role: string, repository: ProtocolRepository = getDefaultRepository()): unknown {
  const data = loadProtocolData(repository);
  const roles = requireRecord(data.roles.roles, "roles.roles");
  const normalized = normalizeRoleName(role);
  const roleProfile = roles?.[normalized];

  if (!roleProfile) {
    throw new Error(`Unknown ODIN/SCP role: ${safeErrorText(role)}`);
  }

  return roleProfile;
}

export function getStartupPacket(
  input: StartupPacketInput = {},
  repository: ProtocolRepository = getDefaultRepository()
): StartupPacket {
  const data = loadProtocolData(repository);
  const role = input.role ?? DEFAULT_ROLE_SLOT;
  getRoleProfile(role, repository);
  const pods = normalizePodCount(input.pods);
  const resourcesToRead = [
    "odin://protocol/main",
    "odin://protocol/roles",
    "odin://protocol/topology",
    "odin://protocol/model-profiles",
    "odin://protocol/closeout",
    "odin://protocol/delegation",
    "odin://protocol/receipts/boot",
    "odin://protocol/receipts/team-manifest",
    ...(input.handoffPaths ?? DEFAULT_HANDOFF_PATHS)
  ];

  const requiredActions = [
    "emit SCP_BOOT_RECEIPT or SCP_MIN_BOOT_RECEIPT before broad dispatch",
    "use visible role slots only; do not create hidden subagents",
    `bootstrap executive office plus ${pods} development pod${pods === 1 ? "" : "s"}`,
    "state SESSION_OBJECTIVES before product dispatch",
    "refresh repo status, upstream parity, worktrees, stashes, and topology before lifecycle claims"
  ];

  const modelProfiles = requireRecord(data.modelProfiles.profiles, "model-profiles.profiles");
  const roleModelProfile = modelProfileKeys(role)
    .map((key) => modelProfiles[key])
    .find((profile) => profile !== undefined) ?? modelProfiles[DEFAULT_ROLE_SLOT];
  if (!roleModelProfile) {
    throw new Error(`No model profile found for role: ${safeErrorText(role)}`);
  }
  const governedMode = input.governedMode ?? "GOVERNED_TEAM";
  const layoutProfile = input.layoutProfile ?? "human_cmux_quad";
  const activeWatch = getActiveWatchPacket({
    role,
    parkedMode: input.parkedMode,
    manifest: {
      executive_office: ["A/EXEC-PM", "A/EXEC-ODIN", "A/EXEC-ASST", "A/EXEC-RSCH", "A/EXEC-QA"],
      development_pods: ["B", "C"]
    }
  });

  return {
    version: VERSION,
    protocolVersion: PROTOCOL_SCHEMA_VERSION,
    publicLatestVersion: PUBLIC_LATEST_VERSION,
    minimumCompatibleMcpVersion: MINIMUM_COMPATIBLE_MCP_VERSION,
    role,
    pods,
    governedMode,
    layoutProfile,
    resourcesToRead,
    requiredActions,
    defaultTopology: data.topology.default_topology,
    modelProfile: roleModelProfile,
    bootReceiptRequiredFields: data.bootReceipt.required_fields,
    bootReceiptSchema: getBootReceiptSchema(repository),
    teamManifestLocator: "odin://protocol/receipts/team-manifest",
    activeWatch,
    startupPrompt: [
      "Use ODIN Sentinel coordination.",
      "",
      `You are ${role}.`,
      `Governed mode: ${governedMode}.`,
      `ODIN Sentinel MCP version: ${VERSION}; public/latest target: ${PUBLIC_LATEST_VERSION}; minimum compatible child MCP version: ${MINIMUM_COMPATIBLE_MCP_VERSION}.`,
      `Expected layout profile: ${layoutProfile}. A/EXEC-PM stays in the same CMUX workspace as governed teams.`,
      "Load startup requirements from the odin-sentinel MCP resources and tools. Do not assume external local extensions exist.",
      "Before occupant launch, readiness must PASS or be explicitly WAIVED_BY_EXEC_PM / SUBSTITUTION_APPROVED_BY_EXEC_PM.",
      "Valid SCP context source required for governed occupants: native sentinel-coordination-protocol skill, compatible odin-sentinel MCP, or full injected SCP protocol text.",
      "Boot receipt schema: use write_scope: [] for no current write assignment; do not use null.",
      "Team manifest locator: odin://protocol/receipts/team-manifest.",
      input.repoPath ? `Repository: ${input.repoPath}` : "Repository: discover from current working directory.",
      `Bootstrap executive office plus ${pods} development pod${pods === 1 ? "" : "s"} unless handoff or user instruction overrides this.`,
      isOdinRole(role) ? String(activeWatch.promptText) : "Non-ODIN role: no ODIN active-watch authority.",
      input.userInstruction ? `User instruction: ${input.userInstruction}` : "Ask for objectives if no handoff supplies them."
    ].join("\n")
  };
}

export function getVersionMetadata(): Record<string, unknown> {
  return {
    name: "odin-sentinel",
    version: VERSION,
    serverVersion: VERSION,
    protocolVersion: PROTOCOL_SCHEMA_VERSION,
    publicLatestVersion: PUBLIC_LATEST_VERSION,
    minimumCompatibleMcpVersion: MINIMUM_COMPATIBLE_MCP_VERSION,
    driftChecks: {
      observedTooOldExample: "0.2.1",
      tooOldClass: "MCP_VERSION_TOO_OLD",
      publicLatestDiffersFromProtocol: PUBLIC_LATEST_VERSION !== PROTOCOL_SCHEMA_VERSION
    }
  };
}

export function getBootReceiptSchema(repository: ProtocolRepository = getDefaultRepository()): Record<string, unknown> {
  const data = loadProtocolData(repository);
  return {
    receipt_types: ["SCP_BOOT_RECEIPT", "SCP_MIN_BOOT_RECEIPT"],
    minimumCompatibleMcpVersion: MINIMUM_COMPATIBLE_MCP_VERSION,
    required_fields: data.bootReceipt.required_fields,
    field_types: {
      role: "string",
      authority_layer: "string",
      team: "string",
      terminal_locator: "string",
      branch: "string",
      cwd: "string",
      model_harness: "string",
      permission_mode: "string",
      may_implement: "boolean",
      may_qa_accept: "boolean",
      reports_to: "string",
      write_scope: "string[]; use [] when unassigned; null is invalid",
      evidence_path: "string",
      current_task: "string"
    },
    allowed_lifecycle_states: [
      "SURFACE_PROVISIONED",
      "BOOTSTRAPPED_IDLE",
      "ACTIVE_WATCH",
      "VACANT_ROLE_SLOT",
      "AGENT_SUBSTITUTION_REQUIRED",
      "RELEASED_BY_OPERATOR",
      "HANDED_OFF",
      "PARKED_IDLE",
      "FAILED",
      "WATCH_UNSUPPORTED"
    ],
    examples: getBootReceiptExamples()
  };
}

export function getBootReceiptExamples(): Record<string, Record<string, unknown>> {
  const base = {
    branch: "main",
    cwd: "/path/to/repo",
    permission_mode: "workspace-write",
    evidence_path: ".odin/audit/session",
    current_task: "bootstrap",
    write_scope: []
  };
  return {
    pm: { ...base, role: "A/EXEC-PM", authority_layer: "executive", team: "A", terminal_locator: "workspace:1 pane:a surface:pm", model_harness: "Codex CLI", may_implement: false, may_qa_accept: false, reports_to: "operator" },
    odin: { ...base, role: "A/EXEC-ODIN", authority_layer: "meta_control", team: "A", terminal_locator: "workspace:1 pane:a surface:odin", model_harness: "Codex CLI", may_implement: false, may_qa_accept: false, reports_to: "operator", lifecycle_state: "ACTIVE_WATCH" },
    dev_waiting_for_scope: { ...base, role: "B/DEV-1", authority_layer: "implementation", team: "B", terminal_locator: "workspace:1 pane:b surface:dev-1", model_harness: "Droid", may_implement: true, may_qa_accept: false, reports_to: "B/TEAM-PM", lifecycle_state: "BOOTSTRAPPED_IDLE", staffed_by: "A/EXEC-PM", parent_surface_ref: "pane:b", column_index: 1, team_letter: "B" },
    qa: { ...base, role: "B/QA-1", authority_layer: "quality", team: "B", terminal_locator: "workspace:1 pane:b surface:qa-1", model_harness: "Crush", may_implement: false, may_qa_accept: true, reports_to: "B/TEAM-PM", staffed_by: "A/EXEC-PM", parent_surface_ref: "pane:b", column_index: 1, team_letter: "B" },
    shadow: { ...base, role: "B/SHADOW-1", authority_layer: "review", team: "B", terminal_locator: "workspace:1 pane:b surface:shadow-1", model_harness: "Droid", may_implement: false, may_qa_accept: false, reports_to: "B/TEAM-PM", staffed_by: "A/EXEC-PM", parent_surface_ref: "pane:b", column_index: 1, team_letter: "B" }
  };
}

export function getDelegationPacket(input: DelegationPacketInput): Record<string, unknown> {
  return {
    receipt_type: "SCP-DELEGATE",
    source_role: input.sourceRole,
    target_role_slot: input.targetRoleSlot,
    task: input.task,
    scope: input.scope ?? "bounded task scope; caller must specify exact files or artifacts before mutation",
    authority: {
      may_implement: input.mayImplement ?? false,
      may_qa_accept: input.mayQaAccept ?? false,
      write_scope: input.writeScope ?? [],
      read_scope: input.readScope ?? [],
      prohibited_paths: input.prohibitedPaths ?? []
    },
    visibility: {
      requires_visible_role_slot: true,
      hidden_agents_allowed: false,
      delivery_proof_required: true
    },
    report_back: input.reportBack ?? "Return status, evidence path, blockers, touched files, and next requested action.",
    required_delivery_states: ["DELIVERED_ACKED", "DELIVERED_NO_ACK", "INPUT_BAR_ONLY", "PANE_BLOCKED_ON_PERMISSION", "PANE_STILL_THINKING"]
  };
}

export function validateDelegationPacket(
  packet: Record<string, unknown>,
  repository: ProtocolRepository = getDefaultRepository()
): ValidationResult {
  const data = loadProtocolData(repository);
  const contract = requireRecord(data.delegation.delegation_contract, "delegation.delegation_contract");
  const required = requireStringArray(contract.required_fields, "delegation.delegation_contract.required_fields");
  const authorityRequired = requireStringArray(contract.authority_fields, "delegation.delegation_contract.authority_fields");
  const visibilityRequired = requireStringArray(contract.visibility_fields, "delegation.delegation_contract.visibility_fields");
  const receiptTypes = requireStringArray(contract.receipt_types, "delegation.delegation_contract.receipt_types");
  const authority = asRecord(packet.authority);
  const visibility = asRecord(packet.visibility);
  const missing = [
    ...validateRequiredFields(packet, required),
    ...validateRequiredFields(authority, authorityRequired).map((field) => `authority.${field}`),
    ...validateRequiredFields(visibility, visibilityRequired).map((field) => `visibility.${field}`)
  ];
  const invalid = [
    ...validateFieldTypes(packet, {
      receipt_type: "string",
      source_role: "string",
      target_role_slot: "string",
      task: "string",
      scope: "string",
      authority: "object",
      report_back: "string",
      visibility: "object"
    }),
    ...validateFieldTypes(authority, {
      may_implement: "boolean",
      may_qa_accept: "boolean",
      write_scope: "string_array",
      read_scope: "string_array",
      prohibited_paths: "string_array"
    }).map((field) => `authority.${field}`),
    ...validateFieldTypes(visibility, {
      requires_visible_role_slot: "boolean",
      hidden_agents_allowed: "boolean",
      delivery_proof_required: "boolean"
    }).map((field) => `visibility.${field}`)
  ];
  const warnings: string[] = [];

  if (typeof packet.receipt_type === "string" && !receiptTypes.includes(packet.receipt_type)) {
    invalid.push("receipt_type");
  }

  if (typeof packet.target_role_slot === "string" && !isVisibleRoleSlot(packet.target_role_slot)) {
    invalid.push("target_role_slot");
  }

  if (visibility?.hidden_agents_allowed === true) {
    invalid.push("visibility.hidden_agents_allowed");
    warnings.push("delegation permits hidden agents; ODIN requires visible role slots");
  }

  if (visibility?.requires_visible_role_slot === false) {
    invalid.push("visibility.requires_visible_role_slot");
    warnings.push("delegation does not require a visible role slot");
  }

  if (visibility?.delivery_proof_required === false) {
    invalid.push("visibility.delivery_proof_required");
    warnings.push("delegation does not require delivery proof");
  }

  if (authority?.may_implement === true && authority?.may_qa_accept === true) {
    invalid.push("authority.may_qa_accept");
    warnings.push("same delegation grants implementation and QA acceptance authority");
  }

  return buildValidationResult(missing, invalid, warnings);
}

export function validateBootReceipt(
  receipt: Record<string, unknown>,
  repository: ProtocolRepository = getDefaultRepository()
): ValidationResult {
  const data = loadProtocolData(repository);
  const required = requireStringArray(data.bootReceipt.required_fields, "boot-receipt.required_fields");
  const missing = validateRequiredFields(receipt, required);
  const invalid = validateFieldTypes(receipt, {
    role: "string",
    authority_layer: "string",
    team: "string",
    terminal_locator: "string",
    branch: "string",
    cwd: "string",
    model_harness: "string",
    permission_mode: "string",
    may_implement: "boolean",
    may_qa_accept: "boolean",
    reports_to: "string",
    write_scope: "string_array",
    evidence_path: "string",
    current_task: "string",
    staffed_by: "string",
    parent_surface_ref: "string",
    team_letter: "string"
  });
  const warnings: string[] = [];

  if (receipt.write_scope === null) {
    invalid.push("write_scope");
    warnings.push("write_scope: null is invalid; use write_scope: [] for unassigned or no-write roles");
  } else if (typeof receipt.write_scope === "string") {
    invalid.push("write_scope");
    warnings.push("write_scope must be an array of strings; use [] when no write scope is assigned");
  }

  if (
    typeof receipt.lifecycle_state === "string" &&
    ![
      "SURFACE_PROVISIONED",
      "BOOTSTRAPPED_IDLE",
      "ACTIVE_WATCH",
      "VACANT_ROLE_SLOT",
      "AGENT_SUBSTITUTION_REQUIRED",
      "RELEASED_BY_OPERATOR",
      "HANDED_OFF",
      "PARKED_IDLE",
      "FAILED",
      "WATCH_UNSUPPORTED"
    ].includes(receipt.lifecycle_state)
  ) {
    invalid.push("lifecycle_state");
    warnings.push("lifecycle_state is not one of the canonical ODIN/SCP states");
  }

  if (typeof receipt.mcp_version === "string" && isVersionBelow(receipt.mcp_version, MINIMUM_COMPATIBLE_MCP_VERSION)) {
    invalid.push("mcp_version");
    warnings.push(`MCP_VERSION_TOO_OLD: minimum compatible odin-sentinel MCP version is ${MINIMUM_COMPATIBLE_MCP_VERSION}`);
  }

  if (receipt.may_implement === true && receipt.may_qa_accept === true) {
    invalid.push("may_qa_accept");
    warnings.push("same receipt grants both implementation and QA acceptance authority");
  }

  if (typeof receipt.model_harness === "string" && /token|key|secret/i.test(receipt.model_harness)) {
    warnings.push("model_harness appears to contain secret-like wording");
  }

  if (receipt.column_index !== undefined && receipt.column_index !== null) {
    if (typeof receipt.column_index !== "number" || !Number.isInteger(receipt.column_index) || receipt.column_index < 0) {
      invalid.push("column_index");
    }
  }

  const staffingAuditAudit = asRecord(data.bootReceipt.staffing_audit);
  const team = typeof receipt.team === "string" ? receipt.team : undefined;
  if (team && team !== "A") {
    const requiredForNonExec = Array.isArray(staffingAuditAudit.required_for_non_exec_team)
      ? (staffingAuditAudit.required_for_non_exec_team as unknown[]).filter((field): field is string => typeof field === "string")
      : ["staffed_by", "parent_surface_ref", "column_index", "team_letter"];
    for (const field of requiredForNonExec) {
      const current = receipt[field];
      if (current === undefined || current === null || (typeof current === "string" && current.trim() === "")) {
        warnings.push(`staffing audit field missing on non-exec receipt: ${field}`);
      }
    }
    const canonicalStaffer =
      typeof staffingAuditAudit.staffed_by_canonical_value === "string"
        ? staffingAuditAudit.staffed_by_canonical_value
        : "A/EXEC-PM";
    if (typeof receipt.staffed_by === "string" && receipt.staffed_by !== canonicalStaffer) {
      warnings.push(`staffed_by is "${receipt.staffed_by}" but staffing authority belongs solely to ${canonicalStaffer}`);
    }
  }

  return buildValidationResult(missing, invalid, warnings);
}

export function validateTeamManifest(
  manifest: Record<string, unknown>,
  repository: ProtocolRepository = getDefaultRepository()
): ValidationResult {
  const data = loadProtocolData(repository);
  const required = requireStringArray(data.teamManifest.required_fields, "team-manifest.required_fields");
  const roleSlotSchema = requireRecord(data.teamManifest.role_slot_schema, "team-manifest.role_slot_schema");
  const requiredRoleSlotFields = requireStringArray(roleSlotSchema.required_fields, "team-manifest.role_slot_schema.required_fields");
  const layoutLocatorFields = requireStringArray(roleSlotSchema.layout_locator_fields, "team-manifest.role_slot_schema.layout_locator_fields");
  const readinessStatuses = requireStringArray(roleSlotSchema.readiness_statuses, "team-manifest.role_slot_schema.readiness_statuses");
  const scpContextSources = requireStringArray(data.teamManifest.scp_context_sources, "team-manifest.scp_context_sources");
  const missing = validateRequiredFields(manifest, required);
  const invalid = validateFieldTypes(manifest, {
    session_id: "string",
    topology: "object",
    executive_office: "string_array",
    development_pods: "string_array",
    odin_mesh: "object",
    model_profile: "object",
    handoff_sources: "string_array",
    startup_objectives: "string_array"
  });
  const warnings: string[] = [];

  invalid.push(
    ...validateNonEmptyArrays(manifest, [
      "executive_office",
      "development_pods",
      "handoff_sources",
      "startup_objectives"
    ])
  );

  if (Array.isArray(manifest.executive_office)) {
    for (const [index, slot] of manifest.executive_office.entries()) {
      if (typeof slot !== "string" || !isVisibleRoleSlot(slot)) {
        invalid.push(`executive_office.${index}`);
      }
    }
  }

  if (Array.isArray(manifest.role_slots)) {
    for (const [index, slotValue] of manifest.role_slots.entries()) {
      const slot = asRecord(slotValue);
      const roleSlot = typeof slot.role_slot === "string" ? slot.role_slot : undefined;
      const governed = slot.governed !== false && (!roleSlot || isGovernedRole(roleSlot));
      const layoutLocator = asRecord(slot.layout_locator);
      for (const field of requiredRoleSlotFields) {
        if (slot[field] === undefined || slot[field] === null || (typeof slot[field] === "string" && slot[field].trim() === "")) {
          invalid.push(`role_slots.${index}.${field}`);
        }
      }
      if (!roleSlot || !isVisibleRoleSlot(roleSlot)) invalid.push(`role_slots.${index}.role_slot`);
      if (!stringFieldPresent(slot.harness)) invalid.push(`role_slots.${index}.harness`);
      if (!stringFieldPresent(slot.readiness_status) || !readinessStatuses.includes(String(slot.readiness_status))) {
        invalid.push(`role_slots.${index}.readiness_status`);
      }
      if (governed && Object.keys(layoutLocator).length === 0) {
        invalid.push(`role_slots.${index}.layout_locator`);
      }
      for (const field of layoutLocatorFields) {
        if (governed && !stringFieldPresent(layoutLocator[field])) {
          invalid.push(`role_slots.${index}.layout_locator.${field}`);
        }
      }
      const contextSource = typeof slot.scp_context_source === "string" ? slot.scp_context_source.trim() : "";
      const recognizedContextSource = scpContextSources.includes(contextSource);
      const hasContext =
        recognizedContextSource ||
        slot.scp_skill_available === true ||
        slot.full_protocol_text_injected === true ||
        slot.mcp_available === true;
      if (governed && !recognizedContextSource) {
        invalid.push(`role_slots.${index}.scp_context_source`);
      }
      if (governed && !hasContext) {
        warnings.push(`role_slots.${index} lacks SCP context source proof`);
      }
      if (typeof slot.mcp_version === "string" && isVersionBelow(slot.mcp_version, MINIMUM_COMPATIBLE_MCP_VERSION)) {
        invalid.push(`role_slots.${index}.mcp_version`);
        warnings.push(`role_slots.${index} MCP_VERSION_TOO_OLD: minimum compatible version is ${MINIMUM_COMPATIBLE_MCP_VERSION}`);
      }
      if (roleSlot && isOdinRole(roleSlot) && !slot.watches) {
        warnings.push(`role_slots.${index} ODIN slot should declare watcher assignments`);
      }
    }
  }

  return buildValidationResult(missing, invalid, warnings);
}

export function evaluateReadinessGate(input: ReadinessGateInput): Record<string, unknown> {
  const minimum = input.minimumMcpVersion ?? MINIMUM_COMPATIBLE_MCP_VERSION;
  const userProvisioningAnswer = input.userProvisioningAnswer ?? "unknown";
  const execPmAuthorized = input.execPmAuthorized === true;
  const cmuxAvailable = input.cmuxAvailable === true;
  const hasSlots = input.slots.length > 0;
  const rows: ReadinessMatrixRow[] = input.slots.map((slot) => {
    const harness = slot.harness ?? "unknown";
    const classifications: string[] = [];
    const notes: string[] = [];
    const sources = scpContextSources(slot);
    let status: ReadinessStatus = "PASS";

    if (!execPmAuthorized) classifications.push("EXEC_PM_AUTHORIZATION_REQUIRED");
    if (!cmuxAvailable) classifications.push("CMUX_UNAVAILABLE");
    const vacantSlot = slot.occupantState === "VACANT_ROLE_SLOT";
    if (vacantSlot) {
      classifications.push("VACANT_ROLE_SLOT");
      notes.push("Vacant role slot is provisioned without an occupant. It may launch as a surface placeholder; activation is allowed only when the slot is not marked required.");
      if (slot.required !== false) classifications.push("VACANT_SLOT_REQUIREMENT_UNVERIFIED");
    } else {
      if (slot.mcpAvailable === true && typeof slot.mcpVersion !== "string") classifications.push("MCP_VERSION_UNVERIFIED");
      if (slot.mcpAvailable === true && typeof slot.mcpVersion === "string" && isVersionBelow(slot.mcpVersion, minimum)) classifications.push("MCP_VERSION_TOO_OLD");
      if (slot.mcpAvailable === false) classifications.push("MCP_UNAVAILABLE");
      if (slot.scpSkillAvailable === false) classifications.push("SCP_SKILL_MISSING");
      if (sources.length === 0 && isGovernedRole(slot.roleSlot)) classifications.push("NON_GOVERNED_ONE_SHOT_ONLY");
      if (slot.firstRunPermissionStatus === "PROMPT_WAITING" || slot.firstRunPermissionStatus === "DENIED") classifications.push("BLOCKED_BY_PERMISSION");
      if (slot.authStatus === "AUTH_LOGIN_REQUIRED") classifications.push("BLOCKED_BY_LOGIN");
      if (slot.authStatus === "AUTH_MISSING") classifications.push("BLOCKED_BY_API_KEY");
      if (slot.authStatus === "AUTH_PROVIDER_BLOCKED") classifications.push("AUTH_PROVIDER_BLOCKED");
      if (slot.authStatus === "AUTH_UNKNOWN") classifications.push("BLOCKED_BY_AUTH");
      if (slot.modelStatus === "MODEL_STALLED") classifications.push("MODEL_STALLED");
      if (slot.modelStatus === "STREAMING_PROTOCOL_MISMATCH" || slot.modelStatus === "MODEL_REASONING_ONLY") classifications.push("STREAMING_PROTOCOL_MISMATCH");
      if (slot.modelStatus === "MODEL_UNREACHABLE") classifications.push("MODEL_UNREACHABLE");
      if (slot.roleCompatibility === "REFUSES_ROLE" || slot.roleCompatibility === "UNPROVEN") classifications.push("ROLE_COMPATIBILITY_FAILED");
      if (userProvisioningAnswer !== "yes" && ["AUTH_MISSING", "AUTH_UNKNOWN", undefined].includes(slot.authStatus)) classifications.push("USER_INPUT_REQUIRED");
      if (isOdinRole(slot.roleSlot) && slot.canHydrateDeferredMcpToolsAtBoot !== true && slot.fullProtocolTextInjected !== true && slot.scpSkillAvailable !== true) {
        classifications.push("UNSUITABLE_FOR_ODIN_ROLE");
      }
    }

    const uniqueClassifications = [...new Set(classifications)];
    const failureClassifications = uniqueClassifications.filter((item) => item !== "SCP_SKILL_MISSING" && item !== "NON_GOVERNED_ONE_SHOT_ONLY" && item !== "VACANT_ROLE_SLOT");
    const unwaivableLaunchBlockers = new Set([
      "MCP_VERSION_UNVERIFIED",
      "MCP_VERSION_TOO_OLD",
      "MCP_UNAVAILABLE",
      "BLOCKED_BY_PERMISSION",
      "MODEL_STALLED",
      "STREAMING_PROTOCOL_MISMATCH",
      "MODEL_UNREACHABLE",
      "ROLE_COMPATIBILITY_FAILED",
      "UNSUITABLE_FOR_ODIN_ROLE"
    ]);
    const hasUnwaivableLaunchBlocker = uniqueClassifications.some((item) => unwaivableLaunchBlockers.has(item));
    const approvedWaiver = execPmAuthorized && slot.waiver === "WAIVED_BY_EXEC_PM" && !hasUnwaivableLaunchBlocker;
    const approvedSubstitution =
      execPmAuthorized &&
      slot.waiver === "SUBSTITUTION_APPROVED_BY_EXEC_PM" &&
      typeof slot.fallbackHarness === "string" &&
      slot.fallbackHarness.trim().length > 0 &&
      failureClassifications.length === 0;
    if (uniqueClassifications.includes("NON_GOVERNED_ONE_SHOT_ONLY")) {
      status = status === "PASS" ? "NON_GOVERNED_ONE_SHOT_ONLY" : status;
      notes.push("Non-governed fallback constraints: one deterministic assignment, no ongoing authority, no management role, no cross-agent coordination, command/test/QA-style verification preferred, context cleared after response.");
    }
    if (failureClassifications.length > 0 && status === "PASS") status = "FAIL";
    if (approvedWaiver) status = "WAIVED_BY_EXEC_PM";
    if (approvedSubstitution) status = "SUBSTITUTION_APPROVED_BY_EXEC_PM";

    const occupantState = slot.occupantState ?? "";
    const vacantSlotExplicitlyOptional = vacantSlot && slot.required === false;
    const readyOccupant = ["BOOTSTRAPPED_IDLE", "ACTIVE_WATCH"].includes(occupantState) || vacantSlotExplicitlyOptional;
    const substitutionActivationReady = vacantSlotExplicitlyOptional;
    const launchAllowed = status === "PASS" || status === "WAIVED_BY_EXEC_PM" || status === "SUBSTITUTION_APPROVED_BY_EXEC_PM";
    const activationAllowed =
      status === "PASS"
        ? readyOccupant
        : status === "WAIVED_BY_EXEC_PM"
          ? readyOccupant && failureClassifications.length === 0
          : status === "SUBSTITUTION_APPROVED_BY_EXEC_PM"
            ? substitutionActivationReady
            : false;

    return {
      roleSlot: slot.roleSlot,
      harness,
      status,
      launchAllowed,
      activationAllowed,
      classifications: uniqueClassifications,
      safeOutcomes: status === "PASS" ? [] : defaultSafeOutcomes(),
      scpContextSources: sources,
      mcpVersion: slot.mcpVersion,
      deferredMcpHydration: slot.canHydrateDeferredMcpToolsAtBoot === true ? "AT_BOOT" : slot.canHydrateDeferredMcpToolsAfterSecondTurn === true ? "AFTER_SECOND_TURN" : "UNPROVEN",
      nativeSkillInvocation: slot.nativeSkillInvocation === true,
      notes
    };
  });

  const overallStatus = hasSlots && rows.every((row) => row.launchAllowed) && cmuxAvailable && execPmAuthorized ? "PASS" : "FAIL";
  const activationStatus = hasSlots && rows.every((row) => row.activationAllowed) && cmuxAvailable && execPmAuthorized ? "TEAM_ACTIVATION_ALLOWED" : "TEAM_ACTIVATION_BLOCKED";

  return {
    version: VERSION,
    minimumMcpVersion: minimum,
    phases: GOVERNED_LAUNCH_PHASES,
    overallStatus,
    activationStatus,
    execPmAuthorized,
    cmuxAvailable,
    userPrompt: "Are all intended harnesses provisioned with accounts, plans, API keys, or local inference credentials so they will not malfunction when spun up?",
    readinessMatrix: rows,
    zeroSecretOutput: true
  };
}

function manifestWatchTargets(role: string, manifest: Record<string, unknown> | undefined): string[] {
  const explicitSlots = Array.isArray(manifest?.role_slots)
    ? manifest.role_slots.flatMap((slotValue) => {
        const slot = asRecord(slotValue);
        const watches = Array.isArray(slot.watches) ? slot.watches : [];
        return typeof slot.role_slot === "string" && slot.role_slot === role
          ? watches.filter((item): item is string => typeof item === "string")
          : [];
      })
    : [];
  if (explicitSlots.length > 0) return explicitSlots;
  if (roleKind(role) === "EXEC_ODIN") {
    return ["A/EXEC-PM", "A/EXEC-ASST", "A/EXEC-RSCH", "A/EXEC-QA", "B/ODIN", "C/ODIN"];
  }
  const team = role.includes("/") ? role.split("/")[0] : "B";
  return [`${team}/TEAM-PM`, `${team}/DEV-1`, `${team}/QA-1`, `${team}/SHADOW-1`];
}

export function getActiveWatchPacket(input: ActiveWatchPacketInput): Record<string, unknown> {
  const pollIntervalSeconds = input.pollIntervalSeconds ?? 30;
  const targets = manifestWatchTargets(input.role, input.manifest);
  const odinRole = isOdinRole(input.role);
  const state = odinRole && input.parkedMode !== true ? "ACTIVE_WATCH" : input.parkedMode === true ? "PARKED_IDLE" : "WATCH_UNSUPPORTED";
  const promptText = odinRole
    ? [
        `You are ${input.role}. After a valid boot receipt, transition to ${state}.`,
        `Poll every ${pollIntervalSeconds} seconds unless explicitly released, parked, or handed off.`,
        `Watch targets from the team manifest: ${targets.join(", ") || "NONE"}.`,
        "Classify permission prompts immediately as BLOCKED_BY_PERMISSION.",
        "Classify auth/login/API-key screens as BLOCKED_BY_AUTH, BLOCKED_BY_LOGIN, or BLOCKED_BY_API_KEY.",
        "Classify local inference stalls separately: MODEL_STALLED or STREAMING_PROTOCOL_MISMATCH.",
        "WATCH_WARN after 5 minutes without meaningful visible progress; STALLED after 10 minutes without heartbeat/status unless a known long-running operation is declared.",
        "Allowed interventions: corrective prompts for scope drift, authority drift, secret mishandling, stopped polling, blocked panes, stale proof, missing receipts, and context exhaustion.",
        "Forbidden actions: implement product work, QA-accept work, route business priorities, or override EXEC PM launch/activation authority.",
        "ODIN is a meta-control peer layer: not DEV/QA, not equal to EXEC PM for launch authority, and not too subordinate to object to PM or agent drift.",
        "A turn ending without re-arming the watch loop, starting an approved monitor, or handing off to a named successor is a protocol violation.",
        input.planMode === true ? "Plan-mode/read-only carve-out: if persistent polling is unavailable, emit a named re-arm instruction and explicit next wake condition." : "Persistent watch is expected."
      ].join("\n")
    : "This role is not an ODIN role and has no ODIN active-watch authority.";

  return {
    role: input.role,
    state,
    pollIntervalSeconds,
    watchWarnSeconds: 300,
    stalledSeconds: 600,
    targets,
    terminalStates: ACTIVE_WATCH_TERMINAL_STATES,
    classifications: ["BLOCKED_BY_PERMISSION", "BLOCKED_BY_AUTH", "BLOCKED_BY_LOGIN", "BLOCKED_BY_API_KEY", "MODEL_STALLED", "STREAMING_PROTOCOL_MISMATCH"],
    mayIntervene: odinRole,
    mayImplement: false,
    mayQaAccept: false,
    authority: { mayImplement: false, mayQaAccept: false },
    promptText
  };
}

export function getHarnessProbeMatrix(input: HarnessProbeInput = {}): Record<string, unknown> {
  const knownHarnesses = ["Codex", "Claude Code", "Droid", "Goose", "Crush", "OpenHands", "KiloCode", "Pi", "Aider", "NanoCoder"];
  const intended = input.intendedHarnesses ?? knownHarnesses;
  const installed = new Set((input.installedHarnesses ?? []).map((value) => value.toLowerCase()));
  const observations = input.observations ?? [];
  const timeout = input.visibleOutputTimeoutSeconds ?? 60;
  const providerStatuses = Object.fromEntries(
    Object.entries(input.providerStatuses ?? {}).map(([name, present]) => [name, { present, value: present ? "present redacted" : "absent" }])
  );

  const rows = intended.map((harness) => {
    const observation = observations.find((item) => item.harness.toLowerCase() === harness.toLowerCase());
    const classifications = new Set<string>();
    if (!installed.has(harness.toLowerCase())) classifications.add("NOT_INSTALLED_OR_UNPROVEN");
    if (input.userProvisioningAnswer !== "yes") classifications.add("USER_INPUT_REQUIRED");
    for (const item of classifyProbeText(harness, observation?.text ?? "")) classifications.add(item);
    if (observation?.reasoningContentOnly === true && observation.visibleContent !== true) classifications.add("MODEL_REASONING_ONLY");
    if (observation?.httpReachable === false) classifications.add("MODEL_UNREACHABLE");
    if (observation?.modelLoaded === false) classifications.add("MODEL_UNREACHABLE");
    if ((observation?.elapsedSeconds ?? 0) > timeout && observation?.visibleContent !== true) classifications.add("MODEL_STALLED");
    if (harness.toLowerCase() === "goose" && observation?.reasoningContentOnly === true && observation.visibleContent !== true) classifications.add("STREAMING_PROTOCOL_MISMATCH");

    const modelStatus =
      classifications.has("STREAMING_PROTOCOL_MISMATCH") ? "STREAMING_PROTOCOL_MISMATCH" :
      classifications.has("MODEL_REASONING_ONLY") ? "MODEL_REASONING_ONLY" :
      classifications.has("MODEL_STALLED") ? "MODEL_STALLED" :
      classifications.has("MODEL_UNREACHABLE") ? "MODEL_UNREACHABLE" :
      observation?.visibleContent === true ? "MODEL_READY" : "MODEL_SLOW";

    return {
      harness,
      installed: installed.has(harness.toLowerCase()),
      classifications: [...classifications],
      modelStatus,
      visibleOutputTimeoutSeconds: timeout,
      canHydrateDeferredMcpToolsAtBoot: ["Codex", "Claude Code", "Droid"].includes(harness),
      canHydrateDeferredMcpToolsAfterSecondTurn: true,
      nativeSkillInvocation: ["Codex", "Claude Code"].includes(harness),
      sentinelCoordinationProtocolSkill: "install before governed launch when the harness supports native skills",
      safeNextActions: classifications.size === 0 ? [] : defaultSafeOutcomes(),
      sanitizedObservation: observation?.text ? redactSecretLikeText(observation.text) : undefined
    };
  });

  return {
    zeroSecretOutput: true,
    userPrompt: "Are all intended harnesses provisioned with accounts, plans, API keys, or local inference credentials so they will not malfunction when spun up?",
    secretProviderStatuses: providerStatuses,
    supportedProviders: ["Doppler", "1Password CLI (op)", "environment variable names", "direnv", "mise", "dotenv-style file presence", "GitHub auth", "local provider config files"],
    rows
  };
}

export function getCloseoutChecklist(
  mode: CloseoutMode,
  repository: ProtocolRepository = getDefaultRepository()
): unknown {
  const data = loadProtocolData(repository);
  const modes = requireRecord(data.closeout.modes, "closeout.modes");
  const checklist = modes[mode];
  if (!checklist) {
    throw new Error(`Unknown closeout mode: ${safeErrorText(mode)}`);
  }
  return checklist;
}

export function getRuntimeNotice(): RuntimeNotice {
  return {
    inferenceProvider: "none",
    hostedService: false,
    telemetry: "local_optional",
    networkCalls: "none_by_default_optional_on_submit",
    maintainerPaysForUserInference: false,
    userPaysForHarnessInference: true,
    externalOrchestrationBundled: false,
    telemetryAutomaticCollection: false,
    telemetrySubmissionRequiresEndpoint: true,
    telemetrySubmissionRequiresExplicitInvocation: true,
    notes: [
      "ODIN Sentinel is a local stdio MCP server.",
      "It serves protocol resources and validation tools; it does not proxy model calls.",
      "Session reports are compiled locally; there is no automatic telemetry collection.",
      "The submit_session_report tool may make a network call only after an endpoint is configured and the user explicitly invokes submission for that session.",
      "Model and harness profiles are capability preferences, not hosted inference.",
      "ODIN Sentinel is standalone and does not require any external orchestration repo."
    ]
  };
}

export function exportProtocolSnapshot(repository: ProtocolRepository = getDefaultRepository()): Record<string, string> {
  const data = loadProtocolData(repository);
  return {
    "ODIN-SNAPSHOT.md": [
      "# ODIN Sentinel Protocol Snapshot",
      "",
      `Version: ${VERSION}`,
      "",
      "Prefer the MCP server as the source of truth. This snapshot is a fallback export.",
      "",
      data.protocol
    ].join("\n"),
    "protocol/roles.yaml": YAML.stringify(data.roles),
    "protocol/topology.yaml": YAML.stringify(data.topology),
    "protocol/model-profiles.yaml": YAML.stringify(data.modelProfiles),
    "protocol/closeout.yaml": YAML.stringify(data.closeout),
    "protocol/delegation.yaml": YAML.stringify(data.delegation),
    "protocol/receipts/boot-receipt.yaml": YAML.stringify(data.bootReceipt),
    "protocol/receipts/team-manifest.yaml": YAML.stringify(data.teamManifest)
  };
}

export function createProtocolService(repository: ProtocolRepository = createFileProtocolRepository()) {
  return {
    protocolPath: (...segments: string[]) => repository.path(...segments),
    loadProtocolData: () => loadProtocolData(repository),
    getRoleProfile: (role: string) => getRoleProfile(role, repository),
    getStartupPacket: (input: StartupPacketInput = {}) => getStartupPacket(input, repository),
    getVersionMetadata,
    getBootReceiptSchema: () => getBootReceiptSchema(repository),
    getBootReceiptExamples,
    evaluateReadinessGate,
    getActiveWatchPacket,
    getHarnessProbeMatrix,
    getDelegationPacket,
    validateDelegationPacket: (packet: Record<string, unknown>) => validateDelegationPacket(packet, repository),
    validateBootReceipt: (receipt: Record<string, unknown>) => validateBootReceipt(receipt, repository),
    validateTeamManifest: (manifest: Record<string, unknown>) => validateTeamManifest(manifest, repository),
    getCloseoutChecklist: (mode: CloseoutMode) => getCloseoutChecklist(mode, repository),
    getRuntimeNotice,
    exportProtocolSnapshot: () => exportProtocolSnapshot(repository)
  };
}
