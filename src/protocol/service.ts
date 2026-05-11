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
  requireRecord,
  requireStringArray,
  type ValidationResult,
  validateFieldTypes,
  validateNonEmptyArrays,
  validateRequiredFields
} from "./validators.js";
import { VERSION } from "./version.js";

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
  role: string;
  pods: number;
  resourcesToRead: string[];
  requiredActions: string[];
  defaultTopology: unknown;
  modelProfile: unknown;
  bootReceiptRequiredFields: unknown;
  startupPrompt: string;
};

export type RuntimeNotice = {
  inferenceProvider: "none";
  hostedService: false;
  telemetry: false;
  networkCalls: false;
  maintainerPaysForUserInference: false;
  userPaysForHarnessInference: true;
  externalOrchestrationBundled: false;
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

  return {
    version: VERSION,
    role,
    pods,
    resourcesToRead,
    requiredActions,
    defaultTopology: data.topology.default_topology,
    modelProfile: roleModelProfile,
    bootReceiptRequiredFields: data.bootReceipt.required_fields,
    startupPrompt: [
      "Use ODIN Sentinel coordination.",
      "",
      `You are ${role}.`,
      "Load startup requirements from the odin-sentinel MCP resources and tools. Do not assume external local extensions exist.",
      input.repoPath ? `Repository: ${input.repoPath}` : "Repository: discover from current working directory.",
      `Bootstrap executive office plus ${pods} development pod${pods === 1 ? "" : "s"} unless handoff or user instruction overrides this.`,
      input.userInstruction ? `User instruction: ${input.userInstruction}` : "Ask for objectives if no handoff supplies them."
    ].join("\n")
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

  return buildValidationResult(missing, invalid, warnings);
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
    telemetry: false,
    networkCalls: false,
    maintainerPaysForUserInference: false,
    userPaysForHarnessInference: true,
    externalOrchestrationBundled: false,
    notes: [
      "ODIN Sentinel is a local stdio MCP server.",
      "It serves protocol resources and validation tools; it does not proxy model calls.",
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
    getDelegationPacket,
    validateDelegationPacket: (packet: Record<string, unknown>) => validateDelegationPacket(packet, repository),
    validateBootReceipt: (receipt: Record<string, unknown>) => validateBootReceipt(receipt, repository),
    validateTeamManifest: (manifest: Record<string, unknown>) => validateTeamManifest(manifest, repository),
    getCloseoutChecklist: (mode: CloseoutMode) => getCloseoutChecklist(mode, repository),
    getRuntimeNotice,
    exportProtocolSnapshot: () => exportProtocolSnapshot(repository)
  };
}
