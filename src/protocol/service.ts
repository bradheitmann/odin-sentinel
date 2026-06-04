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
  activationGates: Record<string, unknown>;
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
  governedContextProof?: unknown;
  hooksAvailable?: boolean;
  deliveryState?: string;
  livenessState?: string;
  permissionBlocked?: boolean;
  idleStalled?: boolean;
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
  governedReadiness: GovernedReadinessState;
  governedReadinessNextAction: string;
  governedActivationBlocked: boolean;
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
    mcpManagementAvailable?: boolean;
    mcpConfigured?: boolean;
    scpSkillInstalled?: boolean;
    fullProtocolTextInjected?: boolean;
    authStatus?: "AUTH_READY" | "AUTH_PRESENT_UNVERIFIED" | "AUTH_MISSING" | "AUTH_PROVIDER_BLOCKED" | "AUTH_LOGIN_REQUIRED" | "AUTH_UNKNOWN";
    autoLevel?: "none" | "low" | "medium" | "high";
    taskAutonomy?: "read_only" | "mission" | "high_autonomy";
    requestedRole?: string;
    governedContextProof?: unknown;
    hooksAvailable?: boolean;
    deliveryState?: string;
    livenessState?: string;
    permissionBlocked?: boolean;
    idleStalled?: boolean;
  }>;
  visibleOutputTimeoutSeconds?: number;
};

export type OnboardingSetupMode = "guided" | "assisted";

export type OnboardingPlanInput = {
  intendedHarnesses?: string[];
  installedHarnesses?: string[];
  userProvisioningAnswer?: "yes" | "no" | "unknown";
  observations?: HarnessProbeInput["observations"];
  computerUseAvailable?: boolean;
  preferredSetupMode?: OnboardingSetupMode | "assisted_computer_use" | "unset";
  ledgerPath?: string;
  platform?: "macos" | "linux" | "windows" | "unknown";
};

// --- Fail-closed governed readiness ---------------------------------------------------------
// Presence is not authority. MCP being configured, or an SCP skill existing on disk, never
// makes a harness GOVERNED_READY by itself. Governed authority requires a verified control
// layer PLUS proven protocol uptake (a stable source marker actually observed) at an assurance
// level adequate for the requested role. Missing/insufficient proof fails closed.

export type GovernedReadinessState = "GOVERNED_READY" | "FIXABLE_BLOCKED" | "NON_GOVERNED_ONE_SHOT_ONLY" | "UNSUPPORTED";
export type HarnessCategory = "native_skill" | "static_control_file" | "mcp_only" | "unsupported";
export type AssuranceLevel = "native_skill" | "static_control_file" | "mcp_bootstrap" | "none";

export const GOVERNED_CONTEXT_PROOF_SCHEMA = "odin.governed_context_proof.v1";
const GOVERNED_CONTEXT_SOURCE_TYPES = ["native_skill", "static_control_file", "mcp_bootstrap"] as const;

// User-clear four-state model surfaced by every governed-readiness surface (probe, gate, onboarding).
const GOVERNED_READINESS_MODEL = {
  states: {
    GOVERNED_READY: "Verified control layer + proven protocol uptake at adequate assurance + required hooks/validators + no unwaivable blocker.",
    FIXABLE_BLOCKED: "Supported harness missing skill/static/MCP control proof, uptake receipt, hook, auth, or liveness — fixable, not yet governed.",
    NON_GOVERNED_ONE_SHOT_ONLY: "Bounded non-authoritative use only: no PM/ODIN/QA acceptance, closure, or team coordination.",
    UNSUPPORTED: "Harness cannot enforce SCP governed context and must not hold a governed role."
  },
  rule: "MCP configured alone, or a skill file on disk alone, never yields GOVERNED_READY. PM/ODIN roles require the highest assurance the harness supports.",
  verifier: "scripts/protocol/verify-governed-context.mjs"
} as const;

// Harness category registry: how each harness can carry an enforced SCP control layer. Unknown
// harnesses default to mcp_only (still fail-closed: no proof ⇒ not governed-ready).
const HARNESS_CATEGORY_REGISTRY: Record<string, HarnessCategory> = {
  codex: "native_skill",
  "claude code": "native_skill",
  droid: "mcp_only",
  goose: "mcp_only",
  openhands: "mcp_only",
  kilocode: "mcp_only",
  cursor: "static_control_file",
  zed: "static_control_file",
  aider: "static_control_file",
  crush: "static_control_file",
  pi: "unsupported",
  nanocoder: "unsupported"
};

export function harnessCategory(harness: string): HarnessCategory {
  return HARNESS_CATEGORY_REGISTRY[harness.trim().toLowerCase()] ?? "mcp_only";
}

const ASSURANCE_RANK: Record<AssuranceLevel, number> = { none: 0, mcp_bootstrap: 1, static_control_file: 2, native_skill: 3 };

function maxAssuranceForCategory(category: HarnessCategory): AssuranceLevel {
  if (category === "native_skill") return "native_skill";
  if (category === "static_control_file") return "static_control_file";
  if (category === "mcp_only") return "mcp_bootstrap";
  return "none";
}

function sourceTypeToAssurance(sourceType: unknown): AssuranceLevel {
  if (sourceType === "native_skill") return "native_skill";
  if (sourceType === "static_control_file") return "static_control_file";
  if (sourceType === "mcp_bootstrap") return "mcp_bootstrap";
  return "none";
}

function isHighAuthorityRole(role: string | undefined): boolean {
  if (!role) return false;
  const n = normalizeRoleName(role);
  return n === "EXEC_PM" || n === "TEAM_PM" || n === "EXEC_ODIN" || n === "TEAM_ODIN";
}

/**
 * Pure shape validation of a governed-context proof (no disk access). The authoritative on-disk
 * checksum gate is scripts/protocol/verify-governed-context.mjs; this validates the structure,
 * the stable source marker, the uptake-receipt marker linkage, and zero-secret content so the
 * MCP-visible readiness surfaces can require proof. A self-reported boolean with no stable
 * source marker can never validate here (slice MUST NOT).
 */
export function validateGovernedContextProof(proof: unknown): { valid: boolean; proofAssurance: AssuranceLevel | null; reasons: string[] } {
  const reasons: string[] = [];
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    return { valid: false, proofAssurance: null, reasons: ["governed-context proof is not an object"] };
  }
  const record = asRecord(proof);
  const serialized = JSON.stringify(record);
  if (redactSecretLikeText(serialized) !== serialized) reasons.push("governed-context proof contains a secret-looking value");
  if (record.schema !== GOVERNED_CONTEXT_PROOF_SCHEMA) reasons.push(`schema must be ${GOVERNED_CONTEXT_PROOF_SCHEMA}`);
  for (const field of ["role", "harness", "source_type", "generated_at"]) {
    if (typeof record[field] !== "string" || (record[field] as string).trim() === "") reasons.push(`missing ${field}`);
  }
  const sourceType = record.source_type;
  if (typeof sourceType === "string" && !GOVERNED_CONTEXT_SOURCE_TYPES.includes(sourceType as (typeof GOVERNED_CONTEXT_SOURCE_TYPES)[number])) {
    reasons.push("invalid source_type");
  }
  const controlSource = asRecord(record.control_source);
  const marker = typeof controlSource.marker === "string" ? controlSource.marker.trim() : "";
  if (marker === "") reasons.push("control_source.marker is required (a stable source marker, not a bare boolean)");
  if (typeof controlSource.path === "string" && controlSource.path.trim() !== "" && (typeof controlSource.sha256 !== "string" || (controlSource.sha256 as string).trim() === "")) {
    reasons.push("control_source.sha256 is required when control_source.path is present");
  }
  if (!record.uptake_receipt || typeof record.uptake_receipt !== "object" || Array.isArray(record.uptake_receipt)) {
    reasons.push("missing uptake_receipt");
  } else {
    const uptake = asRecord(record.uptake_receipt);
    if (uptake.observed !== true) reasons.push("uptake_receipt.observed must be true");
    const evidence = typeof uptake.evidence_marker === "string" ? uptake.evidence_marker.trim() : "";
    if (evidence === "") reasons.push("uptake_receipt.evidence_marker is required (self-asserted uptake without a stable marker is rejected)");
    else if (marker !== "" && evidence !== marker) reasons.push("uptake_receipt.evidence_marker does not match control_source.marker");
    if (typeof uptake.method !== "string" || (uptake.method as string).trim() === "") reasons.push("uptake_receipt.method is required");
  }
  return { valid: reasons.length === 0, proofAssurance: reasons.length === 0 ? sourceTypeToAssurance(sourceType) : null, reasons };
}

export type GovernedReadinessInput = {
  harness: string;
  installed?: boolean;
  authenticated?: boolean | "unknown";
  requestedRole?: string;
  governedContextProof?: unknown;
  hooksAvailable?: boolean;
  deliveryState?: string;
  livenessState?: string;
  permissionBlocked?: boolean;
  idleStalled?: boolean;
  authBlockers?: string[];
  otherBlockers?: string[];
};

export type GovernedReadinessResult = {
  state: GovernedReadinessState;
  category: HarnessCategory;
  requiredAssurance: AssuranceLevel;
  proofAssurance: AssuranceLevel | null;
  uptakeVerified: boolean;
  blockers: string[];
  nextSafeAction: string;
};

const UNSAFE_DELIVERY_STATES = new Set(["INPUT_BAR_ONLY", "PANE_BLOCKED_ON_PERMISSION"]);
const UNSAFE_LIVENESS_STATES = new Set(["NO_VISIBLE_PROCESSING", "IDLE_STALLED", "NO_ACK", "STALE_IDLE"]);

function governedReadinessNextAction(
  state: GovernedReadinessState,
  requiredAssurance: AssuranceLevel,
  blockers: string[]
): string {
  if (state === "NON_GOVERNED_ONE_SHOT_ONLY") {
    return "This harness cannot reach the assurance this role requires; use it only for bounded one-shot work, or assign the role to a higher-assurance harness.";
  }
  const top = blockers[0] ?? "no verified governed-context uptake proof";
  if (top.startsWith("no verified governed-context")) {
    if (requiredAssurance === "native_skill") return "Install the native sentinel-coordination-protocol skill, load it, then capture a governed-context uptake proof (verify with scripts/protocol/verify-governed-context.mjs).";
    if (requiredAssurance === "static_control_file") return "Install/validate the static control file, load it, then capture a governed-context uptake proof (verify with scripts/protocol/verify-governed-context.mjs).";
    return "Load the MCP bootstrap resource, then capture a governed-context uptake proof (verify with scripts/protocol/verify-governed-context.mjs).";
  }
  if (top.startsWith("assurance ")) return "Provide a higher-assurance governed-context proof; a lower-assurance path does not qualify for this harness/role (PM and ODIN need the highest available).";
  if (top.startsWith("authentication") || top.startsWith("auth blocked")) return "Sign in or provision the harness outside chat (never paste secrets), then re-probe.";
  if (top.startsWith("delivery") || top.startsWith("liveness") || top.startsWith("blocked on a permission") || top.startsWith("stale idle")) return "Resolve the live blocker: submit with Enter and confirm processing, approve the permission prompt, or restart the stalled occupant; then re-probe.";
  if (top.startsWith("required hooks/validators")) return "Deploy and confirm the activation hook + governed-context verifier (scripts/protocol/install-activation-hooks.mjs, scripts/protocol/verify-governed-context.mjs), then re-probe.";
  return "Resolve the listed blocker, then re-run the governed-readiness probe.";
}

/**
 * Single source of truth for the four-state governed-readiness taxonomy, reused by the harness
 * probe matrix, the readiness gate, and onboarding so they never emit conflicting statuses.
 */
export function classifyGovernedReadiness(input: GovernedReadinessInput): GovernedReadinessResult {
  const category = harnessCategory(input.harness);
  const highAuthority = isHighAuthorityRole(input.requestedRole);
  const proofCheck = validateGovernedContextProof(input.governedContextProof);
  const uptakeVerified = proofCheck.valid;
  const proofAssurance = proofCheck.proofAssurance;

  const baseRequired = maxAssuranceForCategory(category);
  // PM/ODIN must clear at least static_control_file assurance; MCP-only never silently qualifies.
  const requiredAssurance: AssuranceLevel = highAuthority
    ? (ASSURANCE_RANK[baseRequired] >= ASSURANCE_RANK.static_control_file ? baseRequired : "static_control_file")
    : baseRequired;

  if (category === "unsupported") {
    return {
      state: "UNSUPPORTED",
      category,
      requiredAssurance,
      proofAssurance,
      uptakeVerified: false,
      blockers: ["harness cannot enforce an SCP governed-context control layer"],
      nextSafeAction: "Use this harness only for bounded, non-governed one-shot help; do not assign it a governed role."
    };
  }

  const blockers: string[] = [];
  if (input.installed === false) blockers.push("not installed or not provisioned");
  if (input.authenticated === false) blockers.push("authentication blocker (sign in or provision outside chat)");
  if (Array.isArray(input.authBlockers) && input.authBlockers.length > 0) blockers.push(`auth blocked: ${input.authBlockers.join(", ")}`);
  // Affirmative requirement: hooks/validators must be confirmed available. Unknown or omitted
  // hook availability foreclosed an optional-failure path, so it blocks governed readiness.
  if (input.hooksAvailable !== true) blockers.push("required hooks/validators not confirmed available (the governed-context verifier and activation hook must be affirmatively present)");
  if (input.permissionBlocked === true) blockers.push("blocked on a permission prompt");
  if (input.idleStalled === true) blockers.push("stale idle: no visible progress");
  if (typeof input.deliveryState === "string" && UNSAFE_DELIVERY_STATES.has(input.deliveryState)) blockers.push("delivery not confirmed (input-bar-only or permission-blocked is not delivery)");
  if (typeof input.livenessState === "string" && UNSAFE_LIVENESS_STATES.has(input.livenessState)) blockers.push("liveness not confirmed (no visible processing, missing ack, or stale idle)");
  if (Array.isArray(input.otherBlockers)) for (const b of input.otherBlockers) blockers.push(b);

  if (!uptakeVerified) {
    blockers.push("no verified governed-context uptake proof (MCP config or a skill file on disk is not uptake)");
  } else if (proofAssurance && ASSURANCE_RANK[proofAssurance] < ASSURANCE_RANK[requiredAssurance]) {
    blockers.push(`assurance ${proofAssurance} is below the ${requiredAssurance} required for this harness/role`);
  }

  if (blockers.length === 0 && uptakeVerified) {
    return {
      state: "GOVERNED_READY",
      category,
      requiredAssurance,
      proofAssurance,
      uptakeVerified,
      blockers: [],
      nextSafeAction: "Governed authority verified. Launch the role; keep the governed-context proof fresh and re-verify on resume."
    };
  }

  // Supported but blocked. If the harness can never reach the required assurance for this role,
  // it is one-shot only for that role; otherwise the blockers are fixable.
  const reachable = ASSURANCE_RANK[maxAssuranceForCategory(category)] >= ASSURANCE_RANK[requiredAssurance];
  const state: GovernedReadinessState = reachable ? "FIXABLE_BLOCKED" : "NON_GOVERNED_ONE_SHOT_ONLY";
  return {
    state,
    category,
    requiredAssurance,
    proofAssurance,
    uptakeVerified,
    blockers,
    nextSafeAction: governedReadinessNextAction(state, requiredAssurance, blockers)
  };
}

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

// Map a VERIFIED governed-context proof's assurance to the equivalent legacy SCP context-source
// label. Returns null when the proof does not validate (fail-closed: no valid proof, no source).
function proofDerivedContextSource(proof: unknown): string | null {
  const check = validateGovernedContextProof(proof);
  if (!check.valid) return null;
  if (check.proofAssurance === "native_skill") return "native sentinel-coordination-protocol skill";
  if (check.proofAssurance === "static_control_file") return "full injected SCP protocol text";
  if (check.proofAssurance === "mcp_bootstrap") return "odin-sentinel MCP bootstrap resource";
  return null;
}

// Reconcile legacy context-source fields with a governed-context proof. A valid proof SUPPLIES the
// context source when legacy fields are absent (so a proof-only governed slot is not downgraded
// merely for missing stale fields), but it can never override a contradictory legacy declaration:
// incongruent legacy/proof sources fail closed as a conflict — never the more permissive source.
function resolveContextSources(slot: ReadinessSlotInput): { sources: string[]; conflict: boolean } {
  const legacy = scpContextSources(slot);
  const proofSource = proofDerivedContextSource(slot.governedContextProof);
  if (proofSource === null) return { sources: legacy, conflict: false };
  if (legacy.length === 0) return { sources: [proofSource], conflict: false };
  if (legacy.includes(proofSource)) return { sources: legacy, conflict: false };
  return { sources: legacy, conflict: true };
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
  if (/login|\bsign[\s-]?in\b|\bnot signed[\s-]?in\b|authenticate|kilo auth login|\/connect/.test(safeText)) classes.push("BLOCKED_BY_LOGIN");
  if (/api key|apikey|credential|inference credential|provider config|openhands/.test(safeText)) classes.push("BLOCKED_BY_API_KEY");
  if (/permission denied|eacces|operation not permitted/.test(safeText)) classes.push("BLOCKED_BY_PERMISSION");
  if (/roleplay|fiction|cannot accept role|not a real protocol/.test(safeText)) classes.push("ROLE_COMPATIBILITY_FAILED");
  if (harness.toLowerCase() === "kilocode" && /auth login|\/connect|login/.test(safeText)) classes.push("BLOCKED_BY_LOGIN");
  if (harness.toLowerCase() === "openhands" && /api|credential|provider/.test(safeText)) classes.push("AUTH_PROVIDER_BLOCKED");
  if (harness.toLowerCase() === "crush" && /permission|denied|approve/.test(safeText)) classes.push("BLOCKED_BY_PERMISSION");
  if (harness.toLowerCase() === "pi" && /role|mcp|skill|runtime proof|fiction/.test(safeText)) classes.push("ROLE_COMPATIBILITY_FAILED");
  if (/unauthorized|authentication parameter not received in header|missing auth header|auth header not/.test(safeText)) classes.push("BLOCKED_BY_AUTH");
  if (harness.toLowerCase() === "crush" && /unauthorized|authentication parameter|auth header/.test(safeText)) classes.push("AUTH_PROVIDER_BLOCKED");
  if (harness.toLowerCase() === "droid" && /insufficient permission to proceed|re-run with --auto|--auto high/.test(safeText)) classes.push("AUTO_HIGH_REQUIRED");
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
    "refresh repo status, upstream parity, worktrees, stashes, and topology before lifecycle claims",
    "before implementation, QA acceptance, or ACTIVE_WATCH: produce full-instruction-read proof (path, byte or line count, and sha256 per file) and verify it with scripts/protocol/verify-instruction-read.mjs",
    "for CMUX dispatch: send text, submit Enter, read the target surface, and confirm processing before treating the message as delivered (input-bar text is not delivery)"
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
    activationGates: getActivationGates(),
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
      "Activation gates: before implementation, QA acceptance, or ACTIVE_WATCH, emit a full-instruction-read proof (path, byte/line count, and sha256 per file) and verify it with scripts/protocol/verify-instruction-read.mjs.",
      "CMUX dispatch is not delivered until you submit with Enter and confirm processing on the target surface; input-bar text is not delivery.",
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

export const CMUX_DELIVERY_STATES = [
  "DELIVERED_ACKED",
  "DELIVERED_NO_ACK",
  "INPUT_BAR_ONLY",
  "PANE_BLOCKED_ON_PERMISSION",
  "PANE_STILL_THINKING"
] as const;

const CMUX_DELIVERY_PROOF_FIELDS = [
  "target_surface_locator",
  "submitted",
  "verification_method",
  "observed_processing_state",
  "timestamp",
  "sender_role"
];

const INSTRUCTION_READ_PROOF_REQUIRED_FIELDS = ["role", "generated_at", "files"];

const ACTIVATION_GATE_ROLE_WORK = ["implementation", "QA acceptance", "ACTIVE_WATCH"];

/**
 * Validate a CMUX delivery proof. CMUX dispatch is not delivered until the sender submits
 * with Enter and verifies processing on the target surface; text left in an input bar is
 * INPUT_BAR_ONLY, not delivery. A submitted=false proof or an INPUT_BAR_ONLY state fails.
 */
export function validateCmuxDeliveryProof(proof: Record<string, unknown>): ValidationResult {
  const missing = validateRequiredFields(proof, CMUX_DELIVERY_PROOF_FIELDS);
  const invalid = validateFieldTypes(proof, {
    target_surface_locator: "string",
    submitted: "boolean",
    verification_method: "string",
    observed_processing_state: "string",
    timestamp: "string",
    sender_role: "string"
  });
  const warnings: string[] = [];

  const state = typeof proof.observed_processing_state === "string" ? proof.observed_processing_state : undefined;
  if (state !== undefined && !CMUX_DELIVERY_STATES.includes(state as (typeof CMUX_DELIVERY_STATES)[number])) {
    if (!invalid.includes("observed_processing_state")) invalid.push("observed_processing_state");
    warnings.push(`observed_processing_state must be one of: ${CMUX_DELIVERY_STATES.join(", ")}`);
  }

  if (proof.submitted === false) {
    invalid.push("submitted");
    warnings.push("CMUX text was not submitted with Enter; this is INPUT_BAR_ONLY, not delivery. Send Enter and re-read the target surface.");
  }

  if (state === "INPUT_BAR_ONLY") {
    if (!invalid.includes("observed_processing_state")) invalid.push("observed_processing_state");
    warnings.push("INPUT_BAR_ONLY: text is visible in the target input bar but not processed; not a valid delivery until submitted and confirmed.");
  } else if (state === "PANE_BLOCKED_ON_PERMISSION") {
    warnings.push("Target pane received the message but is blocked on a permission/approval prompt; classify and resolve before treating it as actioned.");
  } else if (state === "DELIVERED_NO_ACK") {
    warnings.push("Delivered, but no acknowledgement observed yet; revisit on the next poll.");
  } else if (state === "PANE_STILL_THINKING") {
    warnings.push("Delivered; target is still processing. Revisit to confirm completion.");
  }

  return buildValidationResult(missing, invalid, warnings);
}

/**
 * Validate the shape of a full-instruction-read proof: a role, a generation timestamp, and
 * a non-empty files[] list where each entry carries a path, a byte or line count, and a
 * sha256 digest. Disk verification (does the digest still match the file?) is performed by
 * scripts/protocol/verify-instruction-read.mjs.
 */
export function validateInstructionReadProof(proof: Record<string, unknown>): ValidationResult {
  const missing = validateRequiredFields(proof, INSTRUCTION_READ_PROOF_REQUIRED_FIELDS);
  const invalid = validateFieldTypes(proof, { role: "string", generated_at: "string" });
  const warnings: string[] = [];

  const files = Array.isArray(proof.files) ? proof.files : undefined;
  if (files === undefined) {
    if (!missing.includes("files") && !invalid.includes("files")) invalid.push("files");
  } else if (files.length === 0) {
    invalid.push("files");
    warnings.push("instruction-read proof must list at least one file");
  } else {
    files.forEach((entry, index) => {
      const file = asRecord(entry);
      if (!stringFieldPresent(file.path)) invalid.push(`files.${index}.path`);
      if (!stringFieldPresent(file.sha256)) {
        invalid.push(`files.${index}.sha256`);
        warnings.push(`files.${index} must include a sha256 digest proving full-content coverage`);
      }
      const hasBytes = typeof file.bytes === "number" && Number.isFinite(file.bytes);
      const hasLines = typeof file.lines === "number" && Number.isFinite(file.lines);
      if (!hasBytes && !hasLines) {
        invalid.push(`files.${index}.bytes`);
        warnings.push(`files.${index} must include a byte count or line count`);
      }
    });
  }

  return buildValidationResult(missing, invalid, warnings);
}

/**
 * Activation-gate guidance for agents using only ODIN MCP resources: how to satisfy CMUX
 * delivery proof and full-instruction-read proof before acting under SCP.
 */
export function getActivationGates(): Record<string, unknown> {
  return {
    version: VERSION,
    summary: "Before acting under SCP, prove delivery and prove full instruction reads.",
    addressesObservedFailStates: [
      "CMUX standby text left unsubmitted in an input bar (INPUT_BAR_ONLY) mistaken for delivery",
      "agents reading only the first 50-100 lines of instructions instead of the full sources"
    ],
    cmuxDeliveryProof: {
      requirement:
        "CMUX dispatch is not delivered until the sender submits with Enter and verifies processing on the target surface. Text visible in an input bar is not delivery.",
      requiredFields: CMUX_DELIVERY_PROOF_FIELDS,
      allowedProcessingStates: CMUX_DELIVERY_STATES,
      confirmedDeliveryStates: ["DELIVERED_ACKED", "DELIVERED_NO_ACK"],
      senderSteps: [
        "send the text to the target surface",
        "submit with Enter (send-key enter)",
        "read the target surface",
        "confirm the agent processed or acknowledged the message"
      ],
      validateWith: "odin.validate_cmux_delivery_proof",
      example: {
        target_surface_locator: "workspace:1 pane:b surface:qa-1",
        submitted: true,
        verification_method: "cmux read-screen",
        observed_processing_state: "DELIVERED_ACKED",
        timestamp: "2026-01-01T00:00:00Z",
        sender_role: "A/EXEC-PM"
      }
    },
    instructionReadProof: {
      requirement: `Activated roles must produce full-instruction-read proof before ${ACTIVATION_GATE_ROLE_WORK.join(", ")} work. First-screen, head, or partial reads are insufficient.`,
      requiredFields: INSTRUCTION_READ_PROOF_REQUIRED_FIELDS,
      perFileFields: ["path", "bytes or lines", "sha256"],
      verifierScript: "scripts/protocol/verify-instruction-read.mjs",
      installerScript: "scripts/protocol/install-activation-hooks.mjs",
      verifyCommand: "node scripts/protocol/verify-instruction-read.mjs <proof.json>",
      recordCommand: "node scripts/protocol/verify-instruction-read.mjs --record <file...> > proof.json",
      validateWith: "odin.validate_instruction_read_proof",
      example: {
        schema: "odin.instruction_read_proof.v1",
        role: "B/DEV-1",
        generated_at: "2026-01-01T00:00:00Z",
        files: [{ path: "protocol/SCP.md", bytes: 4175, lines: 87, sha256: "<sha256-digest>" }]
      }
    },
    governedContextProof: {
      requirement:
        "Governed authority is fail-closed: MCP being configured or an SCP skill existing on disk is NOT enough. Before a persistent governed role acts, prove the control layer was loaded and taken up — a stable source marker actually observed — at an assurance level adequate for the role.",
      fourStateModel: GOVERNED_READINESS_MODEL,
      requiredFields: ["schema", "role", "harness", "source_type", "control_source.marker", "uptake_receipt", "generated_at"],
      sourceTypes: GOVERNED_CONTEXT_SOURCE_TYPES,
      rejects: [
        "self-reported boolean with no stable source marker",
        "MCP configured alone / skill file on disk alone",
        "checksum mismatch when control_source.path is present",
        "missing or stale uptake receipt",
        "secret-looking values"
      ],
      verifierScript: "scripts/protocol/verify-governed-context.mjs",
      installerScript: "scripts/protocol/install-activation-hooks.mjs",
      verifyCommand: "node scripts/protocol/verify-governed-context.mjs <proof.json>",
      recordCommand: "node scripts/protocol/verify-governed-context.mjs --record --source <control-file> --marker <stable-marker> > proof.json",
      surfacedBy: ["odin.get_harness_probe_matrix", "odin.evaluate_readiness_gate", "odin.get_onboarding_plan"],
      example: {
        schema: GOVERNED_CONTEXT_PROOF_SCHEMA,
        role: "B/DEV-1",
        harness: "Claude Code",
        source_type: "native_skill",
        control_source: { path: "~/.claude/skills/sentinel-coordination-protocol/SKILL.md", marker: "SCP_PUBLIC_VERSION: 0.4.x", sha256: "<sha256-digest>" },
        uptake_receipt: { method: "quoted_marker", evidence_marker: "SCP_PUBLIC_VERSION: 0.4.x", observed: true, observed_at: "2026-01-01T00:00:00Z" },
        generated_at: "2026-01-01T00:00:00Z"
      }
    }
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
    required_delivery_states: [...CMUX_DELIVERY_STATES],
    delivery_proof_contract: {
      required: true,
      reason: "CMUX dispatch is not delivered until submitted with Enter and confirmed on the target surface; input-bar text is not delivery.",
      required_fields: CMUX_DELIVERY_PROOF_FIELDS,
      confirmed_states: ["DELIVERED_ACKED", "DELIVERED_NO_ACK"],
      sender_steps: ["send text", "submit Enter", "read target surface", "confirm processed or acknowledged"],
      validate_with: "odin.validate_cmux_delivery_proof",
      note: "Attach the resulting proof as delivery_proof on the dispatch record after sending."
    }
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

  const deliveryProof = packet.delivery_proof;
  if (deliveryProof !== undefined && deliveryProof !== null) {
    const deliveryResult = validateCmuxDeliveryProof(asRecord(deliveryProof));
    for (const field of deliveryResult.missing) missing.push(`delivery_proof.${field}`);
    for (const field of deliveryResult.invalid) invalid.push(`delivery_proof.${field}`);
    warnings.push(...deliveryResult.warnings);
  } else if (packet.cmux_dispatch === true && visibility?.delivery_proof_required !== false) {
    warnings.push(
      "governed-team CMUX dispatch requires delivery proof, but the packet omits delivery_proof; after sending, record target_surface_locator, submitted=true, verification_method, observed_processing_state, timestamp, and sender_role"
    );
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

export function getRoleCompatibilitySmokeTest(): Record<string, unknown> {
  return {
    purpose: "Confirm a candidate occupant can hold a governed role before assignment.",
    runBeforeAssignment: true,
    questions: [
      "Do you accept the assigned role contract, its authority limits, and reports-to chain?",
      "Can you emit a valid SCP boot receipt with the required fields?",
      "Can you remain in the assigned lifecycle state (e.g., BOOTSTRAPPED_IDLE or ACTIVE_WATCH) until directed?",
      "Will you treat this protocol as a real governance contract and not reframe it as fictional roleplay?"
    ],
    passRequires: "An affirmative, in-character answer to all four questions plus a valid receipt.",
    mapToInput: "Record the verdict as roleCompatibility: ACCEPTS_ROLE | REFUSES_ROLE | UNPROVEN.",
    failClassification: "ROLE_COMPATIBILITY_FAILED",
    zeroSecretOutput: true
  };
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
    // A valid governed-context proof can supply the legacy context-source when legacy fields are
    // absent; a legacy/proof contradiction fails closed (CONTEXT_SOURCE_CONFLICT), never permissive.
    const { sources, conflict: contextSourceConflict } = resolveContextSources(slot);
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
      if (contextSourceConflict) {
        classifications.push("CONTEXT_SOURCE_CONFLICT");
        notes.push("Legacy SCP context-source field contradicts the governed-context proof source; failing closed. Remove the stale legacy field or supply a congruent proof — do not rely on the more permissive source.");
      }
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
      "UNSUITABLE_FOR_ODIN_ROLE",
      "CONTEXT_SOURCE_CONFLICT"
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
    const activationAllowedBase =
      status === "PASS"
        ? readyOccupant
        : status === "WAIVED_BY_EXEC_PM"
          ? readyOccupant && failureClassifications.length === 0
          : status === "SUBSTITUTION_APPROVED_BY_EXEC_PM"
            ? substitutionActivationReady
            : false;

    // Fail-closed governed readiness for this slot, using the shared four-state taxonomy.
    const slotAuthenticated: boolean | "unknown" =
      slot.authStatus === "AUTH_READY"
        ? true
        : ["BLOCKED_BY_API_KEY", "AUTH_PROVIDER_BLOCKED", "BLOCKED_BY_LOGIN", "BLOCKED_BY_AUTH"].some((item) => uniqueClassifications.includes(item))
          ? false
          : "unknown";
    const governed = classifyGovernedReadiness({
      harness,
      authenticated: slotAuthenticated,
      requestedRole: slot.role ?? slot.roleSlot,
      governedContextProof: slot.governedContextProof,
      hooksAvailable: slot.hooksAvailable,
      deliveryState: slot.deliveryState,
      livenessState: slot.livenessState,
      permissionBlocked: uniqueClassifications.includes("BLOCKED_BY_PERMISSION") || slot.permissionBlocked === true,
      idleStalled: slot.idleStalled,
      otherBlockers: failureClassifications
    });

    // Hard fail-closed gate: a governed-role occupant may not ACTIVATE (begin governed work)
    // unless governedReadiness is GOVERNED_READY. Launch/provisioning may still proceed. This
    // closes the legacy readyOccupant / failureClassifications path where an MCP-configured or
    // skill-on-disk slot with no verified protocol uptake could reach TEAM_ACTIVATION_ALLOWED.
    const governedOccupant = isGovernedRole(slot.roleSlot) && !vacantSlot;
    const activationAllowed = governedOccupant ? activationAllowedBase && governed.state === "GOVERNED_READY" : activationAllowedBase;
    if (governedOccupant && activationAllowedBase && governed.state !== "GOVERNED_READY") {
      notes.push("Governed activation hard-blocked: occupant is not GOVERNED_READY (verified protocol uptake required). Launch/provisioning may proceed, but the occupant must not begin governed work until a governed-context proof verifies.");
    }

    return {
      roleSlot: slot.roleSlot,
      harness,
      status,
      launchAllowed,
      activationAllowed,
      governedActivationBlocked: governedOccupant && governed.state !== "GOVERNED_READY",
      classifications: uniqueClassifications,
      safeOutcomes: status === "PASS" ? [] : defaultSafeOutcomes(),
      scpContextSources: sources,
      mcpVersion: slot.mcpVersion,
      deferredMcpHydration: slot.canHydrateDeferredMcpToolsAtBoot === true ? "AT_BOOT" : slot.canHydrateDeferredMcpToolsAfterSecondTurn === true ? "AFTER_SECOND_TURN" : "UNPROVEN",
      nativeSkillInvocation: slot.nativeSkillInvocation === true,
      governedReadiness: governed.state,
      governedReadinessNextAction: governed.nextSafeAction,
      notes
    };
  });

  const overallStatus = hasSlots && rows.every((row) => row.launchAllowed) && cmuxAvailable && execPmAuthorized ? "PASS" : "FAIL";
  const activationStatus = hasSlots && rows.every((row) => row.activationAllowed) && cmuxAvailable && execPmAuthorized ? "TEAM_ACTIVATION_ALLOWED" : "TEAM_ACTIVATION_BLOCKED";
  const governedReadinessStatus = hasSlots && rows.every((row) => row.governedReadiness === "GOVERNED_READY") ? "ALL_GOVERNED_READY" : "GOVERNED_READINESS_INCOMPLETE";

  return {
    version: VERSION,
    minimumMcpVersion: minimum,
    phases: GOVERNED_LAUNCH_PHASES,
    overallStatus,
    activationStatus,
    governedReadinessStatus,
    governedActivationBlockedCount: rows.filter((row) => row.governedActivationBlocked).length,
    governedReadinessModel: GOVERNED_READINESS_MODEL,
    execPmAuthorized,
    cmuxAvailable,
    userPrompt: "Are all intended harnesses provisioned with accounts, plans, API keys, or local inference credentials so they will not malfunction when spun up?",
    supportedSecretProviders: ["Doppler", "1Password CLI (op)", "environment variable names", "direnv", "mise", "dotenv-style file presence", "GitHub auth", "local provider config files"],
    roleCompatibilitySmokeTest: getRoleCompatibilitySmokeTest(),
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
    const key = harness.toLowerCase();
    const installedBinary = installed.has(key);
    const classifications = new Set<string>();
    if (!installedBinary) classifications.add("NOT_INSTALLED_OR_UNPROVEN");
    if (input.userProvisioningAnswer !== "yes") classifications.add("USER_INPUT_REQUIRED");
    for (const item of classifyProbeText(harness, observation?.text ?? "")) classifications.add(item);
    if (observation?.reasoningContentOnly === true && observation.visibleContent !== true) classifications.add("MODEL_REASONING_ONLY");
    if (observation?.httpReachable === false) classifications.add("MODEL_UNREACHABLE");
    if (observation?.modelLoaded === false) classifications.add("MODEL_UNREACHABLE");
    if ((observation?.elapsedSeconds ?? 0) > timeout && observation?.visibleContent !== true) classifications.add("MODEL_STALLED");
    if (key === "goose" && observation?.reasoningContentOnly === true && observation.visibleContent !== true) classifications.add("STREAMING_PROTOCOL_MISMATCH");

    // Structured auth status (zero-secret; status only, never values).
    if (observation?.authStatus === "AUTH_MISSING") classifications.add("BLOCKED_BY_API_KEY");
    if (observation?.authStatus === "AUTH_PROVIDER_BLOCKED") classifications.add("AUTH_PROVIDER_BLOCKED");
    if (observation?.authStatus === "AUTH_LOGIN_REQUIRED") classifications.add("BLOCKED_BY_LOGIN");
    if (observation?.authStatus === "AUTH_UNKNOWN") classifications.add("BLOCKED_BY_AUTH");

    // MCP management surface: `droid mcp` exists; Crush has no MCP management command.
    const mcpManagementAvailable = observation?.mcpManagementAvailable;
    if (mcpManagementAvailable === false) classifications.add(key === "crush" ? "MCP_UNAVAILABLE" : "MCP_UNPROVEN");

    // Droid: governed readiness needs `droid mcp`; read-only exec is allowed without write
    // authority; mission/high-autonomy recommendations require `--auto high`.
    if (key === "droid") {
      const autonomy = observation?.taskAutonomy ?? "read_only";
      if ((autonomy === "mission" || autonomy === "high_autonomy") && observation?.autoLevel !== "high") {
        classifications.add("AUTO_HIGH_REQUIRED");
      }
    }

    // Governed-context proof: MCP configured, native SCP skill, or full injected protocol text.
    const mcpConfigured = observation?.mcpConfigured === true;
    const scpSkillInstalled = observation?.scpSkillInstalled === true;
    const fullProtocolTextInjected = observation?.fullProtocolTextInjected === true;
    const hasGovernedContext = mcpConfigured || scpSkillInstalled || fullProtocolTextInjected;
    if (installedBinary && !hasGovernedContext) classifications.add("NON_GOVERNED_ONE_SHOT_ONLY");

    const modelStatus =
      classifications.has("STREAMING_PROTOCOL_MISMATCH") ? "STREAMING_PROTOCOL_MISMATCH" :
      classifications.has("MODEL_REASONING_ONLY") ? "MODEL_REASONING_ONLY" :
      classifications.has("MODEL_STALLED") ? "MODEL_STALLED" :
      classifications.has("MODEL_UNREACHABLE") ? "MODEL_UNREACHABLE" :
      observation?.visibleContent === true ? "MODEL_READY" : "MODEL_SLOW";

    // Multi-dimensional readiness: never collapse the distinct facts into one boolean.
    const canHydrateAtBoot = ["Codex", "Claude Code", "Droid"].includes(harness);
    const authBlockers = ["BLOCKED_BY_API_KEY", "AUTH_PROVIDER_BLOCKED", "BLOCKED_BY_LOGIN", "BLOCKED_BY_AUTH"];
    const authenticated: boolean | "unknown" =
      observation?.authStatus === "AUTH_READY" ? true :
      authBlockers.some((item) => classifications.has(item)) ? false :
      "unknown";
    const advisoryClassifications = new Set(["USER_INPUT_REQUIRED", "NON_GOVERNED_ONE_SHOT_ONLY"]);
    const blockingClassifications = [...classifications].filter((item) => !advisoryClassifications.has(item));

    // Fail-closed governed readiness: presence (mcp_configured / skill on disk) is necessary
    // context but never sufficient. GOVERNED_READY requires a verified governed-context uptake
    // proof at adequate assurance, plus no blocking classification, auth, or liveness issue.
    const authBlockerList = ["BLOCKED_BY_API_KEY", "AUTH_PROVIDER_BLOCKED", "BLOCKED_BY_LOGIN", "BLOCKED_BY_AUTH"].filter((item) => classifications.has(item));
    const governed = classifyGovernedReadiness({
      harness,
      installed: installedBinary,
      authenticated,
      requestedRole: observation?.requestedRole,
      governedContextProof: observation?.governedContextProof,
      hooksAvailable: observation?.hooksAvailable,
      deliveryState: observation?.deliveryState,
      livenessState: observation?.livenessState,
      permissionBlocked: classifications.has("BLOCKED_BY_PERMISSION") || observation?.permissionBlocked === true,
      idleStalled: observation?.idleStalled,
      authBlockers: authBlockerList,
      otherBlockers: blockingClassifications.filter((item) => !authBlockerList.includes(item))
    });
    const governedRoleReady = governed.state === "GOVERNED_READY";

    return {
      harness,
      installed: installedBinary,
      classifications: [...classifications],
      modelStatus,
      visibleOutputTimeoutSeconds: timeout,
      canHydrateDeferredMcpToolsAtBoot: canHydrateAtBoot,
      canHydrateDeferredMcpToolsAfterSecondTurn: true,
      nativeSkillInvocation: ["Codex", "Claude Code"].includes(harness),
      sentinelCoordinationProtocolSkill: "install before governed launch when the harness supports native skills",
      autoLevel: key === "droid" ? (observation?.autoLevel ?? "unknown") : observation?.autoLevel,
      governedReadiness: governed.state,
      governedContext: {
        category: governed.category,
        requiredAssurance: governed.requiredAssurance,
        proofAssurance: governed.proofAssurance,
        uptakeVerified: governed.uptakeVerified,
        blockers: governed.blockers
      },
      nextSafeAction: governed.nextSafeAction,
      readiness: {
        installed_binary: installedBinary,
        authenticated,
        mcp_configured: mcpConfigured,
        mcp_management_available: mcpManagementAvailable ?? "unknown",
        mcp_tool_hydration: canHydrateAtBoot ? "AT_BOOT" : "AFTER_SECOND_TURN",
        governed_context_uptake_verified: governed.uptakeVerified,
        governed_role_ready: governedRoleReady
      },
      safeNextActions: classifications.size === 0 ? [] : defaultSafeOutcomes(),
      sanitizedObservation: observation?.text ? redactSecretLikeText(observation.text) : undefined
    };
  });

  return {
    zeroSecretOutput: true,
    userPrompt: "Are all intended harnesses provisioned with accounts, plans, API keys, or local inference credentials so they will not malfunction when spun up?",
    secretProviderStatuses: providerStatuses,
    supportedProviders: ["Doppler", "1Password CLI (op)", "environment variable names", "direnv", "mise", "dotenv-style file presence", "GitHub auth", "local provider config files"],
    governedReadinessModel: GOVERNED_READINESS_MODEL,
    governedContextNote:
      "Presence is not authority. MCP being configured or an SCP skill existing on disk does not make a harness GOVERNED_READY; protocol uptake must be verified. Each row's governedReadiness is one of GOVERNED_READY, FIXABLE_BLOCKED, NON_GOVERNED_ONE_SHOT_ONLY, or UNSUPPORTED.",
    governedContextVerifier: "scripts/protocol/verify-governed-context.mjs",
    rows
  };
}

const ONBOARDING_ADVISORY_CLASSIFICATIONS = new Set(["USER_INPUT_REQUIRED"]);
const DEFAULT_INSTALL_LEDGER_PATH = ".odin/install-ledger.json";
const COMPUTER_USE_CANDIDATE_HARNESSES = ["Codex Desktop", "Claude Desktop", "Claude Code"];
const ONBOARDING_NO_SECRETS_NOTICE =
  "Do not paste API keys, tokens, OAuth values, or provider secrets into chat. Report only whether each harness is already provisioned (account, environment, secret manager, or local config). Secret and provider readiness is reported by status only.";

function onboardingGuidedSteps(): string[] {
  return [
    "Confirm Node.js >= 22.13.0 and the installed @bradheitmann/odin-sentinel package version.",
    "Prefer the pinned pnpm command (pnpm dlx --package @bradheitmann/odin-sentinel@0.4.11 odin-sentinel-mcp); npm global install and npx are supported when pinned to the same release.",
    "Add the odin-sentinel-mcp stdio command to each selected harness MCP config and restart the harness.",
    "Provide SCP context: install the native sentinel-coordination-protocol skill where supported, otherwise inject full protocol text via odin.get_bootstrap_skill, or export a snapshot via odin.export_protocol_snapshot for non-MCP clients.",
    "Deploy the activation hooks with `node scripts/protocol/install-activation-hooks.mjs` so the full-instruction-read precheck runs before governed edits.",
    "Run the MCP smoke test and confirm serverInfo.name = odin-sentinel and a compatible version.",
    "Probe harness readiness with odin.get_harness_probe_matrix (zero-secret) and clear any auth, login, permission, MCP, or skill blockers.",
    "Confirm each harness is signed in or configured outside chat without pasting secrets.",
    "Open CMUX, compute the surface layout, and launch governed role slots only after readiness passes or EXEC PM records a waiver or substitution."
  ];
}

function onboardingAssistedSteps(): string[] {
  return [
    "Choose one available computer-use-capable harness (for example Codex Desktop, Claude Desktop, or Claude Code) to perform setup on your behalf.",
    "Hand the guided setup steps to that harness as its task; it operates your desktop/GUI, while ODIN's MCP server only supplies this plan.",
    "Supervise the assisted run: approve permission prompts yourself and never paste secrets into chat.",
    "After install and configuration complete, re-run odin.get_harness_probe_matrix to confirm governed readiness before launching governed roles."
  ];
}

/**
 * Build a zero-secret, harness-aware onboarding plan. Reuses getHarnessProbeMatrix for
 * readiness classification (no second taxonomy) and presents two setup choices: guided
 * manual setup (the safe default) and assisted computer-use setup (offered only when a
 * computer-use-capable harness is available). The MCP server returns this plan only; actual
 * GUI/computer-use is performed by an available computer-use-capable harness after the user
 * chooses assisted setup. This function does not install, write, or delete any harness config
 * or ledger file.
 */
export function getOnboardingPlan(input: OnboardingPlanInput = {}): Record<string, unknown> {
  const probe = getHarnessProbeMatrix({
    intendedHarnesses: input.intendedHarnesses,
    installedHarnesses: input.installedHarnesses,
    userProvisioningAnswer: input.userProvisioningAnswer,
    observations: input.observations
  });
  const probeRows = Array.isArray(probe.rows) ? (probe.rows as Array<Record<string, unknown>>) : [];

  const readinessRows = probeRows.map((row) => {
    const classifications = Array.isArray(row.classifications) ? (row.classifications as string[]) : [];
    const blockers = classifications.filter((item) => !ONBOARDING_ADVISORY_CLASSIFICATIONS.has(item));
    const readiness = asRecord(row.readiness);
    const governedReadiness = typeof row.governedReadiness === "string" ? row.governedReadiness : "FIXABLE_BLOCKED";
    return {
      harness: row.harness,
      installed: row.installed === true,
      governedReadiness,
      governedRoleReady: governedReadiness === "GOVERNED_READY",
      governedContext: row.governedContext,
      governedNextSafeAction: row.nextSafeAction,
      classifications,
      blockers,
      readiness,
      modelStatus: row.modelStatus,
      nativeSkillInvocation: row.nativeSkillInvocation === true,
      scpSkillGuidance: row.sentinelCoordinationProtocolSkill,
      safeNextActions: Array.isArray(row.safeNextActions) ? row.safeNextActions : [],
      sanitizedObservation: row.sanitizedObservation
    };
  });

  const blockerSummary = readinessRows
    .filter((row) => row.blockers.length > 0)
    .map((row) => ({ harness: row.harness, blockers: row.blockers, governedReadiness: row.governedReadiness, governedRoleReady: row.governedRoleReady }));
  const classifications = [...new Set(readinessRows.flatMap((row) => row.classifications))].sort();
  const governedReadyHarnesses = readinessRows.filter((row) => row.governedRoleReady).map((row) => row.harness);
  const governedReadinessByHarness = readinessRows.map((row) => ({ harness: row.harness, governedReadiness: row.governedReadiness, nextSafeAction: row.governedNextSafeAction }));

  const computerUseAvailable = input.computerUseAvailable === true;
  // Accept the prose alias "assisted_computer_use" as canonical "assisted". The alias is a
  // compatibility spelling only; it never bypasses computerUseAvailable (assistedEligible below
  // still gates assisted on it), so an alias request with computer use off stays guided.
  const preferredRaw = input.preferredSetupMode ?? "unset";
  const preferred = preferredRaw === "assisted_computer_use" ? "assisted" : preferredRaw;
  // Assisted computer-use setup is offered only when a computer-use-capable harness is available.
  const assistedEligible = computerUseAvailable;

  let recommendedMode: OnboardingSetupMode;
  let modeRationale: string;
  if (preferred === "assisted" && assistedEligible) {
    recommendedMode = "assisted";
    modeRationale =
      "Assisted computer-use setup is available and was preferred. A computer-use-capable harness can perform setup on your behalf after you choose it; ODIN's MCP server only returns this plan and never drives the GUI itself.";
  } else if (preferred === "assisted" && !assistedEligible) {
    recommendedMode = "guided";
    modeRationale =
      "Assisted computer-use setup was requested, but computerUseAvailable is false, so guided manual setup is the safe available path.";
  } else if (preferred === "guided") {
    recommendedMode = "guided";
    modeRationale = "Guided manual setup was preferred; it is the safe, fully reviewable path.";
  } else {
    recommendedMode = "guided";
    modeRationale = assistedEligible
      ? "Guided manual setup is the safe default. Assisted computer-use setup is available if you prefer convenience; choose it explicitly to let an available computer-use harness perform setup for you."
      : "Guided manual setup is the safe default and the only available path because no computer-use-capable harness was reported.";
  }

  const ledgerPath = stringFieldPresent(input.ledgerPath) ? (input.ledgerPath as string).trim() : DEFAULT_INSTALL_LEDGER_PATH;
  const platform = input.platform ?? "unknown";
  const userProvisioningAnswer = input.userProvisioningAnswer ?? "unknown";
  const guidedSteps = onboardingGuidedSteps();

  let nextUserAction: string;
  if (userProvisioningAnswer !== "yes") {
    nextUserAction =
      "Confirm whether each intended harness is already provisioned (signed in or configured outside chat) without pasting secrets, then re-run onboarding.";
  } else if (blockerSummary.length > 0) {
    nextUserAction = `Resolve the harness blockers in blockerSummary (auth, login, permission, MCP, or skill) before launching governed roles, then proceed with ${recommendedMode} setup.`;
  } else {
    nextUserAction = `All probed harnesses are governed-ready. Proceed with ${recommendedMode} setup, then launch governed role slots in CMUX only after readiness passes.`;
  }

  return {
    version: VERSION,
    zeroSecretOutput: true,
    noSecretsNotice: ONBOARDING_NO_SECRETS_NOTICE,
    userProvisioningPrompt: probe.userPrompt,
    userProvisioningAnswer,
    supportedSecretProviders: probe.supportedProviders,
    secretProviderStatuses: probe.secretProviderStatuses,
    platform,
    recommendedMode,
    modeRationale,
    setupModes: {
      guided: {
        title: "Guided manual setup (safe default)",
        description:
          "You run each install, configure, and verify step yourself and review every change. This path is the safest and works without any computer-use capability.",
        steps: guidedSteps
      },
      assisted: {
        title: "Assisted computer-use setup (convenience)",
        eligible: assistedEligible,
        available: computerUseAvailable,
        requestedButUnavailable: preferred === "assisted" && !assistedEligible,
        description:
          "An available computer-use-capable harness performs the guided steps on your behalf after you choose it. ODIN's MCP server only returns this plan; it never controls the GUI or desktop itself.",
        candidateHarnesses: assistedEligible ? [...COMPUTER_USE_CANDIDATE_HARNESSES] : [],
        caveat:
          "MCP returns plans only. Actual GUI or computer-use actions are performed solely by an available computer-use-capable harness after you explicitly choose assisted setup.",
        steps: assistedEligible
          ? onboardingAssistedSteps()
          : ["Assisted setup is unavailable because no computer-use-capable harness was reported (computerUseAvailable is not true). Use guided setup."]
      }
    },
    guidedSetupSteps: guidedSteps,
    assistedSetupEligible: assistedEligible,
    readinessRows,
    classifications,
    blockerSummary,
    unresolvedBlockerCount: blockerSummary.length,
    governedReadyHarnesses,
    governedReadinessByHarness,
    governedReadinessModel: GOVERNED_READINESS_MODEL,
    ledgerPath,
    ledgerNote:
      "This onboarding plan only reports where ODIN-owned artifacts will be tracked. It does not create, write, validate, or delete the install ledger or any harness config file; ledger-aware install behavior is a separate step.",
    nextUserAction
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
    getOnboardingPlan,
    classifyGovernedReadiness,
    harnessCategory,
    getDelegationPacket,
    getActivationGates,
    validateCmuxDeliveryProof: (proof: Record<string, unknown>) => validateCmuxDeliveryProof(proof),
    validateInstructionReadProof: (proof: Record<string, unknown>) => validateInstructionReadProof(proof),
    validateGovernedContextProof: (proof: unknown) => validateGovernedContextProof(proof),
    validateDelegationPacket: (packet: Record<string, unknown>) => validateDelegationPacket(packet, repository),
    validateBootReceipt: (receipt: Record<string, unknown>) => validateBootReceipt(receipt, repository),
    validateTeamManifest: (manifest: Record<string, unknown>) => validateTeamManifest(manifest, repository),
    getCloseoutChecklist: (mode: CloseoutMode) => getCloseoutChecklist(mode, repository),
    getRuntimeNotice,
    exportProtocolSnapshot: () => exportProtocolSnapshot(repository)
  };
}
