import { createHash } from "node:crypto";
import YAML from "yaml";
import {
  createFileProtocolRepository,
  type ProtocolData,
  type ProtocolRepository
} from "./repository.js";
import { auditTargetSchema, EVIDENCE_CLASSES, govdispEventSchema, harnessControlEntrySchema, VERDICT_CLASS_ARTIFACTS } from "./schemas.js";
import type { AuditTarget, CloseoutMode, DelegationPacketInput, EscalationGateInput, EscalationGateResult, GovdispEvent, HarnessControlEntry, MissionFrontrunInput, MissionFrontrunPack, RoleCard, StartupPacketInput } from "./schemas.js";
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
  ".odin/handoffs/",
  ".odin/audit/"
];

export type { ProtocolData, ValidationResult };
export type { CloseoutMode, DelegationPacketInput, MissionFrontrunInput, MissionFrontrunPack, RoleCard, StartupPacketInput };
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
  // Bare team-prefixed PM slots (C/PM, D/PM) are TEAM PM seats; the exec form is
  // always spelled EXEC-PM and never reduces to bare "PM".
  if (normalized === "PM") return "TEAM_PM";
  // Worker slots resolve with or without a lane number: B/QA and B/QA-1 are the
  // same profile. Un-numbered slots are common in the field (single-lane pods).
  if (/^DEV(_\d+)?$/.test(normalized)) return "DEV_WORKER";
  if (/^QA(_\d+)?$/.test(normalized)) return "QA_WORKER";
  if (/^SHADOW(_\d+)?$/.test(normalized)) return "SHADOW_REVIEWER";
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
    // EPIC-028: control recipes are probe-visible so the matrix output carries
    // version-pinned quit_verb / model_set_recipe / control_recipe per harness.
    controlRecipe?: string;
    quitVerb?: string;
    modelSetRecipe?: string;
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
    if (requiredAssurance === "native_skill") return "Install the native odin-scp skill, load it, then capture a governed-context uptake proof (verify with scripts/protocol/verify-governed-context.mjs).";
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
    sources.add("native odin-scp skill");
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
  if (check.proofAssurance === "native_skill") return "native odin-scp skill";
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

type RoleCardEntry = { key: keyof ReturnType<typeof loadProtocolData>["roleCards"]; role_name: string };

const ROLE_CARD_MAP: Record<string, RoleCardEntry> = {
  "exec-pm":    { key: "execPm",    role_name: "EXEC PM" },
  "team-pm":    { key: "teamPm",    role_name: "TEAM PM" },
  "dev-worker": { key: "devWorker", role_name: "DEV WORKER" },
  "qa-worker":  { key: "qaWorker",  role_name: "QA WORKER" },
  "exec-asst":  { key: "execAsst",  role_name: "EXEC-ASST" }
};

export function getRoleCard(role_id: string, repository: ProtocolRepository = getDefaultRepository()): RoleCard {
  const entry = ROLE_CARD_MAP[role_id];
  if (!entry) {
    throw new Error(`Unknown role_id: ${safeErrorText(role_id)}. Valid values: ${Object.keys(ROLE_CARD_MAP).join(", ")}`);
  }
  const content = loadProtocolData(repository).roleCards[entry.key];
  const payload_bytes = Buffer.byteLength(content, "utf8");
  const content_sha256 = createHash("sha256").update(content).digest("hex");
  return {
    role_id,
    role_name: entry.role_name,
    version: VERSION,
    payload_bytes,
    content_sha256,
    content
  };
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
    "odin://protocol/skill-references/boot-receipt-examples",
    "odin://protocol/skill-references/canonical-introduction-prompt",
    "odin://protocol/skill-references/harness-skill-targets",
    "odin://protocol/skill-references/team-bootstrap-runbook",
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
      "Valid SCP context source required for governed occupants: native odin-scp skill, compatible odin-sentinel MCP, or full injected SCP protocol text.",
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
function validateCmuxDeliveryProofProse(proof: Record<string, unknown>): ValidationResult {
  const dryRun = proof.dry_run === true;
  // A pre-dispatch dry-run validates the PLAN (payload/format compatibility)
  // before anything is sent, so submission/processing fields are not yet due.
  const requiredFields = dryRun
    ? ["target_surface_locator", "sender_role", "timestamp"]
    : CMUX_DELIVERY_PROOF_FIELDS;
  const missing = validateRequiredFields(proof, requiredFields);
  const invalid = validateFieldTypes(proof, {
    target_surface_locator: "string",
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

  if (proof.submitted !== undefined && typeof proof.submitted !== "boolean") {
    invalid.push("submitted");
  }
  if (!dryRun && proof.submitted === false) {
    invalid.push("submitted");
    warnings.push("CMUX text was not submitted with Enter; this is INPUT_BAR_ONLY, not delivery. Send Enter and re-read the target surface.");
  }

  // EPIC-020 — per-harness format compatibility. Field origin 2026-06-27: a
  // message with embedded newlines sent to a single-submit harness (GLM-5.2 on
  // Pi) is submitted one line per prompt ("machine-gunning") even when Enter
  // was sent, jamming the recipient. The trigger is the embedded newline
  // itself — not multiple send calls — so it is named explicitly here.
  const submitProfile = typeof proof.target_submit_profile === "string" ? proof.target_submit_profile : undefined;
  const payloadPreview = typeof proof.payload_preview === "string" ? proof.payload_preview : undefined;
  const payloadHasNewline =
    proof.payload_contains_newline === true ||
    (payloadPreview !== undefined && /[\r\n]/.test(payloadPreview));
  if (submitProfile === "single_line_flatten" && payloadHasNewline && proof.newlines_flattened !== true) {
    invalid.push("payload_contains_newline");
    warnings.push(
      "MULTILINE_TO_SINGLE_SUBMIT_HARNESS: the payload contains embedded newlines and the target harness submits on EVERY newline — each line fires as a separate prompt (machine-gunning) even with Enter sent. Flatten newlines/CR/tabs to single spaces (field separator \" ;; \") before the one submit, or set newlines_flattened: true when the canonical helper already flattened it."
    );
  }
  if (dryRun) {
    warnings.push("dry_run: pre-dispatch format check only — this proof does not attest delivery; emit a full delivery proof after the send.");
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
 * STORY-GOVDISP-005 registry-mode branch (flag ODIN_GOVDISP_REGISTRY_MCP, ON by
 * default as of 0.6.0 — Amendment 46; a non-truthy value is the explicit
 * opt-out). Flag OFF (explicit opt-out): byte-compatible with the
 * prose-authority baseline. Flag ON (the default):
 * a payload carrying registry_authority: { scope, event_id } is adjudicated
 * against the registry alone — a resolved reference is the single authority
 * (prose is transport/history; GD-FP-013), an unresolvable reference is rejected
 * by name (registry_authority_unresolved) with no silent prose fallback — and a
 * prose-only payload validates as before with authority: "prose_transport".
 */
export function validateCmuxDeliveryProof(
  proof: Record<string, unknown>,
  options: RegistryAuthorityOptions = {}
): RegistryModeValidationResult {
  const adjudicated = adjudicateRegistryAuthority("cmux_delivery_proof", proof, options);
  if (adjudicated !== null) return adjudicated;
  return withProseTransportAdvisory(validateCmuxDeliveryProofProse(proof), options);
}

/**
 * Validate the shape of a full-instruction-read proof: a role, a generation timestamp, and
 * a non-empty files[] list where each entry carries a path, a byte or line count, and a
 * sha256 digest. Disk verification (does the digest still match the file?) is performed by
 * scripts/protocol/verify-instruction-read.mjs.
 */
function validateInstructionReadProofProse(proof: Record<string, unknown>): ValidationResult {
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
 * STORY-GOVDISP-005 registry-mode branch (flag ODIN_GOVDISP_REGISTRY_MCP, ON by
 * default as of 0.6.0 — Amendment 46; a non-truthy value is the explicit
 * opt-out). Flag OFF (explicit opt-out): byte-compatible with the
 * prose-authority baseline. Flag ON (the default):
 * a payload carrying registry_authority: { scope, event_id } is adjudicated
 * against the registry alone — a resolved reference is the single authority
 * (prose is transport/history; GD-FP-013), an unresolvable reference is rejected
 * by name (registry_authority_unresolved) with no silent prose fallback — and a
 * prose-only payload validates as before with authority: "prose_transport".
 */
export function validateInstructionReadProof(
  proof: Record<string, unknown>,
  options: RegistryAuthorityOptions = {}
): RegistryModeValidationResult {
  const adjudicated = adjudicateRegistryAuthority("instruction_read_proof", proof, options);
  if (adjudicated !== null) return adjudicated;
  return withProseTransportAdvisory(validateInstructionReadProofProse(proof), options);
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
        control_source: { path: "~/.claude/skills/odin-scp/SKILL.md", marker: "SCP_PUBLIC_VERSION: 0.4.x", sha256: "<sha256-digest>" },
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

function validateDelegationPacketProse(
  packet: Record<string, unknown>,
  repository: ProtocolRepository = getDefaultRepository(),
  options: RegistryAuthorityOptions = {}
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
    const deliveryResult = validateCmuxDeliveryProof(asRecord(deliveryProof), options);
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

/**
 * STORY-GOVDISP-005 registry-mode branch (flag ODIN_GOVDISP_REGISTRY_MCP, ON by
 * default as of 0.6.0 — Amendment 46; a non-truthy value is the explicit
 * opt-out). Flag OFF (explicit opt-out): byte-compatible with the
 * prose-authority baseline. Flag ON (the default):
 * a payload carrying registry_authority: { scope, event_id } is adjudicated
 * against the registry alone — a resolved reference is the single authority
 * (prose is transport/history; GD-FP-013), an unresolvable reference is rejected
 * by name (registry_authority_unresolved) with no silent prose fallback — and a
 * prose-only payload validates as before with authority: "prose_transport". The
 * embedded delivery_proof of a prose-transport packet is adjudicated by the same
 * branch (options pass through to the delivery-proof validator).
 */
export function validateDelegationPacket(
  packet: Record<string, unknown>,
  repository: ProtocolRepository = getDefaultRepository(),
  options: RegistryAuthorityOptions = {}
): RegistryModeValidationResult {
  const adjudicated = adjudicateRegistryAuthority("delegation_packet", packet, options);
  if (adjudicated !== null) return adjudicated;
  return withProseTransportAdvisory(validateDelegationPacketProse(packet, repository, options), options);
}

function validateBootReceiptProse(
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
        missing.push(field);
        warnings.push(`staffing audit field required on non-exec receipt (team != "A"): ${field}`);
      }
    }
    const canonicalStaffer =
      typeof staffingAuditAudit.staffed_by_canonical_value === "string"
        ? staffingAuditAudit.staffed_by_canonical_value
        : "A/EXEC-PM";
    if (typeof receipt.staffed_by === "string" && receipt.staffed_by !== canonicalStaffer) {
      invalid.push("staffed_by");
      warnings.push(`staffed_by is "${receipt.staffed_by}" but staffing authority belongs solely to ${canonicalStaffer}; self-staffing is halt-eligible`);
    }
    if (typeof receipt.team_letter === "string" && receipt.team_letter !== "" && receipt.team_letter !== team) {
      invalid.push("team_letter");
      warnings.push(`team_letter "${receipt.team_letter}" does not match the receipt's team prefix "${team}"`);
    }
  }

  return buildValidationResult(missing, invalid, warnings);
}

/**
 * STORY-GOVDISP-005 registry-mode branch (flag ODIN_GOVDISP_REGISTRY_MCP, ON by
 * default as of 0.6.0 — Amendment 46; a non-truthy value is the explicit
 * opt-out). Flag OFF (explicit opt-out): byte-compatible with the
 * prose-authority baseline. Flag ON (the default):
 * a payload carrying registry_authority: { scope, event_id } is adjudicated
 * against the registry alone — a resolved reference is the single authority
 * (prose is transport/history; GD-FP-013), an unresolvable reference is rejected
 * by name (registry_authority_unresolved) with no silent prose fallback — and a
 * prose-only payload validates as before with authority: "prose_transport".
 */
export function validateBootReceipt(
  receipt: Record<string, unknown>,
  repository: ProtocolRepository = getDefaultRepository(),
  options: RegistryAuthorityOptions = {}
): RegistryModeValidationResult {
  const adjudicated = adjudicateRegistryAuthority("boot_receipt", receipt, options);
  if (adjudicated !== null) return adjudicated;
  return withProseTransportAdvisory(validateBootReceiptProse(receipt, repository), options);
}

function validateTeamManifestProse(
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

/**
 * STORY-GOVDISP-005 registry-mode branch (flag ODIN_GOVDISP_REGISTRY_MCP, ON by
 * default as of 0.6.0 — Amendment 46; a non-truthy value is the explicit
 * opt-out). Flag OFF (explicit opt-out): byte-compatible with the
 * prose-authority baseline. Flag ON (the default):
 * a payload carrying registry_authority: { scope, event_id } is adjudicated
 * against the registry alone — a resolved reference is the single authority
 * (prose is transport/history; GD-FP-013), an unresolvable reference is rejected
 * by name (registry_authority_unresolved) with no silent prose fallback — and a
 * prose-only payload validates as before with authority: "prose_transport".
 */
export function validateTeamManifest(
  manifest: Record<string, unknown>,
  repository: ProtocolRepository = getDefaultRepository(),
  options: RegistryAuthorityOptions = {}
): RegistryModeValidationResult {
  const adjudicated = adjudicateRegistryAuthority("team_manifest", manifest, options);
  if (adjudicated !== null) return adjudicated;
  return withProseTransportAdvisory(validateTeamManifestProse(manifest, repository), options);
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
        "Finding ownership duty binding (GD-DEC-005): a finding is not ACTIVE until it carries both a FINDING_OWNED owner binding and a FINDING_DELIVERED delivery event; only owner-bound findings with delivery events count toward intervention duties, and a FINDING_CLOSED raised without both prerequisites is refused finding_not_active.",
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

/**
 * Exact canonical snake_case machine id shape (STORY-GOVTRUTH-R4 AC7):
 * lowercase letters and digits, underscore-separated. Identity is decided by
 * exact canonical match, never by coincidental normalization.
 */
const CANONICAL_HARNESS_ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** True only for a string already in exact canonical snake_case id form. */
export function isCanonicalHarnessId(value: string): boolean {
  return CANONICAL_HARNESS_ID_PATTERN.test(value);
}

/**
 * Canonical snake_case machine id for a harness (STORY-GOVTRUTH-R4 AC7).
 * FAIL-CLOSED: the input must ALREADY be in exact canonical snake_case form —
 * this function never case-folds, trims, or otherwise transforms it. A
 * case-respelled form (e.g. "DROID", "GOOsE", "kilOcode"), a display name, or
 * any other mutation is refused with a named error identifying the
 * non-canonical form. Display names are explicit fields on the resource
 * entries (the explicit display-name channel), never an inferred transform of
 * the id or of any other string.
 */
export function canonicalHarnessId(name: string): string {
  if (!isCanonicalHarnessId(name)) {
    throw new Error(
      `non_canonical_harness_id: "${name}" is not an exact canonical snake_case harness id; ` +
      `canonical ids (e.g. "claude_code", "droid", "opencode") are matched exactly and are never ` +
      `case-folded or transformed — use the entry's explicit display_name channel for human-friendly forms`
    );
  }
  return name;
}

/**
 * STORY-GOVTRUTH-R4: load and validate the harness entries from the SINGLE
 * source of truth, protocol/resources/harness-control-matrix.yaml (via the
 * protocol repository). The former in-code HARNESS_CONTROL_RECIPES catalog is
 * removed; every recipe field the probe matrix serves derives from these
 * entries at runtime. A malformed entry fails closed with a named error
 * (including verified/version_pin contradictions: a verified entry must carry
 * an exact pin, an unverified entry must not carry one).
 */
function loadHarnessControlEntries(repository: ProtocolRepository): HarnessControlEntry[] {
  const data = loadProtocolData(repository);
  const matrix = requireRecord(data.harnessControlMatrix.harness_control_matrix, "harness-control-matrix.harness_control_matrix");
  const rawEntries = Array.isArray(matrix.harnesses) ? matrix.harnesses : [];
  if (rawEntries.length === 0) {
    throw new Error("harness-control-matrix.yaml declares no harnesses; the resource is the sole source of harness recipe data");
  }
  return rawEntries.map((raw, index) => {
    const parsed = harnessControlEntrySchema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "<entry>"}: ${issue.message}`).join("; ");
      throw new Error(`harness-control-matrix.yaml harnesses[${index}] is invalid: ${detail}`);
    }
    return parsed.data;
  });
}

export function getHarnessProbeMatrix(
  input: HarnessProbeInput = {},
  repository: ProtocolRepository = getDefaultRepository()
): Record<string, unknown> {
  const entries = loadHarnessControlEntries(repository);
  const entriesById = new Map(entries.map((entry) => [entry.harness_id, entry]));
  // The explicit display-name channel (AC7): declared display_name fields,
  // matched exactly — never derived from ids or matched case-insensitively.
  const entriesByDisplayName = new Map(entries.map((entry) => [entry.display_name, entry]));
  // Default probe list = the resource's full membership (canonical ids carried
  // as explicit display names). Callers may still pass display names or ids.
  const intended = input.intendedHarnesses ?? entries.map((entry) => entry.display_name);
  const installed = new Set((input.installedHarnesses ?? []).map((value) => value.toLowerCase()));
  const observations = input.observations ?? [];
  const timeout = input.visibleOutputTimeoutSeconds ?? 60;
  const providerStatuses = Object.fromEntries(
    Object.entries(input.providerStatuses ?? {}).map(([name, present]) => [name, { present, value: present ? "present redacted" : "absent" }])
  );

  const rows = intended.map((intendedName) => {
    // Membership resolution (AC7, FAIL-CLOSED): an intended harness resolves
    // ONLY by the entry's explicit display_name field (the explicit
    // display-name channel) or by exact canonical snake_case machine id.
    // Case-respelled or otherwise mutated forms (e.g. "DROID", "GOOsE",
    // "kilOcode") are refused as non-canonical, never silently folded into a
    // resource-backed member.
    const entry = entriesByDisplayName.get(intendedName)
      ?? (isCanonicalHarnessId(intendedName) ? entriesById.get(intendedName) : undefined);
    if (!entry) {
      throw new Error(
        `unknown_or_non_canonical_harness: "${intendedName}" does not resolve to any harness — ` +
        `resolution requires the exact canonical snake_case machine id (e.g. "droid") or the exact ` +
        `declared display_name (e.g. "Droid"); case-respelled or otherwise mutated forms are refused, ` +
        `never silently normalized`
      );
    }
    const harnessId = canonicalHarnessId(entry.harness_id);
    const harness = entry.display_name;
    // Observation identity follows the same rule: exact display_name or exact
    // canonical id — never case-folded.
    const observation = observations.find((item) => item.harness === harness || item.harness === harnessId);
    const key = harness.toLowerCase();
    const installedBinary = installed.has(key) || installed.has(intendedName.toLowerCase());
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
    const canHydrateAtBoot = ["codex", "claude_code", "droid"].includes(harnessId);
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
      // AC7: the canonical snake_case machine id is the identity; the display
      // name is the explicit display_name field from the resource entry.
      harnessId,
      displayName: harness,
      installed: installedBinary,
      classifications: [...classifications],
      modelStatus,
      visibleOutputTimeoutSeconds: timeout,
      canHydrateDeferredMcpToolsAtBoot: canHydrateAtBoot,
      canHydrateDeferredMcpToolsAfterSecondTurn: true,
      nativeSkillInvocation: ["codex", "claude_code"].includes(harnessId),
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
      // STORY-GOVTRUTH-R4: every probe row exposes all six recipe fields,
      // derived at runtime from protocol/resources/harness-control-matrix.yaml
      // (the sole source of harness recipe data; the in-code catalog is gone).
      // A field is null when the entry is unverified and records no value.
      // versionPin is READ from the resource — never pinned data for an
      // unverified entry (verified: false ⇒ no pin, labeled unverified).
      verified: entry?.verified === true,
      recipeVerification: entry?.verified === true ? "verified" : "unverified",
      versionPin: entry?.version_pin ?? null,
      submitProfile: entry?.submit_profile ?? null,
      newlinePolicy: entry?.newline_policy ?? null,
      controlRecipe: observation?.controlRecipe ?? entry?.control_recipe ?? null,
      quitVerb: observation?.quitVerb ?? entry?.quit_verb ?? null,
      modelSetRecipe: observation?.modelSetRecipe ?? entry?.model_set_recipe ?? null,
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
    recipeSource: "protocol/resources/harness-control-matrix.yaml",
    unverifiedRecipeNote:
      "Rows with verified: false expose best-effort default recipes that were never verified against a live harness release; they carry no version pin. Verify on a disposable surface before governed use.",
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
    "Prefer the pinned pnpm command (pnpm dlx --package @bradheitmann/odin-sentinel@0.6.0 odin-sentinel-mcp); npm global install and npx are supported when pinned to the same release.",
    "Add the odin-sentinel-mcp stdio command to each selected harness MCP config and restart the harness.",
    "Provide SCP context: install the native odin-scp skill where supported, otherwise inject full protocol text via odin.get_bootstrap_skill, or export a snapshot via odin.export_protocol_snapshot for non-MCP clients.",
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
export function getOnboardingPlan(
  input: OnboardingPlanInput = {},
  repository: ProtocolRepository = getDefaultRepository()
): Record<string, unknown> {
  const probe = getHarnessProbeMatrix({
    intendedHarnesses: input.intendedHarnesses,
    installedHarnesses: input.installedHarnesses,
    userProvisioningAnswer: input.userProvisioningAnswer,
    observations: input.observations
  }, repository);
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
    "protocol/receipts/team-manifest.yaml": YAML.stringify(data.teamManifest),
    "protocol/bootstrap-skill.md": data.bootstrapSkill,
    "protocol/skill-references/boot-receipt-examples.md": data.skillReferences.bootReceiptExamples,
    "protocol/skill-references/canonical-introduction-prompt.md": data.skillReferences.canonicalIntroductionPrompt,
    "protocol/skill-references/harness-skill-targets.md": data.skillReferences.harnessSkillTargets,
    "protocol/skill-references/team-bootstrap-runbook.md": data.skillReferences.teamBootstrapRunbook
  };
}

/**
 * Assemble a Factory Mission front-running contract pack. Substitutes mustache-style
 * placeholders ({{WRITE_SCOPE}}, {{TASK_ID}}, {{REPO_PATH}}, {{MISSION_NAME}}) from input
 * into each of the five template files, returns the launch command template, the
 * boot_contract_receipt template object, and a notes block distinguishing the PROVEN
 * --append-system-prompt-file seam from the UNPROVEN mission-local validator skill seam.
 *
 * Launch through the seam:
 *   droid exec --mission --auto <level> \
 *     --model <model> --reasoning-effort <effort> \
 *     --append-system-prompt-file <orchestrator-contract-path> \
 *     -f <mission-prompt-file>
 */
export function getMissionFrontrunPack(
  input: MissionFrontrunInput,
  repository: ProtocolRepository = getDefaultRepository()
): MissionFrontrunPack {
  const data = loadProtocolData(repository);
  const writeScopeStr = input.write_scope.length > 0 ? input.write_scope.join(", ") : "[]";

  function substitute(template: string): string {
    return template
      .replace(/\{\{WRITE_SCOPE\}\}/g, writeScopeStr)
      .replace(/\{\{TASK_ID\}\}/g, input.task_id)
      .replace(/\{\{REPO_PATH\}\}/g, input.repo_path)
      .replace(/\{\{MISSION_NAME\}\}/g, input.mission_name);
  }

  return {
    mission_name: input.mission_name,
    repo_path: input.repo_path,
    task_id: input.task_id,
    write_scope: input.write_scope,
    contracts: {
      orchestrator: substitute(data.missionFrontrun.orchestratorContract),
      worker: substitute(data.missionFrontrun.workerContract),
      scrutiny_validator: substitute(data.missionFrontrun.scrutinyValidatorContract),
      scrutiny_feature_reviewer: substitute(data.missionFrontrun.scrutinyFeatureReviewerContract),
      droids_scrutiny_feature_reviewer: substitute(data.missionFrontrun.droidsScrutinyFeatureReviewer)
    },
    launch_command_template: [
      "# Write the orchestrator contract to the appended system prompt file before launch.",
      "# Then launch the mission through the PROVEN seam:",
      "droid exec --mission --auto <level> \\",
      "  --model <model-id> --reasoning-effort <low|medium|high> \\",
      "  --worker-model <worker-model-id> --worker-reasoning-effort <low|medium|high> \\",
      "  --validator-model <validator-model-id> --validator-reasoning-effort <low|medium|high> \\",
      "  --append-system-prompt-file <path/to/orchestrator-contract.md> \\",
      "  -f <path/to/mission-prompt.md>"
    ].join("\n"),
    boot_contract_receipt_template: {
      role: "<factory/orchestrator|factory/worker|factory/scrutiny-validator|factory/scrutiny-feature-reviewer>",
      session_id: "<session-id assigned by Factory>",
      contract_path: "<path to this contract file as loaded>",
      byte_count: "<byte count of this contract file as loaded>",
      sha256: "<sha256 of this contract file as loaded>",
      timestamp: "<ISO-8601 UTC timestamp>"
    },
    notes: {
      proven_seam: "PROVEN (live-verified 2026-06-12): --append-system-prompt-file front-runs all four Factory Mission hidden roles (orchestrator, worker, scrutiny-validator, scrutiny-feature-reviewer) before Factory's weaker defaults activate. Launch through this seam using odin.get_mission_frontrun_pack contracts.",
      unproven_seam: "UNPROVEN: mission-local validator skill shadowing (skills/scrutiny-validator/SKILL.md). In the 2026-06-12 probe the validator loaded builtin:scrutiny-validator, not the mission-local file. Do not rely on this seam for governance until a follow-up isolation probe confirms it.",
      tool: "odin.get_mission_frontrun_pack"
    }
  };
}

// ---------------------------------------------------------------------------
// EPIC-027 — Step-Up Remediation Ladder
// Doctrine: protocol/resources/step-up-ladder.yaml (configurable; no bindings ship here).
// ---------------------------------------------------------------------------

/**
 * Evaluate the escalation gate for a tier's attempt.
 *
 * DONE requires an INDEPENDENT positive (QA pass or sealed-holdout pass) with no
 * failures — a green from a tool the producing agent itself wrote never passes.
 * Any real gate failure steps up one tier (REMEDIATE) until the reserve tier,
 * where failure escalates to the operator instead of silently retrying.
 */
export function evaluateEscalationGate(input: EscalationGateInput): EscalationGateResult {
  const { tierCount, currentTierIndex, observations } = input;
  if (currentTierIndex >= tierCount) {
    throw new Error(`currentTierIndex ${currentTierIndex} is outside the configured ladder (tierCount ${tierCount})`);
  }

  const failedGates: string[] = [];
  if (observations.qa_verdict === "REJECT") failedGates.push("QA_REJECT");
  if (observations.holdout_result === "FAIL") failedGates.push("HOLDOUT_FAIL");
  if (observations.self_proof === "GAP") failedGates.push("SELF_PROOF_GAP");
  if (observations.budget_exhausted === true) failedGates.push("BUDGET_EXHAUSTED");
  if (observations.blocked === true) failedGates.push("BLOCKED");

  const independentPass = observations.qa_verdict === "PASS" || observations.holdout_result === "PASS";
  const atReserveTier = currentTierIndex === tierCount - 1;
  const reasons: string[] = [];

  if (failedGates.length === 0) {
    if (independentPass) {
      reasons.push("no gate failed and an independent gate (QA or sealed holdout) passed");
      return { verdict: "DONE", failed_gates: [], next_tier_index: null, reasons, remediation_requirements: null };
    }
    if (observations.self_tool_green === true) {
      reasons.push("only a self-authored tool reported green; a self-tool green is never accepted as a pass");
    }
    reasons.push("no independent gate (QA verdict or sealed holdout) was observed; obtain one at the CURRENT tier — an unproven attempt does not justify a step-up");
    return { verdict: "INSUFFICIENT_EVIDENCE", failed_gates: [], next_tier_index: null, reasons, remediation_requirements: null };
  }

  if (atReserveTier) {
    reasons.push(`gate failure at the reserve (top) tier ${currentTierIndex}: ${failedGates.join(", ")}; never silent-fail past the top of the ladder`);
    return { verdict: "ESCALATE_OPERATOR", failed_gates: failedGates, next_tier_index: null, reasons, remediation_requirements: null };
  }

  reasons.push(`gate failure at tier ${currentTierIndex}: ${failedGates.join(", ")}; the work is PROVEN hard — step up one tier and REWORK`);
  return {
    verdict: "REMEDIATE",
    failed_gates: failedGates,
    next_tier_index: currentTierIndex + 1,
    reasons,
    remediation_requirements: [
      "hand the next tier the salvaged artifact (rework, never restart)",
      "carry the exact failure reason from the failed gate",
      "the acceptance bar is UNCHANGED across tiers",
      `review lane = tier ${currentTierIndex + 1}'s OWN QA + holdout lane (independence travels with the DEV)`,
      "record dead-end attempts so the next tier does not repeat them",
      "validate the handoff with odin.validate_remediation_packet"
    ]
  };
}

const REMEDIATION_FAILED_GATES = ["QA_REJECT", "HOLDOUT_FAIL", "SELF_PROOF_GAP"] as const;

/**
 * Validate a step-up remediation packet (the baton). Required fields come from
 * the step-up-ladder doctrine resource; the semantic rules — non-empty salvage,
 * immutable acceptance bar, review lane travels with the DEV — are enforced here.
 */
export function validateRemediationPacket(
  packet: Record<string, unknown>,
  repository: ProtocolRepository = getDefaultRepository()
): ValidationResult {
  const data = loadProtocolData(repository);
  const ladder = asRecord(asRecord(data.stepUpLadder).step_up_ladder);
  const packetSchema = asRecord(ladder.remediation_packet);
  const required = Array.isArray(packetSchema.required_fields)
    ? (packetSchema.required_fields as unknown[]).filter((f): f is string => typeof f === "string")
    : ["task_ref", "tier_index", "artifact_paths", "failure_reason", "failed_gate", "acceptance_bar", "next_tier_index", "review_lane_tier_index"];

  const missing = validateRequiredFields(packet, required);
  const invalid: string[] = [];
  const warnings: string[] = [];

  // Rework, never restart: an empty baton is a restart in disguise.
  if (packet.artifact_paths !== undefined) {
    if (!Array.isArray(packet.artifact_paths) || packet.artifact_paths.length === 0 ||
        !packet.artifact_paths.every((p) => typeof p === "string" && p.trim().length > 0)) {
      invalid.push("artifact_paths");
      warnings.push("artifact_paths must be a non-empty list of salvaged artifact paths; an empty baton is a restart, which the ladder forbids");
    }
  }

  if (packet.failed_gate !== undefined &&
      !REMEDIATION_FAILED_GATES.includes(packet.failed_gate as (typeof REMEDIATION_FAILED_GATES)[number])) {
    invalid.push("failed_gate");
    warnings.push(`failed_gate must be one of ${REMEDIATION_FAILED_GATES.join(" | ")}`);
  }

  const tierIndex = typeof packet.tier_index === "number" ? packet.tier_index : undefined;
  const nextTier = typeof packet.next_tier_index === "number" ? packet.next_tier_index : undefined;
  const reviewLaneTier = typeof packet.review_lane_tier_index === "number" ? packet.review_lane_tier_index : undefined;

  if (tierIndex !== undefined && (!Number.isInteger(tierIndex) || tierIndex < 0)) invalid.push("tier_index");
  if (tierIndex !== undefined && nextTier !== undefined && nextTier !== tierIndex + 1) {
    invalid.push("next_tier_index");
    warnings.push(`next_tier_index must be tier_index + 1 (one rung at a time); got ${nextTier} after tier ${tierIndex}`);
  }
  if (nextTier !== undefined && reviewLaneTier !== undefined && reviewLaneTier !== nextTier) {
    invalid.push("review_lane_tier_index");
    warnings.push(`review lane travels WITH the DEV: review_lane_tier_index must equal next_tier_index ${nextTier}; a borrowed (prior-tier) reviewer breaks QA independence`);
  }

  if (typeof packet.acceptance_bar === "string" && packet.acceptance_bar.trim().length === 0) {
    invalid.push("acceptance_bar");
    warnings.push("acceptance_bar must be the non-empty, unchanged bar from the original assignment");
  }
  if (typeof packet.original_acceptance_bar === "string" && typeof packet.acceptance_bar === "string" &&
      packet.original_acceptance_bar !== packet.acceptance_bar) {
    invalid.push("acceptance_bar");
    warnings.push("acceptance bar is immutable across tiers: acceptance_bar differs from original_acceptance_bar");
  }

  if (packet.attempts === undefined) {
    warnings.push("attempts (dead-ends tried) is recommended so the next tier does not repeat them");
  }

  return buildValidationResult(missing, invalid, warnings);
}

// ---------------------------------------------------------------------------
// EPIC-024 — Roster continuity & dead-seat / mass-outage failover.
// ---------------------------------------------------------------------------

const CANONICAL_FAILOVER_TRIGGERS = ["AGENT_DEATH", "USAGE_CAP_EXHAUSTION", "SILENT_SESSION_DROP"];
const NON_TRIGGER_OPERATOR_SIDE = ["PROVIDER_BILLING_ERROR", "BILLING_ERROR", "INSUFFICIENT_BALANCE"];
const HARNESS_DEFAULT_MODEL_PATTERN = /^(default|harness[\s_-]?default|auto|latest|whatever|unset|)$/i;

/**
 * Validate a dev-pod pre-staged fallback contract. The trap this guards
 * (RFC-v2.3 §5, HIGH): a fallback that names only a harness inherits that
 * harness's DEFAULT model, which can silently seat a non-agentic model in a
 * control role — the pod just stalls. Every rung must pin model + flags, and
 * "no authorized substitute" must resolve to PAUSE_ESCALATE, never improvisation.
 */
export function validateFallbackContract(contract: Record<string, unknown>): ValidationResult {
  const missing = validateRequiredFields(contract, [
    "role_slot",
    "fallback_rungs",
    "substitution_triggers",
    "post_relaunch_model_verify"
  ]);
  const invalid: string[] = [];
  const warnings: string[] = [];

  const rungs = Array.isArray(contract.fallback_rungs) ? contract.fallback_rungs : undefined;
  if (contract.fallback_rungs !== undefined && rungs === undefined) invalid.push("fallback_rungs");

  if (rungs !== undefined) {
    if (rungs.length === 0) {
      if (contract.no_substitute_action !== "PAUSE_ESCALATE") {
        invalid.push("no_substitute_action");
        warnings.push("no authorized substitute exists: no_substitute_action must be PAUSE_ESCALATE — pause the pod and escalate to the operator, never improvise a seat");
      }
    } else {
      rungs.forEach((rung, index) => {
        const r = asRecord(rung);
        const model = typeof r.model === "string" ? r.model.trim() : "";
        if (typeof r.harness !== "string" || r.harness.trim() === "") {
          if (!invalid.includes("fallback_rungs")) invalid.push("fallback_rungs");
          warnings.push(`fallback rung ${index}: harness is required`);
        }
        if (model === "" || HARNESS_DEFAULT_MODEL_PATTERN.test(model)) {
          if (!invalid.includes("fallback_rungs")) invalid.push("fallback_rungs");
          warnings.push(`fallback rung ${index}: the model MUST be pinned explicitly — "use harness X" inherits X's default model, which can silently seat a non-agentic model in a control role`);
        }
      });
    }
  }

  const triggers = Array.isArray(contract.substitution_triggers)
    ? (contract.substitution_triggers as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  for (const trigger of triggers) {
    const upper = trigger.toUpperCase().replace(/[\s-]+/g, "_");
    if (NON_TRIGGER_OPERATOR_SIDE.some((banned) => upper.includes(banned))) {
      invalid.push("substitution_triggers");
      warnings.push(`"${trigger}" is not a failover trigger: provider billing errors are operator-side — HOLD the seat, do not substitute or alarm`);
    } else if (!CANONICAL_FAILOVER_TRIGGERS.includes(upper)) {
      warnings.push(`substitution trigger "${trigger}" is not in the canonical set (${CANONICAL_FAILOVER_TRIGGERS.join(", ")})`);
    }
  }

  if (contract.post_relaunch_model_verify === false) {
    invalid.push("post_relaunch_model_verify");
    warnings.push("post_relaunch_model_verify must be true: model identity drifts on relaunch/reconfig — always re-verify the committed model from the status bar");
  }

  return buildValidationResult(missing, invalid, warnings);
}

/**
 * Validate an exec-team successor contract: what any authorized agent needs to
 * assume a dead EXEC seat — the locked roster, the in-flight worklist, and the
 * canonical hashes — under the constraint that roster mutation belongs solely
 * to the operator / Team-A EXEC (a taking-over EXEC keeps the roster locked
 * and reports; downstream ODINs report up, never negotiate roster laterally).
 */
export function validateSuccessorContract(contract: Record<string, unknown>): ValidationResult {
  const missing = validateRequiredFields(contract, [
    "successor_seat",
    "locked_roster",
    "in_flight_worklist",
    "canonical_hashes",
    "roster_mutation_authority",
    "report_up_chain"
  ]);
  const invalid: string[] = [];
  const warnings: string[] = [];

  if (contract.locked_roster !== undefined &&
      (!Array.isArray(contract.locked_roster) || contract.locked_roster.length === 0)) {
    invalid.push("locked_roster");
    warnings.push("locked_roster must be the non-empty roster the successor carries forward, locked against unilateral change");
  }
  if (contract.in_flight_worklist !== undefined && !Array.isArray(contract.in_flight_worklist)) {
    invalid.push("in_flight_worklist");
  }
  if (contract.canonical_hashes !== undefined) {
    const hashes = asRecord(contract.canonical_hashes);
    if (Object.keys(hashes).length === 0) {
      invalid.push("canonical_hashes");
      warnings.push("canonical_hashes must carry the preserve-rule hashes the successor verifies against");
    }
  }
  const authority = typeof contract.roster_mutation_authority === "string"
    ? contract.roster_mutation_authority.toUpperCase().replace(/[\s-]+/g, "_")
    : undefined;
  if (authority !== undefined && authority !== "OPERATOR" && authority !== "TEAM_A_EXEC") {
    invalid.push("roster_mutation_authority");
    warnings.push("roster mutation belongs solely to the operator or a Team-A EXEC; a successor does not re-staff on its own initiative");
  }
  if (contract.report_up_chain === false) {
    invalid.push("report_up_chain");
    warnings.push("downstream ODINs report up the Team-A EXEC line; lateral roster negotiation is a breach");
  }

  return buildValidationResult(missing, invalid, warnings);
}

/**
 * Validate an [SCP-OUTAGE-HANDOFF] pre-dark receipt: the structured handoff a
 * seat or contingent emits BEFORE going dark on provider-credit exhaustion, so
 * a provider-diverse surviving ODIN can open a bounded exception, cover
 * critical roles from unaffected seats, and revert cleanly at recovery.
 * Field origin: the 2026-06-28 okoa-website outage (~12-minute bounded
 * exception, clean revert, no authority transfer by inertia) — minus its one
 * gap: the operator had to be the message bus. This receipt is that message.
 */
export function validateOutageHandoff(receipt: Record<string, unknown>): ValidationResult {
  const missing = validateRequiredFields(receipt, [
    "receipt_type",
    "affected_provider",
    "affected_slots",
    "surviving_continuity_seat",
    "in_flight_work",
    "critical_roles_needing_cover",
    "expiry_condition",
    "bounded_exception"
  ]);
  const invalid: string[] = [];
  const warnings: string[] = [];

  if (receipt.receipt_type !== undefined && receipt.receipt_type !== "SCP-OUTAGE-HANDOFF") {
    invalid.push("receipt_type");
  }
  if (receipt.affected_slots !== undefined &&
      (!Array.isArray(receipt.affected_slots) || receipt.affected_slots.length === 0)) {
    invalid.push("affected_slots");
    warnings.push("affected_slots must enumerate every seat on the exhausted provider/account so the survivor can partition affected vs unaffected");
  }
  const survivor = asRecord(receipt.surviving_continuity_seat);
  const affectedProvider = typeof receipt.affected_provider === "string" ? receipt.affected_provider.toLowerCase() : undefined;
  const survivorProvider = typeof survivor.provider === "string" ? survivor.provider.toLowerCase() : undefined;
  if (affectedProvider !== undefined && survivorProvider !== undefined && survivorProvider === affectedProvider) {
    invalid.push("surviving_continuity_seat");
    warnings.push("the surviving continuity seat must run on a DIFFERENT provider than the exhausted one — provider diversity is what makes the handoff survivable");
  }
  if (receipt.bounded_exception === false) {
    invalid.push("bounded_exception");
    warnings.push("the reconstitution must be a bounded, ledgered SCP-EXCEPTION that expires at recovery — no authority transfer by inertia");
  }
  if (typeof receipt.expiry_condition === "string" && receipt.expiry_condition.trim() === "") {
    invalid.push("expiry_condition");
  }
  if (receipt.restoration_trigger === undefined) {
    warnings.push("restoration_trigger is recommended: name a REAL owned trigger (account reset detection + timed backstop + operator confirm), not an assumed self-wake");
  }

  return buildValidationResult(missing, invalid, warnings);
}

// ---------------------------------------------------------------------------
// STORY-AMEND-002 / RET-005 — evidence-class enforcement for verdict-class
// payloads. The canonical seven-value enum is defined ONCE in schemas.ts
// (EVIDENCE_CLASSES); this is the validation choke point that requires it.
// ---------------------------------------------------------------------------

const EVIDENCE_CLASS_LABEL = EVIDENCE_CLASSES.join(" | ");

function normalizeArtifactClass(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

// Field spelling alias: the [SCP-FEEDBACK] receipt type names the same artifact
// class as the canonical "feedback_finding".
function resolveArtifactClass(value: unknown): string {
  const normalized = normalizeArtifactClass(value);
  return normalized === "scp_feedback" ? "feedback_finding" : normalized;
}

/** True when artifact_class names a verdict-class payload (QA verdict or
 *  [SCP-FEEDBACK] finding) — the consequential-claim classes RET-005 binds. */
export function isVerdictClassArtifact(artifactClass: unknown): boolean {
  return (VERDICT_CLASS_ARTIFACTS as readonly string[]).includes(resolveArtifactClass(artifactClass));
}

/**
 * Validate evidence-class typing on a receipt payload (RET-005).
 *
 * Verdict-class payloads (artifact_class "qa_verdict" or "feedback_finding")
 * MUST carry evidence_class + source_binding; absence rejects with a named
 * reason citing the missing field and the artifact class. Every other artifact
 * class may omit both fields (full backward compatibility). Whenever
 * evidence_class IS present — on any payload — it must be one of the canonical
 * seven values; illegal values are rejected by name.
 */
export function validateEvidenceClassification(payload: Record<string, unknown>): ValidationResult {
  const missing: string[] = [];
  const invalid: string[] = [];
  const warnings: string[] = [];

  const rawArtifactClass = payload.artifact_class;
  const artifactClass = normalizeArtifactClass(rawArtifactClass);
  if (rawArtifactClass !== undefined && rawArtifactClass !== null && artifactClass === "") {
    invalid.push("artifact_class");
    warnings.push("artifact_class must be a non-empty string naming the payload's artifact class");
  }
  const verdictClass = isVerdictClassArtifact(rawArtifactClass);
  const artifactLabel = artifactClass === "" ? "<undeclared>" : artifactClass;

  // A present evidence_class is always legality-checked, on every artifact class.
  const evidenceClass = payload.evidence_class;
  const hasEvidenceClass = typeof evidenceClass === "string" && evidenceClass.trim() !== "";
  if (evidenceClass !== undefined && evidenceClass !== null && !hasEvidenceClass) {
    invalid.push("evidence_class");
    warnings.push(`evidence_class must be a non-empty string (artifact_class "${artifactLabel}")`);
  } else if (hasEvidenceClass && !(EVIDENCE_CLASSES as readonly string[]).includes(evidenceClass as string)) {
    invalid.push("evidence_class");
    warnings.push(`EVIDENCE_CLASS_INVALID: evidence_class "${String(evidenceClass)}" is not one of the canonical evidence classes (${EVIDENCE_CLASS_LABEL}) — artifact_class "${artifactLabel}"`);
  }

  const sourceBinding = payload.source_binding;
  const hasSourceBinding = typeof sourceBinding === "string" && sourceBinding.trim() !== "";
  if (sourceBinding !== undefined && sourceBinding !== null && !hasSourceBinding) {
    invalid.push("source_binding");
    warnings.push(`source_binding must be a non-empty string binding the claim to its evidence source (artifact_class "${artifactLabel}")`);
  }

  if (verdictClass) {
    if (!hasEvidenceClass) {
      invalid.push("evidence_class");
      warnings.push(`EVIDENCE_CLASS_REQUIRED: verdict-class payload (artifact_class "${artifactLabel}") is missing required field "evidence_class" — consequential claims must declare one of: ${EVIDENCE_CLASS_LABEL}`);
    }
    if (!hasSourceBinding) {
      invalid.push("source_binding");
      warnings.push(`SOURCE_BINDING_REQUIRED: verdict-class payload (artifact_class "${artifactLabel}") is missing required field "source_binding" — an evidence class without a bound source is an unverified claim`);
    }
  } else if (artifactClass === "") {
    warnings.push(`artifact_class is undeclared; treating the payload as non-verdict-class (evidence_class optional). Verdict-class payloads (${VERDICT_CLASS_ARTIFACTS.join(" | ")}) REQUIRE evidence_class + source_binding.`);
  }

  return buildValidationResult(missing, invalid, warnings);
}

// ---------------------------------------------------------------------------
// EPIC-022 — Active QA closure-independence detection.
// ---------------------------------------------------------------------------

const CLOSURE_KINDS = ["SLICE_QA_PASS", "HOLDOUT_ACCEPTED", "MISSION_INTERNAL_VALIDATOR"];

/**
 * Actively verify closure independence — prohibition alone did not prevent the
 * field breach (a TEAM PM asserted QA=QA_PASS while the QA seat never emitted
 * a verdict). Fails closed when a verdict is self-asserted, when the reviewer
 * equals the implementer's lane, when no verdict exists, or when the only PASS
 * evidence is a weak signal (SLICE_QA_PASS) or an advisory one (a harness's
 * internal validator).
 */
export function validateClosureIndependence(claim: Record<string, unknown>): ValidationResult {
  const missing = validateRequiredFields(claim, [
    "task_ref",
    "implementer_lane",
    "closing_authority",
    "verdicts"
  ]);
  const invalid: string[] = [];
  const warnings: string[] = [];

  const implementer = typeof claim.implementer_lane === "string" ? claim.implementer_lane : undefined;
  const closer = typeof claim.closing_authority === "string" ? claim.closing_authority : undefined;
  const verdicts = Array.isArray(claim.verdicts) ? claim.verdicts.map((v) => asRecord(v)) : undefined;

  if (claim.verdicts !== undefined && verdicts === undefined) invalid.push("verdicts");

  if (verdicts !== undefined) {
    if (verdicts.length === 0) {
      invalid.push("verdicts");
      warnings.push("closure with NO verdict: a closure claim requires a real, independent QA emission — a fragmented or silent QA seat is not a pass");
    }

    // EPIC-022 closure doctrine (A/EXEC-PM ruling 2026-07-09T07:15:00Z):
    // closure requires BOTH an independent SLICE_QA_PASS and an independent
    // HOLDOUT_ACCEPTED. Neither verdict is sufficient alone: SLICE_QA_PASS is a
    // weak in-loop signal (sealed holdouts failed 2 of 3 while every slice leg
    // was green — fail-state ledger #13/#14), and HOLDOUT_ACCEPTED is a strong
    // blind story verifier but does NOT replace B/QA's slice-level checks for
    // scope, evidence, lifecycle, branch/gate hygiene, and acceptance criteria.
    let hasIndependentSliceQaPass = false;
    let hasIndependentHoldoutAccepted = false;
    for (const [index, v] of verdicts.entries()) {
      const kind = typeof v.verdict_kind === "string" ? v.verdict_kind : "";
      const emittedBy = typeof v.emitted_by === "string" ? v.emitted_by : "";
      const result = typeof v.result === "string" ? v.result : "";
      // RET-005 HARD GATE (SLICE-AMEND-EVCLASS-DEV-002): every closure verdict
      // is routed through the evidence-classification choke point exactly as
      // submitted. A verdict whose declared artifact_class is verdict-class
      // (qa_verdict | feedback_finding) MUST carry evidence_class +
      // source_binding — a missing field is a NAMED hard rejection (invalid),
      // never an advisory. A present evidence_class is legality-checked on
      // every artifact class, so illegal values stay rejected by name. Verdicts
      // that predate RET-005 (no declared artifact_class) remain valid and keep
      // the named EVIDENCE_CLASS_RECOMMENDED advisory — backward compatibility.
      const classification = validateEvidenceClassification(v);
      if (!classification.valid) {
        invalid.push("verdicts");
        for (const warning of classification.warnings) {
          warnings.push(`verdict ${index}: ${warning}`);
        }
      } else if (v.evidence_class === undefined || v.evidence_class === null) {
        warnings.push(`verdict ${index}: EVIDENCE_CLASS_RECOMMENDED: verdict-class payload (artifact_class "qa_verdict", verdict_kind "${kind || "<missing>"}") carries no evidence_class — validateEvidenceClassification rejects unclassified verdict-class payloads`);
      }
      if (!CLOSURE_KINDS.includes(kind)) {
        invalid.push("verdicts");
        warnings.push(`verdict ${index}: verdict_kind must be one of ${CLOSURE_KINDS.join(" | ")} — the vocabulary deliberately separates slice-QA-pass from holdout-accepted`);
        continue;
      }
      if (emittedBy !== "" && implementer !== undefined && emittedBy === implementer) {
        invalid.push("verdicts");
        warnings.push(`verdict ${index}: emitted by the implementer's own lane (${emittedBy}) — the same assignment must not QA its own work`);
        continue;
      }
      if (emittedBy !== "" && closer !== undefined && emittedBy === closer) {
        invalid.push("verdicts");
        warnings.push(`verdict ${index}: SELF-ASSERTED by the closing authority (${emittedBy}) — a PM/EXEC may not assert the QA verdict for its own pod's work`);
        continue;
      }
      // Track each independent verdict kind. "Independent" = emittedBy is set,
      // not the implementer, not the closer (already checked above).
      if (result === "PASS" && emittedBy !== "") {
        if (kind === "SLICE_QA_PASS") hasIndependentSliceQaPass = true;
        if (kind === "HOLDOUT_ACCEPTED") hasIndependentHoldoutAccepted = true;
      }
      if (kind === "MISSION_INTERNAL_VALIDATOR") {
        warnings.push(`verdict ${index}: a harness-internal (Mission) validator is ADVISORY, not closure — independently contracted QA is not interchangeable with a nested validator`);
      }
    }

    const closureEligible = hasIndependentSliceQaPass && hasIndependentHoldoutAccepted;
    if (verdicts.length > 0 && !closureEligible && !invalid.includes("verdicts")) {
      invalid.push("verdicts");
      const kinds = verdicts.map((v) => v.verdict_kind).join(", ");
      if (!hasIndependentSliceQaPass && hasIndependentHoldoutAccepted) {
        warnings.push(`not closure-eligible (${kinds}): a sealed HOLDOUT_ACCEPTED is a strong blind story verifier but does NOT replace B/QA's slice-level checks (scope, evidence, lifecycle, branch/gate hygiene, acceptance criteria) — closure requires BOTH an independent SLICE_QA_PASS and an independent HOLDOUT_ACCEPTED; without the slice-QA pass the state is QA_INCOMPLETE (B/QA PENDING)`);
      } else if (hasIndependentSliceQaPass && !hasIndependentHoldoutAccepted) {
        warnings.push(`not closure-eligible (${kinds}): SLICE_QA_PASS is a weak in-loop signal (field evidence: every slice leg green while sealed holdouts failed 2 of 3) and internal validators are advisory — closure requires BOTH an independent SLICE_QA_PASS and an independent HOLDOUT_ACCEPTED; without the holdout the state is DEV_COMPLETE_QA_PENDING (HOLDOUT PENDING)`);
      } else {
        warnings.push(`not closure-eligible (${kinds}): closure requires BOTH an independent SLICE_QA_PASS and an independent HOLDOUT_ACCEPTED — neither verdict is sufficient alone; the state is DEV_COMPLETE_QA_PENDING or QA_INCOMPLETE as applicable`);
      }
    }
  }

  return buildValidationResult(missing, invalid, warnings);
}

// ---------------------------------------------------------------------------
// EPIC-023 — Exec-gated commit mode (commit_gate: exec).
// ---------------------------------------------------------------------------

/**
 * Validate an exec-gated commit record: STAGED_READY -> EXEC verify ->
 * COMMIT_AUTHORIZED (EXEC-issued token) -> DEV commits -> EXEC re-verify.
 * A PM cannot authorize its own pod's commit; a self-issued or non-EXEC token
 * is rejected; a landed commit without EXEC re-verification is not closure-eligible.
 */
export function validateCommitGate(record: Record<string, unknown>): ValidationResult {
  const missing = validateRequiredFields(record, [
    "task_ref",
    "pod_pm_lane",
    "implementer_lane",
    "staged_ready",
    "commit_authorization"
  ]);
  const invalid: string[] = [];
  const warnings: string[] = [];

  if (record.staged_ready === false) {
    invalid.push("staged_ready");
    warnings.push("the pod must reach STAGED-READY (staged pathspec + independent QA) before any authorization is sought");
  }

  const auth = record.commit_authorization !== undefined ? asRecord(record.commit_authorization) : undefined;
  if (auth !== undefined) {
    const token = typeof auth.token === "string" ? auth.token.trim() : "";
    const issuedBy = typeof auth.issued_by === "string" ? auth.issued_by : "";
    const podPm = typeof record.pod_pm_lane === "string" ? record.pod_pm_lane : undefined;
    const implementer = typeof record.implementer_lane === "string" ? record.implementer_lane : undefined;

    if (token === "") {
      invalid.push("commit_authorization");
      warnings.push("a commit without a valid EXEC-issued authorization token is rejected under commit_gate: exec");
    }
    if (issuedBy === "" || !/EXEC/i.test(issuedBy)) {
      invalid.push("commit_authorization");
      warnings.push(`authorization token issued_by "${issuedBy || "<missing>"}" is not an EXEC-layer seat — only the executive office authorizes exec-gated commits`);
    }
    if (podPm !== undefined && issuedBy !== "" && issuedBy === podPm) {
      invalid.push("commit_authorization");
      warnings.push("SELF-ISSUED token: a PM cannot authorize its own pod's commit — that is the exact pattern commit_gate: exec exists to prevent");
    }
    if (implementer !== undefined && issuedBy !== "" && issuedBy === implementer) {
      invalid.push("commit_authorization");
      warnings.push("the implementer cannot issue its own commit authorization");
    }
    if (auth.verified_ground_truth !== true) {
      invalid.push("commit_authorization");
      warnings.push("the token must be issued AFTER the EXEC independently verified ground truth (staged set == pathspec, blob hashes, parent SHA)");
    }
  }

  if (record.committed === true && record.exec_reverified !== true) {
    invalid.push("exec_reverified");
    warnings.push("the commit landed but the EXEC has not re-verified it — the sequence ends at EXEC_REVERIFIED, not COMMITTED");
  }

  return buildValidationResult(missing, invalid, warnings);
}

// ---------------------------------------------------------------------------
// EPIC-028 — Harness control recipes (arrow-free, version-pinned).
// ---------------------------------------------------------------------------

const NAV_TOKEN_PATTERN = /\b(up|down|left|right|home|end|page[\s_-]?(up|down))\b|arrow|\x1b\[[ABCD]|\\e\[[ABCD]|\\x1b\[[ABCD]|\b(j|k|h|l)\b\s+(?:as\s+(?:a\s+)?(?:standalone\s+)?)?nav/i;
// `control_recipe` / `controlRecipe` carry the full inline control recipe from
// the harness-control-matrix entries; they are checked for arrow/nav tokens
// alongside the per-action recipe fields.
// STORY-GOVTRUTH-R4: the former in-code HARNESS_CONTROL_RECIPES catalog is
// REMOVED. protocol/resources/harness-control-matrix.yaml is the sole source
// of harness recipe data; getHarnessProbeMatrix derives every recipe field
// from that resource at runtime (see loadHarnessControlEntries).
const RECIPE_FIELDS = ["open_menu_recipe", "model_set_recipe", "effort_set_recipe", "quit_verb", "relaunch_recipe", "control_recipe", "controlRecipe"];

/**
 * Validate a harness control-matrix entry: recipes must be arrow-free (arrow
 * and nav-key tokens are unusable through cmux send-key and raw escapes cancel
 * menus / leak text) and pinned to the exact harness version they were
 * verified against.
 */
export function validateControlRecipe(entry: Record<string, unknown>): ValidationResult {
  const missing = validateRequiredFields(entry, ["harness_id", "version_pin", "quit_verb"]);
  const invalid: string[] = [];
  const warnings: string[] = [];

  if (typeof entry.version_pin === "string" && entry.version_pin.trim() === "") {
    invalid.push("version_pin");
  }
  if (typeof entry.version_pin === "string" && /^(latest|\*|any)$/i.test(entry.version_pin.trim())) {
    invalid.push("version_pin");
    warnings.push("version_pin must be an exact verified version — recipes drift across harness releases");
  }
  for (const field of RECIPE_FIELDS) {
    const value = entry[field];
    if (typeof value !== "string" || value.trim() === "") continue;
    if (NAV_TOKEN_PATTERN.test(value)) {
      invalid.push(field);
      warnings.push(`${field} contains an arrow/nav-key token or raw escape sequence — arrow keys are unusable through the multiplexer (invalid_params) and raw escapes cancel menus or leak literal text; use type-ahead, mnemonic keys, or launch flags`);
    }
  }
  if (entry.quit_verb !== undefined && typeof entry.quit_verb === "string" && /ctrl\+?c/i.test(entry.quit_verb)) {
    invalid.push("quit_verb");
    warnings.push("ctrl+c does not quit these harnesses — use the in-app quit verb");
  }
  return buildValidationResult(missing, invalid, warnings);
}

/**
 * EPIC-028 holdout-facing validator surface: validate a harness control recipe
 * submitted in the holdout's field shape ({ recipe, harness_version }). Applies
 * the same arrow/nav-token-free + version-pinned rules as validateControlRecipe,
 * without requiring the full matrix entry (e.g. quit_verb). `harness_version` is
 * the holdout/validator alias for the matrix's canonical `version_pin` field.
 */
export function validateHarnessControlRecipe(input: {
  recipe?: unknown;
  harness_version?: unknown;
  version_pin?: unknown;
}): ValidationResult {
  const missing: string[] = [];
  const invalid: string[] = [];
  const warnings: string[] = [];

  const recipe = typeof input.recipe === "string" ? input.recipe : "";
  const versionPin = (typeof input.harness_version === "string" && input.harness_version.trim() !== "")
    ? input.harness_version.trim()
    : (typeof input.version_pin === "string" ? input.version_pin.trim() : "");

  if (recipe.trim() === "") missing.push("recipe");
  if (versionPin === "") {
    missing.push("harness_version");
  } else if (/^(latest|\*|any)$/i.test(versionPin)) {
    invalid.push("harness_version");
    warnings.push("harness_version must be an exact verified version — recipes drift across harness releases");
  }
  if (recipe.trim() !== "" && NAV_TOKEN_PATTERN.test(recipe)) {
    invalid.push("recipe");
    warnings.push("recipe contains an arrow/nav-key token or raw escape sequence — arrow keys are unusable through the multiplexer (invalid_params) and raw escapes cancel menus or leak literal text; use type-ahead, mnemonic keys, or launch flags");
  }
  return buildValidationResult(missing, invalid, warnings);
}

/**
 * EPIC-028 delivery-verification enforcement. Alt-screen TUIs (e.g. Crush) have
 * no scrollback, so marker-grep is structurally unreliable there — behavioral
 * verification (screen advanced vs pre-send snapshot AND message head absent
 * from the input bar) is MANDATORY. Scrollback-capable surfaces may use deep
 * scrollback grep, timed re-read, or behavioral proof. `marker_grep_only` is
 * the undisciplined anti-pattern and is rejected for every surface.
 */
export function validateDeliveryVerification(input: {
  surface_type?: unknown;
  method?: unknown;
}): ValidationResult {
  const missing = validateRequiredFields(input as Record<string, unknown>, ["surface_type", "method"]);
  const invalid: string[] = [];
  const warnings: string[] = [];

  const surfaceType = typeof input.surface_type === "string"
    ? input.surface_type.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  const method = typeof input.method === "string"
    ? input.method.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";

  if (surfaceType !== "" && method !== "") {
    const recognizedTiers = ["scrollback_grep", "timed_reread", "behavioral"];
    if (surfaceType === "alt_screen") {
      if (method !== "behavioral") {
        invalid.push("method");
        warnings.push("alt-screen TUIs have no scrollback — marker-grep/scrollback-grep is structurally unreliable; behavioral delivery verification (screen advanced vs pre-send AND message head absent from the input bar) is MANDATORY");
      }
    } else if (!recognizedTiers.includes(method)) {
      invalid.push("method");
      warnings.push(`"${input.method}" is not a recognized delivery-verification tier — use scrollback_grep (deep), timed_reread, or behavioral`);
    }
  }
  return buildValidationResult(missing, invalid, warnings);
}

// ---------------------------------------------------------------------------
// EPIC-026 — Authority chain + blocked-pod rollover.
// ---------------------------------------------------------------------------

/**
 * Validate a staffing/roster action against the standing authority chain:
 * workers never re-staff themselves or change their own bindings; roster
 * mutation belongs to the operator / Team-A EXEC; lateral roster negotiation
 * is a breach — the accepted path is report-up.
 */
export function validateAuthorityAction(action: Record<string, unknown>): ValidationResult {
  const missing = validateRequiredFields(action, ["actor", "action_type", "authorized_by"]);
  const invalid: string[] = [];
  const warnings: string[] = [];

  const actor = typeof action.actor === "string" ? action.actor : "";
  const actionType = typeof action.action_type === "string"
    ? action.action_type.toUpperCase().replace(/[\s-]+/g, "_")
    : "";
  const authorizedBy = typeof action.authorized_by === "string" ? action.authorized_by : "";
  const target = typeof action.target_slot === "string" ? action.target_slot : undefined;

  // `restaff_dead_seat` and `restaff_on_own_initiative` are the field spellings
  // for the takeover-initiated re-staff incident (RFC-v2.3 §4/§5); normalize them
  // into the roster-mutation class so the authority check actually runs.
  const rosterMutations = ["RESTAFF", "RESTAFF_DEAD_SEAT", "RESTAFF_ON_OWN_INITIATIVE", "SELF_RESTAFF", "SPAWN", "SPAWN_SIBLING", "CHANGE_MODEL", "CHANGE_HARNESS", "ROSTER_MUTATION", "RENAME_SLOT", "CLOSE_SLOT"];
  const isRosterMutation = rosterMutations.includes(actionType);
  const authorizedIsExec = /^(OPERATOR|A\/)/i.test(authorizedBy) || /TEAM[\s_-]?A[\s_-]?EXEC/i.test(authorizedBy);
  const actorIsExec = /^A\//i.test(actor);

  if (isRosterMutation) {
    // A roster mutation is valid only with an INDEPENDENT authorizer — the
    // operator or a Team-A EXEC other than the actor. Self-authorization is a
    // breach for EVERY role, including a taking-over EXEC (A/EXEC-ODIN): the
    // doctrine keeps the roster LOCKED on a takeover and requires report-up,
    // never a re-staff of a dead seat on the taker-over's own initiative.
    if (authorizedBy === actor) {
      invalid.push("authorized_by");
      warnings.push(
        actorIsExec
          ? `${actor} self-authorized a roster mutation (${actionType}): a taking-over EXEC inherits the roster LOCKED and reports up — it does not re-staff a dead seat on its own initiative`
          : `${actor} attempted a self-authorized ${actionType}: a worker never re-staffs itself, changes its own harness/model, or spins a sibling`
      );
    } else if (!authorizedIsExec) {
      invalid.push("authorized_by");
      warnings.push(`roster mutation authorized by "${authorizedBy}": roster mutation belongs solely to the operator or a Team-A EXEC`);
    }
  }
  if (actionType === "LATERAL_ROSTER_NEGOTIATION" || action.lateral === true) {
    invalid.push("action_type");
    warnings.push("lateral roster negotiation is a breach — downstream ODINs report UP the Team-A EXEC line");
  }
  return buildValidationResult(missing, invalid, warnings);
}

const ROLLOVER_LETTERS = ["B", "C", "D", "E", "F"];

export interface RolloverDecision {
  decision: "SPIN_NEXT_TEAM" | "ESCALATE_OPERATOR";
  next_team_letter: string | null;
  reasons: string[];
}

/**
 * Decide a blocked-pod rollover: pause the blocked pod, spin the next team
 * letter, STOP at F (escalate rather than fan out further). A rollover framed
 * as a re-staff of the blocked seat, or one that drops the blocked pod's
 * state, is rejected via the validation-style reasons.
 */
export function evaluateBlockedPodRollover(input: {
  lettersInUse: string[];
  blockedPodPaused: boolean;
  blockedStatePreserved: boolean;
  framedAsRestaff?: boolean;
}): RolloverDecision {
  const reasons: string[] = [];
  if (input.framedAsRestaff === true) {
    reasons.push("REJECTED: rollover spawns a NEW team; it is never a re-staffing of the blocked seat");
    return { decision: "ESCALATE_OPERATOR", next_team_letter: null, reasons };
  }
  if (!input.blockedPodPaused) {
    reasons.push("pause the blocked pod BEFORE spinning a rollover team");
  }
  if (!input.blockedStatePreserved) {
    reasons.push("REJECTED: the blocked pod's state must be preserved for resume");
    return { decision: "ESCALATE_OPERATOR", next_team_letter: null, reasons };
  }
  const used = new Set(input.lettersInUse.map((letter) => letter.toUpperCase()));
  const next = ROLLOVER_LETTERS.find((letter) => !used.has(letter));
  if (next === undefined) {
    reasons.push("letter progression exhausted at Team F — escalate to the operator; no fan-out beyond F");
    return { decision: "ESCALATE_OPERATOR", next_team_letter: null, reasons };
  }
  reasons.push(`spin Team ${next} as a NEW team (own PM/DEV/QA on authorized bindings); blocked pod stays paused for resume`);
  return { decision: "SPIN_NEXT_TEAM", next_team_letter: next, reasons };
}

// ---------------------------------------------------------------------------
// EPIC-031 — Slice & spec health sentinels (heuristics that SURFACE, never block).
// ---------------------------------------------------------------------------

export interface SliceHealthSignal {
  sentinel_id: "OVERSIZED_SLICE" | "QA_WINDOW_TOO_SMALL" | "SPEC_DEFECT";
  slice_ref: string;
  classification: string;
  recommended_response: string;
  details: string;
}

/**
 * Evaluate the three slice-health sentinels over observed run events. Pure
 * heuristics: they surface signals to the PM and never auto-block or retry.
 */
export function evaluateSliceHealth(input: {
  dnfEvents?: Array<{ slice_ref: string; agent: string }>;
  prohibitedPathWrites?: Array<{ path: string; agent: string }>;
  qaReview?: { slice_ref: string; reviewed_file_count: number; flat_timeout_seconds?: number; sized_for_file_count?: number };
}): SliceHealthSignal[] {
  const signals: SliceHealthSignal[] = [];

  const dnfBySlice = new Map<string, Set<string>>();
  for (const event of input.dnfEvents ?? []) {
    const agents = dnfBySlice.get(event.slice_ref) ?? new Set<string>();
    agents.add(event.agent);
    dnfBySlice.set(event.slice_ref, agents);
  }
  for (const [sliceRef, agents] of dnfBySlice) {
    if (agents.size >= 2) {
      signals.push({
        sentinel_id: "OVERSIZED_SLICE",
        slice_ref: sliceRef,
        classification: "the slice is too big — not agent-weak",
        recommended_response: "PM splits the slice; do not auto-retry the same scope",
        details: `same slice DNF'd ${agents.size} independent agents (${[...agents].join(", ")})`
      });
    }
  }

  const writesByPath = new Map<string, Set<string>>();
  for (const write of input.prohibitedPathWrites ?? []) {
    const agents = writesByPath.get(write.path) ?? new Set<string>();
    agents.add(write.agent);
    writesByPath.set(write.path, agents);
  }
  for (const [path, agents] of writesByPath) {
    if (agents.size >= 2) {
      signals.push({
        sentinel_id: "SPEC_DEFECT",
        slice_ref: path,
        classification: "unsatisfiable acceptance criteria until proven otherwise — the slice likely froze the artifact the task must change",
        recommended_response: "SURFACE_TO_PM for spec review/amendment before any retry",
        details: `${agents.size} independent agents converged on the same WRITE-PROHIBITED path (${[...agents].join(", ")})`
      });
    }
  }

  const qa = input.qaReview;
  if (qa !== undefined && qa.flat_timeout_seconds !== undefined) {
    const basis = qa.sized_for_file_count ?? 1;
    if (qa.reviewed_file_count >= basis * 3) {
      signals.push({
        sentinel_id: "QA_WINDOW_TOO_SMALL",
        slice_ref: qa.slice_ref,
        classification: "the window is wrong, not the reviewer",
        recommended_response: "scale the window (base_seconds + per_file_seconds, capped at max_seconds), then re-dispatch",
        details: `flat ${qa.flat_timeout_seconds}s window sized for ~${basis} files applied to a ${qa.reviewed_file_count}-file review`
      });
    }
  }

  return signals;
}

/** EPIC-031 per-sentinel signal in the holdout's classification/action shape. */
export interface SentinelSignal {
  classification: "OVERSIZED_SLICE" | "QA_WINDOW_TOO_SMALL" | "SPEC_DEFECT";
  action: "SURFACE_TO_PM";
  slice_ref: string;
  details: string;
  recommended_response: string;
}

/**
 * EPIC-031 per-sentinel façade (holdout input shape { slice_ref, dnf_agents }).
 * Surfaces the OVERSIZED_SLICE sentinel when the same slice DNFs two or more
 * INDEPENDENT agents; returns null for a single-agent DNF (that is agent-weak,
 * not this sentinel). PM-bound signal: never auto-retries the same scope.
 */
export function evaluateOversizedSliceSentinel(input: {
  slice_ref?: unknown;
  dnf_agents?: unknown;
}): SentinelSignal | null {
  const sliceRef = typeof input.slice_ref === "string" ? input.slice_ref : "";
  const agents = Array.isArray(input.dnf_agents)
    ? input.dnf_agents.filter((agent): agent is string => typeof agent === "string" && agent.trim() !== "")
    : [];
  if (new Set(agents).size < 2) return null;
  const signal = evaluateSliceHealth({
    dnfEvents: agents.map((agent) => ({ slice_ref: sliceRef, agent }))
  }).find((s) => s.sentinel_id === "OVERSIZED_SLICE");
  if (!signal) return null;
  return {
    classification: "OVERSIZED_SLICE",
    action: "SURFACE_TO_PM",
    slice_ref: signal.slice_ref,
    details: signal.details,
    recommended_response: signal.recommended_response
  };
}

/**
 * EPIC-031 per-sentinel façade (holdout input shape
 * { timeout_config: { base_seconds, per_file_seconds, max_seconds }, review_file_count }).
 * Fires QA_WINDOW_TOO_SMALL when a FLAT window (per_file_seconds <= 0) is applied
 * to a review materially larger than the sizing basis; returns null once the
 * window scales with review size (per_file_seconds > 0). max_seconds caps the
 * scaled window but does not itself trigger the sentinel.
 */
export function evaluateQaTimeoutSentinel(input: {
  timeout_config?: unknown;
  review_file_count?: unknown;
}): SentinelSignal | null {
  const cfg = input.timeout_config && typeof input.timeout_config === "object" && !Array.isArray(input.timeout_config)
    ? (input.timeout_config as Record<string, unknown>)
    : {};
  const perFile = typeof cfg.per_file_seconds === "number" ? cfg.per_file_seconds : 0;
  const base = typeof cfg.base_seconds === "number" ? cfg.base_seconds : 0;
  const count = typeof input.review_file_count === "number" ? input.review_file_count : 0;
  if (perFile > 0) return null;
  const signal = evaluateSliceHealth({
    qaReview: { slice_ref: "qa-review", reviewed_file_count: count, flat_timeout_seconds: base, sized_for_file_count: 1 }
  }).find((s) => s.sentinel_id === "QA_WINDOW_TOO_SMALL");
  if (!signal) return null;
  return {
    classification: "QA_WINDOW_TOO_SMALL",
    action: "SURFACE_TO_PM",
    slice_ref: signal.slice_ref,
    details: signal.details,
    recommended_response: signal.recommended_response
  };
}

/**
 * EPIC-031 per-sentinel façade (holdout input shape { prohibited_path, convergent_agents }).
 * Fires SPEC_DEFECT when two or more INDEPENDENT agents converge on writing the
 * SAME WRITE-PROHIBITED path — unsatisfiable acceptance criteria until proven
 * otherwise; returns null for a single agent (that is a scope violation, not
 * this sentinel). PM-bound signal: the PM investigates, the sentinel never auto-fails.
 */
export function evaluateSpecDefectSentinel(input: {
  prohibited_path?: unknown;
  convergent_agents?: unknown;
}): SentinelSignal | null {
  const path = typeof input.prohibited_path === "string" ? input.prohibited_path : "";
  const agents = Array.isArray(input.convergent_agents)
    ? input.convergent_agents.filter((agent): agent is string => typeof agent === "string" && agent.trim() !== "")
    : [];
  if (new Set(agents).size < 2) return null;
  const signal = evaluateSliceHealth({
    prohibitedPathWrites: agents.map((agent) => ({ path, agent }))
  }).find((s) => s.sentinel_id === "SPEC_DEFECT");
  if (!signal) return null;
  return {
    classification: "SPEC_DEFECT",
    action: "SURFACE_TO_PM",
    slice_ref: signal.slice_ref,
    details: signal.details,
    recommended_response: signal.recommended_response
  };
}

// ---------------------------------------------------------------------------
// EPIC-025 — Pod bring-up & ground-truth safety. Field origin: RFC-v2.3 sweep
// §3.2 — launching a pod in the target repo fired that repo's SessionStart
// hooks AFTER the pre-launch scan, so the enumerated expected-state diverged
// and the pod (correctly) halted on a false positive.
// ---------------------------------------------------------------------------

/**
 * Validate a pod bring-up plan: ground truth is captured AFTER the pod boots
 * in the target repo (SessionStart hooks mutate it), and preservation is
 * count-agnostic — preserve ALL non-target dirty/untracked whatever the count;
 * the ONLY stop trigger is a wrong TARGET artifact. Enumerated expected-state
 * framing is rejected because any hook-side mutation turns it into a false halt.
 */
export function validateBringUpPlan(plan: Record<string, unknown>): ValidationResult {
  const missing = validateRequiredFields(plan, ["ground_truth_capture", "preserve_framing", "stop_triggers"]);
  const invalid: string[] = [];
  const warnings: string[] = [];

  const capture = typeof plan.ground_truth_capture === "string"
    ? plan.ground_truth_capture.toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (capture !== "" && capture !== "after_boot") {
    invalid.push("ground_truth_capture");
    warnings.push("capture ground truth AFTER the pod boots in the target repo — SessionStart hooks mutate the repo, so a pre-boot scan diverges and forces a false halt");
  }

  const framing = typeof plan.preserve_framing === "string"
    ? plan.preserve_framing.toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (framing !== "" && framing !== "count_agnostic") {
    invalid.push("preserve_framing");
    warnings.push("use count-agnostic preserve framing (preserve ALL non-target dirty/untracked, whatever the count); enumerated expected-state breaks the moment a hook archives one more file");
  }

  const triggers = Array.isArray(plan.stop_triggers)
    ? (plan.stop_triggers as unknown[]).filter((v): v is string => typeof v === "string") : [];
  for (const trigger of triggers) {
    const upper = trigger.toUpperCase().replace(/[\s-]+/g, "_");
    if (upper !== "TARGET_ARTIFACT_WRONG") {
      invalid.push("stop_triggers");
      warnings.push(`"${trigger}" is not a valid stop trigger — the ONLY stop condition is a wrong TARGET artifact; non-target mutations are preserved, never halted on`);
    }
  }
  if (triggers.length === 0 && plan.stop_triggers !== undefined) {
    warnings.push("declare TARGET_ARTIFACT_WRONG as the stop trigger");
  }

  return buildValidationResult(missing, invalid, warnings);
}

// ---------------------------------------------------------------------------
// STORY-GOVDISP-005 — registry-mode branches for the prose-receipt validators
// (GD-FP-013: never two independently-editable authorities for one fact).
//
// Behind the compatibility flag ODIN_GOVDISP_REGISTRY_MCP (ON by default as of
// 0.6.0 — Amendment 46: unset = active; a non-truthy value such as 0/false/off
// is the explicit opt-out), each prose-receipt validator accepts a TYPED
// REGISTRY EVENT REFERENCE as
// authority: a payload may carry registry_authority: { scope, event_id } in
// place of (or alongside) prose fields. The validator resolves the referenced
// event through the injected store (the GovdispRegistryStoreLike seam
// precedent below), verifies the event exists and matches the artifact class,
// and treats the PROSE as transport/history. A payload carrying a reference
// that FAILS to resolve is rejected by name (registry_authority_unresolved) —
// never a silent fall back to prose — and a prose-only payload still
// validates, with the result carrying authority: "prose_transport" instead of
// authority: "registry" (an advisory distinction, NOT a rejection; prose
// retirement is Wave-4 scope). Under the explicit opt-out every validator in
// this module is byte-compatible with the prose-authority baseline: the flag
// is read first and the baseline result object is returned untouched (no added
// keys, no added warnings).
// ---------------------------------------------------------------------------

/**
 * Env flag gating the registry-mode branches. This is the SAME flag as the
 * MCP registry compatibility surface and the odin-watch FINDING_OPENED
 * emission; as of Amendment 46 the UNIFIED reader lives here
 * (readGovdispRegistryMode) and every consumer delegates to it, so the
 * default inverts in exactly one place.
 */
export const GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR = "ODIN_GOVDISP_REGISTRY_MCP";

const GOVDISP_REGISTRY_AUTHORITY_TRUTHY = new Set(["1", "true", "yes", "on"]);

/** The resolved registry-mode flag state. */
export type GovdispRegistryModeConfig = {
  enabled: boolean;
  source: "env" | "default_on";
};

/**
 * Read the registry-mode flag — THE unified reader every consumer delegates
 * to (the MCP compatibility surface, these registry-mode validator branches,
 * and the odin-watch FINDING_OPENED emission). ACTIVE BY DEFAULT as of 0.6.0
 * (Amendment 46, operator order): an unset or empty value resolves ON with
 * source "default_on". An explicit truthy value (1/true/yes/on, case- and
 * whitespace-insensitive) resolves ON; any other non-empty value
 * (0/false/off/no/...) is the explicit opt-out and resolves OFF — the
 * baseline-compatibility escape hatch. A mistaken "0"/"false" can never
 * half-activate a registry-mode branch; it fully disables it.
 */
export function readGovdispRegistryMode(env: NodeJS.ProcessEnv = process.env): GovdispRegistryModeConfig {
  const raw = env[GOVDISP_REGISTRY_AUTHORITY_FLAG_ENV_VAR];
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (normalized.length === 0) {
    return { enabled: true, source: "default_on" };
  }
  return { enabled: GOVDISP_REGISTRY_AUTHORITY_TRUTHY.has(normalized), source: "env" };
}

/**
 * Boolean form of the unified read (Amendment 46): registry mode is ON unless
 * an explicit non-truthy opt-out value is set.
 */
export function isGovdispRegistryAuthorityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readGovdispRegistryMode(env).enabled;
}

/** Named-rejection code: a registry authority reference failed to resolve. */
export const REGISTRY_AUTHORITY_UNRESOLVED_CODE = "registry_authority_unresolved" as const;

/**
 * The registry event classes accepted as receipt authority. A receipt's
 * registry authority is a TERMINAL-class event: terminal events are the
 * registry's outcome records and the only class that persists content hashes
 * (a proof-by-hash binding to the artifact body — the registry never stores
 * raw proof bodies). ATTEMPT, FINDING, BREAK_GLASS, BUDGET, and AUDIT events
 * record governance machinery, not artifact authority, so they never resolve
 * a receipt authority reference.
 */
export const REGISTRY_RECEIPT_AUTHORITY_EVENT_CLASSES = ["TERMINAL"] as const;

/** Injected seams for the registry-mode branches (flag-gated). */
export interface RegistryAuthorityOptions {
  /**
   * Injected registry store (the GovdispRegistryStoreLike seam), bound by the
   * caller. Flag on with a reference present but no usable store fails closed:
   * the reference is rejected by name (registry_authority_unresolved, detail
   * citing the store_unavailable fault).
   */
  store?: GovdispRegistryStoreLike;
  /** Registry base path override; defaults to the store's own default base. */
  base?: string;
  /** Env source for the compatibility flag; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/** The adjudicated authority source carried by a mode-ON result. */
export type RegistryAuthorityInfo =
  | { status: "resolved"; scope: string; event_id: string; event_class: string }
  | { status: "unresolved"; code: typeof REGISTRY_AUTHORITY_UNRESOLVED_CODE; detail: string; scope?: string; event_id?: string };

/**
 * A validator result under the registry-mode branches. With the flag OFF the
 * result is the baseline ValidationResult with NO added keys
 * (byte-compatible). With the flag ON the result additionally carries
 * authority — "registry" when a resolved registry event is the single
 * authority, "prose_transport" when no reference was supplied and the prose
 * itself was validated (advisory; NOT a rejection) — and, for a reference
 * that failed to resolve, a structured registry_authority record naming
 * registry_authority_unresolved.
 */
export type RegistryModeValidationResult = ValidationResult & {
  authority?: "registry" | "prose_transport";
  registry_authority?: RegistryAuthorityInfo;
};

type RegistryAuthorityResolution =
  | { ok: true; scope: string; eventId: string; event: GovdispEvent }
  | { ok: false; scope?: string; eventId?: string; detail: string };

/**
 * Resolve a payload's registry authority reference through the injected store.
 * Pure resolution plus artifact-class match; the event's own append-time
 * validation was the registry's choke point and is reused, never re-run.
 */
function resolveRegistryAuthority(
  artifactLabel: string,
  reference: unknown,
  options: RegistryAuthorityOptions
): RegistryAuthorityResolution {
  if (reference === null || typeof reference !== "object" || Array.isArray(reference)) {
    return { ok: false, detail: `registry_authority must be an object { scope, event_id } naming the registry event that carries authority for this ${artifactLabel}` };
  }
  const record = asRecord(reference);
  const scope = typeof record.scope === "string" && record.scope.trim() !== "" ? record.scope : undefined;
  const eventId = typeof record.event_id === "string" && record.event_id.trim() !== "" ? record.event_id : undefined;
  if (scope === undefined) {
    return { ok: false, detail: "registry_authority.scope must be a non-empty string naming the registry scope" };
  }
  if (eventId === undefined) {
    return { ok: false, scope, detail: "registry_authority.event_id must be a non-empty string naming the authority event" };
  }
  // Deliberate cast (the odin-watch writers seam precedent): a missing store
  // flows into the fail-closed store_unavailable rejection instead of throwing.
  const store = options.store as GovdispRegistryStoreLike;
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) {
    return { ok: false, scope, eventId, detail: `${storeFault.code}: ${storeFault.detail}` };
  }
  const queried = store.queryRegistryEvents(scope, {}, options.base);
  if (!queried.ok) {
    const codes = queried.rejections.map((rejection) => `${rejection.code}(${rejection.field})`).join(", ");
    return { ok: false, scope, eventId, detail: `registry query for scope "${scope}" failed closed: ${codes}` };
  }
  const event = queried.events.find((candidate) => candidate.event_id === eventId);
  if (event === undefined) {
    return { ok: false, scope, eventId, detail: `no registry event with event_id "${eventId}" exists in scope "${scope}"` };
  }
  if (!(REGISTRY_RECEIPT_AUTHORITY_EVENT_CLASSES as readonly string[]).includes(event.event_class)) {
    return { ok: false, scope, eventId, detail: `registry event "${eventId}" is class ${event.event_class}, which is not a receipt-authority class for a ${artifactLabel} (accepted: ${REGISTRY_RECEIPT_AUTHORITY_EVENT_CLASSES.join(" | ")}) — the event exists but does not match the artifact class` };
  }
  return { ok: true, scope, eventId, event };
}

/**
 * The registry-mode branch shared by the five prose-receipt validators.
 * Returns null when the branch does not apply (flag OFF, or flag ON with no
 * registry_authority on the payload) so the caller runs the baseline prose
 * path. When the branch applies, the registry alone adjudicates: a resolved
 * reference is the single authority (prose fields are transport/history and
 * are NOT re-validated as authority — GD-FP-013), and an unresolvable
 * reference is rejected by name (registry_authority_unresolved) with no
 * silent prose fallback.
 */
function adjudicateRegistryAuthority(
  artifactLabel: string,
  payload: Record<string, unknown>,
  options: RegistryAuthorityOptions
): RegistryModeValidationResult | null {
  if (!isGovdispRegistryAuthorityEnabled(options.env)) return null;
  const reference = payload.registry_authority;
  if (reference === undefined || reference === null) return null;

  const resolution = resolveRegistryAuthority(artifactLabel, reference, options);
  if (!resolution.ok) {
    return {
      valid: false,
      missing: [],
      invalid: ["registry_authority"],
      warnings: [
        `${REGISTRY_AUTHORITY_UNRESOLVED_CODE}: ${resolution.detail} — a registry authority reference that fails to resolve is rejected by name; the prose fields are never silently promoted to authority (GD-FP-013)`
      ],
      registry_authority: {
        status: "unresolved",
        code: REGISTRY_AUTHORITY_UNRESOLVED_CODE,
        detail: resolution.detail,
        ...(resolution.scope !== undefined ? { scope: resolution.scope } : {}),
        ...(resolution.eventId !== undefined ? { event_id: resolution.eventId } : {})
      }
    };
  }

  const { scope, eventId, event } = resolution;
  return {
    valid: true,
    missing: [],
    invalid: [],
    warnings: [
      `registry authority resolved: ${event.event_class} event "${eventId}" in scope "${scope}" is the single authority for this ${artifactLabel} (GD-FP-013); the prose fields are transport/history and were not re-validated as authority`
    ],
    authority: "registry",
    registry_authority: { status: "resolved", scope, event_id: eventId, event_class: event.event_class }
  };
}

/**
 * Mode-ON advisory for a prose-only payload: the baseline prose validation
 * stands (prose retirement is Wave-4 scope, NOT a rejection here), and the
 * result carries authority: "prose_transport" to distinguish it from
 * registry-backed authority. Flag OFF returns the baseline object untouched.
 */
function withProseTransportAdvisory(
  base: ValidationResult,
  options: RegistryAuthorityOptions
): RegistryModeValidationResult {
  if (!isGovdispRegistryAuthorityEnabled(options.env)) return base;
  return { ...base, authority: "prose_transport" };
}

// ---------------------------------------------------------------------------
// EPIC-052 Wave-1 — governance-displacement registry append/query service
// functions. Dependency-injected by design: the concrete append-only store
// ships in the Wave-1 registry storage module, and this surface binds only a
// structural handle so the public service layer stays decoupled from that
// module (the Wave-0 runtime-isolation contract forbids a direct import here).
// The store owns the single validation choke point; these functions add
// fail-closed named rejections for store/scope argument faults and pass the
// store's named rejections through unchanged.
// ---------------------------------------------------------------------------

/** Named fail-closed rejection, mirroring the registry storage shape. */
export interface GovdispRegistryRejection {
  field: string;
  event_class: string;
  code: string;
  detail: string;
}

/** Deterministic query filters (AND semantics; inclusive ISO ts bounds). */
export interface GovdispRegistryQuery {
  stable_objective_id?: string;
  event_class?: string;
  event_type?: string;
  from_ts?: string;
  to_ts?: string;
}

/** Structural handle over the append-only registry store. */
export interface GovdispRegistryStoreLike {
  appendRegistryEvent(
    scope: string,
    event: unknown,
    base?: string
  ):
    | { ok: true; path: string; event: GovdispEvent }
    | { ok: false; rejections: GovdispRegistryRejection[] };
  queryRegistryEvents(
    scope: string,
    query?: GovdispRegistryQuery,
    base?: string
  ):
    | { ok: true; events: GovdispEvent[] }
    | { ok: false; rejections: GovdispRegistryRejection[] };
}

export type GovdispRegistryAppendResult =
  | { ok: true; path: string; event: GovdispEvent }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type GovdispRegistryQueryResult =
  | { ok: true; events: GovdispEvent[] }
  | { ok: false; rejections: GovdispRegistryRejection[] };

function registryArgumentRejection(field: string, code: string, detail: string): GovdispRegistryRejection {
  return { field, event_class: "<store>", code, detail };
}

function requireRegistryStore(store: GovdispRegistryStoreLike, method: "appendRegistryEvent" | "queryRegistryEvents"): GovdispRegistryRejection | null {
  if (store === null || typeof store !== "object" || typeof store[method] !== "function") {
    return registryArgumentRejection(
      "store",
      "store_unavailable",
      `a registry store with a ${method} function is required; construct one from the Wave-1 registry storage module and inject it`
    );
  }
  return null;
}

function requireRegistryScope(scope: unknown): GovdispRegistryRejection | null {
  if (typeof scope !== "string" || scope.trim() === "") {
    return registryArgumentRejection(
      "scope",
      "invalid_scope",
      "scope must be a non-empty string naming the registry scope (a single safe path segment)"
    );
  }
  return null;
}

/**
 * Append one governance event to the append-only registry log for a scope.
 * The injected store performs the single choke-point validation; malformed
 * events are rejected fail-closed with named field + event-class reasons.
 * No mutation or deletion surface exists — this is an append-only channel.
 */
export function appendGovdispEvent(
  store: GovdispRegistryStoreLike,
  scope: string,
  event: unknown,
  base?: string
): GovdispRegistryAppendResult {
  const storeFault = requireRegistryStore(store, "appendRegistryEvent");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };
  return store.appendRegistryEvent(scope, event, base);
}

/**
 * Deterministically query the append-only registry log for a scope by
 * stable_objective_id, event class, event type, and/or inclusive time range.
 * Results are in append order; invalid queries or corrupt logs fail closed
 * with named rejections and no partial results.
 */
export function queryGovdispEvents(
  store: GovdispRegistryStoreLike,
  scope: string,
  query: GovdispRegistryQuery = {},
  base?: string
): GovdispRegistryQueryResult {
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };
  return store.queryRegistryEvents(scope, query, base);
}

// ---------------------------------------------------------------------------
// STORY-GOVDISP-003 — attempt accounting + attempt-ceiling evaluator.
//
// GD-DEC-004: retry laundering must become a named refusal. These are PURE,
// STATELESS derivations over the append-only registry: every count is derived
// from the registry's own events at evaluation time and NOTHING is stored or
// cached between calls (the registry is the append-only truth; evaluators are
// stateless functions over it). The ceiling binds to the immutable
// stable_objective_id — never to a session, seat, task name, or attempt_index
// label — so no laundering vector (reset / restaff / rename / cure / rerun /
// a fresh "start" for the same objective) can reset the count.
// ---------------------------------------------------------------------------

/**
 * The ceiling on attempts per stable_objective_id. Attempts 1..ATTEMPT_CEILING
 * are permitted; attempt ATTEMPT_CEILING + 1 (and beyond) is refused by name.
 */
export const ATTEMPT_CEILING = 3 as const;

/** The named refusal emitted when an attempt exceeds ATTEMPT_CEILING. */
export const ATTEMPT_REFUSAL_NAME = "ATTEMPT_REFUSED" as const;

/** The named-rejection code carried by an attempt-ceiling refusal. */
export const ATTEMPT_CEILING_CODE = "attempt_ceiling" as const;

/** Canonical attempt trigger spellings (mirrors the registry ATTEMPT_TRIGGERS). */
const ATTEMPT_TRIGGER_VALUES = ["start", "reset", "restaff", "rename", "cure", "rerun"] as const;

/**
 * A named attempt-ceiling refusal. Follows the registry named-rejection shape
 * conventions ({ field, event_class, code, detail }) and additionally carries
 * the attempt-ceiling context: the objective the ceiling binds to, the refused
 * attempt_index, the ceiling, and the laundering trigger vector.
 */
export interface AttemptRefusal {
  name: typeof ATTEMPT_REFUSAL_NAME;
  field: string;
  event_class: "ATTEMPT";
  code: typeof ATTEMPT_CEILING_CODE;
  detail: string;
  stable_objective_id: string;
  attempt_index: number;
  ceiling: number;
  trigger: string;
}

/**
 * Stateless attempt accounting derived from the registry's ATTEMPT events.
 * `count` is the total number of attempts (every attempt increment counts the
 * SAME counter); `per_trigger` breaks the count down by canonical trigger
 * (start/reset/restaff/rename/cure/rerun), with `unknown` absorbing attempt
 * increments that carry no recognized trigger. No counter is persisted: this
 * object is recomputed from events on every call.
 */
export interface AttemptAccounting {
  stable_objective_id: string;
  count: number;
  per_trigger: Record<string, number>;
}

export type DeriveAttemptAccountingResult =
  | { ok: true; accounting: AttemptAccounting }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type EvaluateAttemptCeilingResult =
  | { ok: true; permitted: true; stable_objective_id: string; attempt_index: number; ceiling: number; trigger: string; accounting: AttemptAccounting }
  | { ok: true; permitted: false; refusal: AttemptRefusal; accounting: AttemptAccounting }
  | { ok: false; rejections: GovdispRegistryRejection[] };

function requireStableObjectiveId(stableObjectiveId: unknown): GovdispRegistryRejection | null {
  if (typeof stableObjectiveId !== "string" || stableObjectiveId.trim() === "") {
    return registryArgumentRejection(
      "stable_objective_id",
      "invalid_objective",
      "stable_objective_id must be a non-empty string naming the immutable objective the attempt ceiling binds to"
    );
  }
  return null;
}

/** True when an event is an ATTEMPT-class increment (not a refusal record). */
function isAttemptIncrement(event: GovdispEvent): boolean {
  return (
    event.event_class === "ATTEMPT" &&
    (event.event_type === "ATTEMPT_STARTED" || event.event_type === "ATTEMPT_COUNTED")
  );
}

/** Canonical trigger key for an attempt increment; "unknown" when absent/unrecognized. */
function attemptTriggerKey(event: GovdispEvent): string {
  if (event.event_class !== "ATTEMPT") return "unknown";
  const trigger = (event as { trigger?: unknown }).trigger;
  if (typeof trigger === "string" && (ATTEMPT_TRIGGER_VALUES as readonly string[]).includes(trigger)) {
    return trigger;
  }
  return "unknown";
}

/**
 * Derive the attempt accounting for one stable_objective_id from the registry.
 *
 * Pure and stateless: the count and per-trigger breakdown are recomputed from
 * the registry's ATTEMPT events on every call. EVERY attempt increment
 * (ATTEMPT_STARTED / ATTEMPT_COUNTED) for the objective increments the SAME
 * counter — reset, restaff, rename, cure, rerun, and a fresh start are all
 * attempts; a rename/requeue expressed via a rename-trigger ATTEMPT event
 * counts identically. ATTEMPT_REFUSED records never increment the counter.
 * Only events already recorded under this objective are counted: the
 * ATTEMPT_REFUSED rows this evaluator emits are recorded separately and are
 * not increments.
 */
export function deriveAttemptAccounting(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  base?: string
): DeriveAttemptAccountingResult {
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };
  const objectiveFault = requireStableObjectiveId(stableObjectiveId);
  if (objectiveFault) return { ok: false, rejections: [objectiveFault] };

  const queried = store.queryRegistryEvents(
    scope,
    { stable_objective_id: stableObjectiveId, event_class: "ATTEMPT" },
    base
  );
  if (!queried.ok) return { ok: false, rejections: queried.rejections };

  const perTrigger: Record<string, number> = {};
  let count = 0;
  for (const event of queried.events) {
    if (!isAttemptIncrement(event)) continue;
    const key = attemptTriggerKey(event);
    perTrigger[key] = (perTrigger[key] ?? 0) + 1;
    count += 1;
  }

  return {
    ok: true,
    accounting: { stable_objective_id: stableObjectiveId, count, per_trigger: perTrigger }
  };
}

/**
 * Evaluate the attempt ceiling for one stable_objective_id.
 *
 * The candidate attempt_index is the derived count + 1 (derived from events,
 * never taken from a self-asserted attempt_index field, so a laundering vector
 * cannot reset the count by relabeling). Attempts 1..ATTEMPT_CEILING are
 * permitted; attempt ATTEMPT_CEILING + 1 (and beyond) yields a named
 * ATTEMPT_REFUSED refusal. Stateless: repeated evaluation over the same log
 * yields the identical verdict.
 */
export function evaluateAttemptCeiling(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  trigger: string,
  base?: string
): EvaluateAttemptCeilingResult {
  const accountingResult = deriveAttemptAccounting(store, scope, stableObjectiveId, base);
  if (!accountingResult.ok) return { ok: false, rejections: accountingResult.rejections };

  const { accounting } = accountingResult;
  const attemptIndex = accounting.count + 1;
  const normalizedTrigger =
    typeof trigger === "string" && (ATTEMPT_TRIGGER_VALUES as readonly string[]).includes(trigger)
      ? trigger
      : "unknown";

  if (attemptIndex <= ATTEMPT_CEILING) {
    return {
      ok: true,
      permitted: true,
      stable_objective_id: stableObjectiveId,
      attempt_index: attemptIndex,
      ceiling: ATTEMPT_CEILING,
      trigger: normalizedTrigger,
      accounting
    };
  }

  const priorCount = accounting.count;
  return {
    ok: true,
    permitted: false,
    refusal: {
      name: ATTEMPT_REFUSAL_NAME,
      field: "attempt_index",
      event_class: "ATTEMPT",
      code: ATTEMPT_CEILING_CODE,
      detail: `attempt ceiling exceeded for stable_objective_id "${stableObjectiveId}": attempt ${attemptIndex} exceeds the ${ATTEMPT_CEILING}-attempt ceiling (${priorCount} prior attempt(s) already recorded); retry laundering via a "${normalizedTrigger}" trigger does not reset the count`,
      stable_objective_id: stableObjectiveId,
      attempt_index: attemptIndex,
      ceiling: ATTEMPT_CEILING,
      trigger: normalizedTrigger
    },
    accounting
  };
}

// ---------------------------------------------------------------------------
// STORY-GOVDISP-003 — meta-governance depth cap + break-glass acceptance.
//
// GD-DEC-001 caps meta-governance at ONE audited layer. An AUDIT-class event
// auditing ordinary work is depth 1 (permitted). An audit whose target is
// itself an audit (audit-of-audit) is depth 2 and is REFUSED by name unless a
// valid BREAK_GLASS event for the same stable_objective_id exists in the
// registry. These are PURE, STATELESS derivations over the append-only
// registry — the same doctrine as the attempt evaluator above: depth is
// derived from the registry's own AUDIT events at evaluation time and NOTHING
// is stored or cached between calls. The policy doctrine lives in
// protocol/resources/meta-governance-depth.yaml (cap, refusal codes,
// break-glass requirements); the cap is declared here as a typed constant
// because the canonical resource-loading surface (the protocol repository's
// REQUIRED_PROTOCOL_FILES / ProtocolData) is outside this slice's write
// scope, and ATTEMPT_CEILING sets the in-code constant precedent — the
// contract's typed-constant fallback, recorded in the slice Summary/report.
// ---------------------------------------------------------------------------

/**
 * The cap on meta-governance depth per stable_objective_id. An audit of
 * ordinary work (depth 1) is permitted; any audit-of-audit (depth 2+) is
 * refused by name unless a valid BREAK_GLASS event authorizes the re-audit.
 * Doctrine: protocol/resources/meta-governance-depth.yaml (cap: 1).
 */
export const META_GOVERNANCE_DEPTH_CAP = 1 as const;

/** The named refusal emitted when an audit exceeds META_GOVERNANCE_DEPTH_CAP. */
export const AUDIT_REFUSAL_NAME = "AUDIT_REFUSED" as const;

/** Named-rejection code: depth exceeded the cap with no valid break-glass. */
export const META_GOVERNANCE_DEPTH_CODE = "meta_governance_depth" as const;

/**
 * Named-rejection code: an artifact offered as break-glass authority is not a
 * BREAK_GLASS event. An [SCP-EXCEPTION]-shaped payload (or any other class) is
 * never accepted as break-glass authority (G7).
 */
export const BREAK_GLASS_WRONG_CLASS_CODE = "break_glass_wrong_class" as const;

/**
 * A named meta-governance depth refusal. Follows the registry named-rejection
 * shape conventions ({ field, event_class, code, detail }) and additionally
 * carries the depth-cap context: the objective the cap binds to, the derived
 * depth, and the cap.
 */
export interface MetaGovernanceDepthRefusal {
  name: typeof AUDIT_REFUSAL_NAME;
  field: string;
  event_class: "AUDIT";
  code: typeof META_GOVERNANCE_DEPTH_CODE | typeof BREAK_GLASS_WRONG_CLASS_CODE;
  detail: string;
  stable_objective_id: string;
  depth: number;
  cap: number;
}

/**
 * Stateless meta-governance depth derivation. `depth` is the candidate audit's
 * derived depth (1 = audits ordinary work; 2+ = audit-of-audit chain);
 * `audit_chain` lists the resolved target_event_id links walked through the
 * registry; `break_glass_*` reports BREAK_GLASS presence/binding for the same
 * stable_objective_id. Recomputed from events on every call — never stored.
 */
export interface MetaGovernanceDepthDerivation {
  stable_objective_id: string;
  depth: number;
  cap: number;
  audit_chain: string[];
  break_glass_present: boolean;
  break_glass_event_ids: string[];
}

export type DeriveMetaGovernanceDepthResult =
  | { ok: true; derivation: MetaGovernanceDepthDerivation }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type EvaluateMetaGovernanceDepthResult =
  | {
      ok: true;
      permitted: true;
      stable_objective_id: string;
      depth: number;
      cap: number;
      authorized_by: "depth_cap" | "break_glass";
      break_glass_event_id: string | null;
      derivation: MetaGovernanceDepthDerivation;
    }
  | { ok: true; permitted: false; refusal: MetaGovernanceDepthRefusal; derivation: MetaGovernanceDepthDerivation }
  | { ok: false; rejections: GovdispRegistryRejection[] };

/** Options for evaluateMetaGovernanceDepth. */
export interface MetaGovernanceDepthEvaluationOptions {
  /**
   * An artifact offered out-of-band as break-glass authority for this
   * re-audit. It must BE a schema-valid BREAK_GLASS event that is also present
   * in the registry bound to the same stable_objective_id (registry presence
   * is the authority; the offer only binds it). Any other shape — an
   * [SCP-EXCEPTION] payload, a different event class, a malformed object — is
   * rejected by name (break_glass_wrong_class), never accepted.
   */
  breakGlassAuthority?: unknown;
}

/**
 * Derive the meta-governance depth of a candidate audit target from the
 * registry's own events.
 *
 * Pure and stateless: depth is recomputed from the registry on every call. An
 * audit of ordinary work is depth 1. An audit whose target is another audit
 * event (target.kind = "audit") is depth 2 or deeper; the chain is walked
 * through the registry's AUDIT events for the same stable_objective_id, with
 * cycle and unresolvable-id links terminating the walk (each still counts as
 * one layer — an audit claiming an audit target is meta-governance whether or
 * not the target resolves). BREAK_GLASS presence for the objective is reported
 * alongside; BREAK_GLASS events already carry the append-time union validation
 * (authorizing_human + named contradiction), which is reused here, never
 * re-validated.
 */
export function deriveMetaGovernanceDepth(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  target: unknown,
  base?: string
): DeriveMetaGovernanceDepthResult {
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };
  const objectiveFault = requireStableObjectiveId(stableObjectiveId);
  if (objectiveFault) return { ok: false, rejections: [objectiveFault] };

  const parsedTarget = auditTargetSchema.safeParse(target);
  if (!parsedTarget.success) {
    return {
      ok: false,
      rejections: [{
        field: "target",
        event_class: "AUDIT",
        code: "invalid_target",
        detail: "target must be a schema-valid audit target: { kind: \"ordinary_work\" } or { kind: \"audit\", target_event_id }"
      }]
    };
  }

  const queried = store.queryRegistryEvents(
    scope,
    { stable_objective_id: stableObjectiveId },
    base
  );
  if (!queried.ok) return { ok: false, rejections: queried.rejections };

  const auditEventsById = new Map<string, GovdispEvent>();
  const breakGlassEventIds: string[] = [];
  for (const event of queried.events) {
    if (event.event_class === "AUDIT") auditEventsById.set(event.event_id, event);
    if (event.event_class === "BREAK_GLASS") breakGlassEventIds.push(event.event_id);
  }

  const chain: string[] = [];
  let depth = 1;
  let current: AuditTarget = parsedTarget.data;
  const visited = new Set<string>();
  while (current.kind === "audit") {
    depth += 1;
    chain.push(current.target_event_id);
    if (visited.has(current.target_event_id)) break;
    visited.add(current.target_event_id);
    const targetEvent = auditEventsById.get(current.target_event_id);
    if (targetEvent === undefined || targetEvent.event_class !== "AUDIT") break;
    current = targetEvent.target;
  }

  return {
    ok: true,
    derivation: {
      stable_objective_id: stableObjectiveId,
      depth,
      cap: META_GOVERNANCE_DEPTH_CAP,
      audit_chain: chain,
      break_glass_present: breakGlassEventIds.length > 0,
      break_glass_event_ids: breakGlassEventIds
    }
  };
}

/**
 * Evaluate the meta-governance depth cap for a candidate audit.
 *
 * Depth 1 (an audit of ordinary work) is permitted under the cap. Depth 2+
 * (an audit whose target is itself an audit) is REFUSED with a named
 * meta_governance_depth refusal UNLESS a valid BREAK_GLASS event for the same
 * stable_objective_id exists in the registry — presence plus binding is the
 * authorization, never an in-memory offer alone. An [SCP-EXCEPTION]-shaped
 * payload (or any non-BREAK_GLASS artifact) offered as break-glass authority
 * is rejected by name (break_glass_wrong_class). Stateless: repeated
 * evaluation over the same log yields the identical verdict.
 */
export function evaluateMetaGovernanceDepth(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  target: unknown,
  base?: string,
  options: MetaGovernanceDepthEvaluationOptions = {}
): EvaluateMetaGovernanceDepthResult {
  const derivationResult = deriveMetaGovernanceDepth(store, scope, stableObjectiveId, target, base);
  if (!derivationResult.ok) return { ok: false, rejections: derivationResult.rejections };
  const { derivation } = derivationResult;

  const refuse = (
    code: typeof META_GOVERNANCE_DEPTH_CODE | typeof BREAK_GLASS_WRONG_CLASS_CODE,
    field: string,
    detail: string
  ): EvaluateMetaGovernanceDepthResult => ({
    ok: true,
    permitted: false,
    refusal: {
      name: AUDIT_REFUSAL_NAME,
      field,
      event_class: "AUDIT",
      code,
      detail,
      stable_objective_id: stableObjectiveId,
      depth: derivation.depth,
      cap: derivation.cap
    },
    derivation
  });

  // G7: validate any out-of-band artifact offered as break-glass authority
  // BEFORE consulting the cap. An exception-shaped or otherwise non-BREAK_GLASS
  // offer is named and refused — never accepted, never silently ignored.
  let offeredBreakGlassId: string | null = null;
  const offered = options.breakGlassAuthority;
  if (offered !== undefined && offered !== null) {
    const parsedOffer = govdispEventSchema.safeParse(offered);
    if (!parsedOffer.success || parsedOffer.data.event_class !== "BREAK_GLASS") {
      return refuse(
        BREAK_GLASS_WRONG_CLASS_CODE,
        "break_glass",
        `the artifact offered as break-glass authority for stable_objective_id "${stableObjectiveId}" is not a BREAK_GLASS event (an [SCP-EXCEPTION]-shaped payload, or any other class, is not break-glass authority); only a schema-valid BREAK_GLASS_RECORDED event recorded in the registry can authorize a re-audit`
      );
    }
    const offerEvent = parsedOffer.data;
    if (
      offerEvent.stable_objective_id !== stableObjectiveId ||
      !derivation.break_glass_event_ids.includes(offerEvent.event_id)
    ) {
      return refuse(
        META_GOVERNANCE_DEPTH_CODE,
        "break_glass",
        `the offered BREAK_GLASS event "${offerEvent.event_id}" is not present in the registry bound to stable_objective_id "${stableObjectiveId}"; break-glass authorization requires presence plus binding — an in-memory offer alone is not authority`
      );
    }
    offeredBreakGlassId = offerEvent.event_id;
  }

  if (derivation.depth <= derivation.cap) {
    return {
      ok: true,
      permitted: true,
      stable_objective_id: stableObjectiveId,
      depth: derivation.depth,
      cap: derivation.cap,
      authorized_by: "depth_cap",
      break_glass_event_id: null,
      derivation
    };
  }

  const authorizingBreakGlassId = offeredBreakGlassId ?? derivation.break_glass_event_ids[0] ?? null;
  if (authorizingBreakGlassId !== null) {
    return {
      ok: true,
      permitted: true,
      stable_objective_id: stableObjectiveId,
      depth: derivation.depth,
      cap: derivation.cap,
      authorized_by: "break_glass",
      break_glass_event_id: authorizingBreakGlassId,
      derivation
    };
  }

  return refuse(
    META_GOVERNANCE_DEPTH_CODE,
    "target",
    `meta-governance depth ${derivation.depth} exceeds the cap of ${derivation.cap} for stable_objective_id "${stableObjectiveId}": an audit whose target is itself an audit is an audit-of-audit and requires a valid BREAK_GLASS_RECORDED event (authorizing_human plus a named concrete contradiction) recorded in the registry for the same objective — none is recorded`
  );
}

// ---------------------------------------------------------------------------
// STORY-GOVDISP-003 — governance-overhead budget + single terminal-blocked
// event (GD-DEC-002: governance overhead must terminate in exactly ONE blocked
// event instead of spawning more proof work).
//
// These are PURE, STATELESS derivations over the append-only registry — the
// same doctrine as the attempt and depth evaluators above: every count is
// recomputed from the registry's own events at evaluation time and NOTHING is
// stored or cached between calls (the registry is the append-only truth;
// evaluators are stateless functions over it). The budget binds to the
// immutable stable_objective_id. The policy doctrine lives in
// protocol/resources/governance-overhead-budget.yaml (budget, countable
// classes, refusal codes, terminal-guard rules); the budget is declared here
// as a typed constant because the canonical resource-loading surface (the
// protocol repository's REQUIRED_PROTOCOL_FILES / ProtocolData) is outside
// this slice's write scope, and ATTEMPT_CEILING / META_GOVERNANCE_DEPTH_CAP
// set the in-code constant precedent — the contract's typed-constant fallback,
// recorded in the slice Summary/report.
//
// LAYERING (recorded per contract): the registry storage choke point stays
// shape-only. The budget guard, the terminal guard, and the post-terminal
// refusal below are service-layer policy functions that callers invoke;
// storage validation is reused, never re-implemented, never widened.
// ---------------------------------------------------------------------------

/**
 * The governance-overhead budget per stable_objective_id. While the derived
 * overhead count is below GOVERNANCE_OVERHEAD_BUDGET, further overhead is
 * permitted with remaining = budget - count; at count >= budget the objective's
 * overhead budget is exhausted and the candidate overhead event is refused by
 * name (candidate-event semantics, the ATTEMPT_CEILING precedent). Doctrine:
 * protocol/resources/governance-overhead-budget.yaml (default_overhead_budget:
 * 25 — a deliberately generous ceiling; run-ledger field data shows healthy
 * slices consume fewer than 20 governance events).
 */
export const GOVERNANCE_OVERHEAD_BUDGET = 25 as const;

/** The named refusal emitted when governance overhead reaches the budget. */
export const OVERHEAD_BUDGET_REFUSAL_NAME = "GOVERNANCE_OVERHEAD_BUDGET_REFUSED" as const;

/** Named-rejection code: the governance-overhead budget is exhausted. */
export const GOVERNANCE_OVERHEAD_BUDGET_CODE = "governance_overhead_budget" as const;

/** The named refusal emitted when the terminal guard declines an append. */
export const TERMINAL_BLOCKED_REFUSAL_NAME = "TERMINAL_BLOCKED_REFUSED" as const;

/** Named-rejection code: a TERMINAL_BLOCKED event already exists for the objective. */
export const TERMINAL_ALREADY_RECORDED_CODE = "terminal_already_recorded" as const;

/** Named-rejection code: the terminal guard was invoked without a budget breach. */
export const BUDGET_NOT_EXHAUSTED_CODE = "budget_not_exhausted" as const;

/** The named refusal emitted when a governance-overhead append follows a TERMINAL_BLOCKED. */
export const GOVERNANCE_APPEND_REFUSAL_NAME = "GOVERNANCE_APPEND_REFUSED" as const;

/** Named-rejection code: the objective is terminally blocked; overhead appends are refused. */
export const OBJECTIVE_TERMINALLY_BLOCKED_CODE = "objective_terminally_blocked" as const;

/**
 * The governance-overhead event classes counted toward the budget. TERMINAL
 * events are outcomes, not overhead, and NEVER count (the countable-class
 * boundary); BUDGET events are the budget machinery's own records, and counting
 * them would be self-referential.
 */
const GOVERNANCE_OVERHEAD_COUNTABLE_CLASSES = ["ATTEMPT", "FINDING", "BREAK_GLASS", "AUDIT"] as const;

/**
 * Stateless governance-overhead accounting derived from the registry. `count`
 * is the number of governance-overhead events (the countable classes) recorded
 * for the objective; `per_class` breaks the count down by class; `remaining` is
 * how many further overhead events fit under the budget (0 at exhaustion);
 * `terminal_blocked_*` reports TERMINAL_BLOCKED presence for the objective. No
 * counter is persisted: this object is recomputed from events on every call.
 */
export interface OverheadAccounting {
  stable_objective_id: string;
  count: number;
  per_class: Record<string, number>;
  budget: number;
  remaining: number;
  terminal_blocked_present: boolean;
  terminal_blocked_event_ids: string[];
}

/**
 * A named governance-overhead budget refusal. Follows the registry
 * named-rejection shape conventions ({ field, event_class, code, detail }) and
 * additionally carries the budget context: the objective the budget binds to,
 * the derived overhead count, and the budget.
 */
export interface OverheadBudgetRefusal {
  name: typeof OVERHEAD_BUDGET_REFUSAL_NAME;
  field: string;
  event_class: "BUDGET";
  code: typeof GOVERNANCE_OVERHEAD_BUDGET_CODE;
  detail: string;
  stable_objective_id: string;
  count: number;
  budget: number;
}

/**
 * A named terminal-guard refusal: the TERMINAL_BLOCKED append was declined,
 * either because the exactly-one invariant already holds
 * (terminal_already_recorded, with existing_event_id set) or because no budget
 * breach exists to terminate (budget_not_exhausted).
 */
export interface TerminalBlockedRefusal {
  name: typeof TERMINAL_BLOCKED_REFUSAL_NAME;
  field: string;
  event_class: "TERMINAL";
  code: typeof TERMINAL_ALREADY_RECORDED_CODE | typeof BUDGET_NOT_EXHAUSTED_CODE;
  detail: string;
  stable_objective_id: string;
  existing_event_id: string | null;
  count: number;
  budget: number;
}

/**
 * A named post-terminal refusal: a governance-overhead append was attempted
 * for an objective that already carries a TERMINAL_BLOCKED event.
 */
export interface ObjectiveTerminallyBlockedRefusal {
  name: typeof GOVERNANCE_APPEND_REFUSAL_NAME;
  field: string;
  event_class: string;
  code: typeof OBJECTIVE_TERMINALLY_BLOCKED_CODE;
  detail: string;
  stable_objective_id: string;
  terminal_event_id: string;
}

/** Input for recordBudgetExhaustion: the caller-supplied terminal event fields. */
export interface RecordBudgetExhaustionInput {
  event_id: string;
  ts: string;
  actor_role?: string;
  /**
   * Evidence bindings for the terminal record. The typed event union requires
   * at least one content hash on every TERMINAL event (terminal events persist
   * content hashes rather than raw proof bodies); an empty list is rejected by
   * the store's append-time union validation, which is reused, never
   * re-validated here.
   */
  content_hashes: Array<{ path: string; sha256: string }>;
}

export type DeriveOverheadAccountingResult =
  | { ok: true; accounting: OverheadAccounting }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type EvaluateOverheadBudgetResult =
  | { ok: true; permitted: true; stable_objective_id: string; count: number; budget: number; remaining: number; accounting: OverheadAccounting }
  | { ok: true; permitted: false; refusal: OverheadBudgetRefusal; accounting: OverheadAccounting }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type RecordBudgetExhaustionResult =
  | { ok: true; appended: true; path: string; event: GovdispEvent; accounting: OverheadAccounting }
  | { ok: true; appended: false; refusal: TerminalBlockedRefusal; accounting: OverheadAccounting }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type AppendGovernanceOverheadEventResult =
  | { ok: true; appended: true; path: string; event: GovdispEvent }
  | { ok: true; appended: false; refusal: ObjectiveTerminallyBlockedRefusal }
  | { ok: false; rejections: GovdispRegistryRejection[] };

/**
 * Derive the governance-overhead accounting for one stable_objective_id from
 * the registry.
 *
 * Pure and stateless: the count, per-class breakdown, and TERMINAL_BLOCKED
 * presence are recomputed from the registry's events on every call. Only the
 * countable classes (ATTEMPT, FINDING, BREAK_GLASS, AUDIT) increment the count;
 * TERMINAL events are outcomes and BUDGET events are the budget machinery's own
 * records, so neither ever counts toward the budget. Refusal records are
 * returned to callers, never appended, so refusals cannot inflate the count.
 */
export function deriveOverheadAccounting(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  base?: string
): DeriveOverheadAccountingResult {
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };
  const objectiveFault = requireStableObjectiveId(stableObjectiveId);
  if (objectiveFault) return { ok: false, rejections: [objectiveFault] };

  const queried = store.queryRegistryEvents(
    scope,
    { stable_objective_id: stableObjectiveId },
    base
  );
  if (!queried.ok) return { ok: false, rejections: queried.rejections };

  const perClass: Record<string, number> = {};
  const terminalBlockedEventIds: string[] = [];
  let count = 0;
  for (const event of queried.events) {
    if ((GOVERNANCE_OVERHEAD_COUNTABLE_CLASSES as readonly string[]).includes(event.event_class)) {
      perClass[event.event_class] = (perClass[event.event_class] ?? 0) + 1;
      count += 1;
    }
    if (event.event_class === "TERMINAL" && event.event_type === "TERMINAL_BLOCKED") {
      terminalBlockedEventIds.push(event.event_id);
    }
  }

  return {
    ok: true,
    accounting: {
      stable_objective_id: stableObjectiveId,
      count,
      per_class: perClass,
      budget: GOVERNANCE_OVERHEAD_BUDGET,
      remaining: Math.max(0, GOVERNANCE_OVERHEAD_BUDGET - count),
      terminal_blocked_present: terminalBlockedEventIds.length > 0,
      terminal_blocked_event_ids: terminalBlockedEventIds
    }
  };
}

/**
 * Evaluate the governance-overhead budget for one stable_objective_id.
 *
 * Under budget (count < GOVERNANCE_OVERHEAD_BUDGET): permitted, with the
 * remaining count. At exhaustion (count >= budget): the candidate overhead
 * event is REFUSED with a named governance_overhead_budget refusal carrying
 * the objective, count, and budget. The verdict is a pure derivation over the
 * registry: repeated evaluation over the same log yields the identical verdict,
 * and the evaluator never appends anything — on breach the caller invokes the
 * terminal guard (recordBudgetExhaustion), which terminates the objective in
 * exactly one blocked event instead of spawning more proof work.
 */
export function evaluateOverheadBudget(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  base?: string
): EvaluateOverheadBudgetResult {
  const accountingResult = deriveOverheadAccounting(store, scope, stableObjectiveId, base);
  if (!accountingResult.ok) return { ok: false, rejections: accountingResult.rejections };
  const { accounting } = accountingResult;

  if (accounting.count < accounting.budget) {
    return {
      ok: true,
      permitted: true,
      stable_objective_id: stableObjectiveId,
      count: accounting.count,
      budget: accounting.budget,
      remaining: accounting.remaining,
      accounting
    };
  }

  return {
    ok: true,
    permitted: false,
    refusal: {
      name: OVERHEAD_BUDGET_REFUSAL_NAME,
      field: "overhead_count",
      event_class: "BUDGET",
      code: GOVERNANCE_OVERHEAD_BUDGET_CODE,
      detail: `governance-overhead budget exhausted for stable_objective_id "${stableObjectiveId}": ${accounting.count} countable governance event(s) (${GOVERNANCE_OVERHEAD_COUNTABLE_CLASSES.join(" | ")}) reached the budget of ${accounting.budget}; the candidate overhead event is refused — terminate the objective with exactly one TERMINAL_BLOCKED via recordBudgetExhaustion instead of spawning more proof work`,
      stable_objective_id: stableObjectiveId,
      count: accounting.count,
      budget: accounting.budget
    },
    accounting
  };
}

/**
 * The terminal guard (GD-DEC-002): on a derived budget breach, append EXACTLY
 * ONE TERMINAL_BLOCKED event for the objective.
 *
 * The single-event invariant is DERIVED, not stored: before appending, the
 * guard re-derives the accounting from the registry and refuses the append by
 * name (terminal_already_recorded) when a TERMINAL_BLOCKED already exists for
 * the objective — a second exhaustion call is idempotent and appends nothing.
 * The guard fires only on breach: without a derived budget exhaustion there is
 * nothing to terminate, and the append is refused by name (budget_not_exhausted)
 * so a false terminal block can never be recorded through this guard. The guard
 * is race-tolerant via the store's existing lock: single-process callers cannot
 * interleave the synchronous derive-then-append sequence, the store's mkdir
 * lock serializes every individual append across processes, and any duplicate
 * invocation after the first landing refuses by name. The append itself passes
 * through the store's single validation choke point unchanged (the TERMINAL
 * union member requires content_hashes — reused, never re-validated here).
 */
export function recordBudgetExhaustion(
  store: GovdispRegistryStoreLike,
  scope: string,
  stableObjectiveId: string,
  event: RecordBudgetExhaustionInput,
  base?: string
): RecordBudgetExhaustionResult {
  const accountingResult = deriveOverheadAccounting(store, scope, stableObjectiveId, base);
  if (!accountingResult.ok) return { ok: false, rejections: accountingResult.rejections };
  const { accounting } = accountingResult;

  if (accounting.terminal_blocked_present) {
    const existingEventId = accounting.terminal_blocked_event_ids[0] ?? "";
    return {
      ok: true,
      appended: false,
      refusal: {
        name: TERMINAL_BLOCKED_REFUSAL_NAME,
        field: "event_type",
        event_class: "TERMINAL",
        code: TERMINAL_ALREADY_RECORDED_CODE,
        detail: `a TERMINAL_BLOCKED event already exists for stable_objective_id "${stableObjectiveId}" (event_id "${existingEventId}"); the exactly-one terminal invariant is derived from the registry — the duplicate append is refused and nothing is recorded`,
        stable_objective_id: stableObjectiveId,
        existing_event_id: existingEventId,
        count: accounting.count,
        budget: accounting.budget
      },
      accounting
    };
  }

  if (accounting.count < accounting.budget) {
    return {
      ok: true,
      appended: false,
      refusal: {
        name: TERMINAL_BLOCKED_REFUSAL_NAME,
        field: "overhead_count",
        event_class: "TERMINAL",
        code: BUDGET_NOT_EXHAUSTED_CODE,
        detail: `no budget breach exists for stable_objective_id "${stableObjectiveId}" (${accounting.count} of ${accounting.budget} governance-overhead events recorded); the terminal guard fires on a derived breach only — appending a terminal event now would be a false block`,
        stable_objective_id: stableObjectiveId,
        existing_event_id: null,
        count: accounting.count,
        budget: accounting.budget
      },
      accounting
    };
  }

  const storeFault = requireRegistryStore(store, "appendRegistryEvent");
  if (storeFault) return { ok: false, rejections: [storeFault] };

  // The canonical registry schema version literal is spelled out here because
  // the Wave-0 runtime-isolation contract forbids importing the registry
  // module's constants into this service layer; the store's choke point
  // validates the value against the canonical schema on every append.
  const terminalEvent = {
    schema_version: "govdisp.event.v1",
    event_id: event.event_id,
    ts: event.ts,
    stable_objective_id: stableObjectiveId,
    ...(typeof event.actor_role === "string" ? { actor_role: event.actor_role } : {}),
    event_class: "TERMINAL",
    event_type: "TERMINAL_BLOCKED",
    content_hashes: event.content_hashes
  };
  const appended = store.appendRegistryEvent(scope, terminalEvent, base);
  if (!appended.ok) return { ok: false, rejections: appended.rejections };
  return { ok: true, appended: true, path: appended.path, event: appended.event, accounting };
}

/**
 * The post-terminal refusal guard: the service-layer channel callers invoke for
 * governance-overhead appends. Once a TERMINAL_BLOCKED event exists for an
 * objective, further governance-overhead appends (the countable classes) for
 * that objective are refused by name (objective_terminally_blocked) — the
 * terminal event is the end of the proof chain, never the start of a new one.
 *
 * The check is derivation-based: terminal presence is recomputed from the
 * registry on every call; nothing is cached. Jurisdiction is exactly the
 * countable governance-overhead classes on a payload carrying a non-empty
 * stable_objective_id; every other payload passes through to the store's
 * shape-only validation choke point unchanged — the storage layer stays
 * shape-only and this guard adds service-layer policy on top, never inside it.
 */
export function appendGovernanceOverheadEvent(
  store: GovdispRegistryStoreLike,
  scope: string,
  event: unknown,
  base?: string
): AppendGovernanceOverheadEventResult {
  const queryFault = requireRegistryStore(store, "queryRegistryEvents");
  if (queryFault) return { ok: false, rejections: [queryFault] };
  const appendFault = requireRegistryStore(store, "appendRegistryEvent");
  if (appendFault) return { ok: false, rejections: [appendFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };

  const candidate = event !== null && typeof event === "object" && !Array.isArray(event)
    ? (event as Record<string, unknown>)
    : undefined;
  const objectiveId = typeof candidate?.stable_objective_id === "string" ? candidate.stable_objective_id : "";
  const eventClass = typeof candidate?.event_class === "string" ? candidate.event_class : "";
  const governedOverhead =
    objectiveId.trim() !== "" &&
    (GOVERNANCE_OVERHEAD_COUNTABLE_CLASSES as readonly string[]).includes(eventClass);

  if (governedOverhead) {
    const accountingResult = deriveOverheadAccounting(store, scope, objectiveId, base);
    if (!accountingResult.ok) return { ok: false, rejections: accountingResult.rejections };
    const { accounting } = accountingResult;
    if (accounting.terminal_blocked_present) {
      const terminalEventId = accounting.terminal_blocked_event_ids[0] ?? "";
      return {
        ok: true,
        appended: false,
        refusal: {
          name: GOVERNANCE_APPEND_REFUSAL_NAME,
          field: "stable_objective_id",
          event_class: eventClass,
          code: OBJECTIVE_TERMINALLY_BLOCKED_CODE,
          detail: `stable_objective_id "${objectiveId}" is terminally blocked (TERMINAL_BLOCKED event_id "${terminalEventId}"); further governance-overhead appends for this objective are refused — the terminal event ends the proof chain instead of spawning a new one`,
          stable_objective_id: objectiveId,
          terminal_event_id: terminalEventId
        }
      };
    }
  }

  const appended = store.appendRegistryEvent(scope, event, base);
  if (!appended.ok) return { ok: false, rejections: appended.rejections };
  return { ok: true, appended: true, path: appended.path, event: appended.event };
}

// ---------------------------------------------------------------------------
// STORY-GOVDISP-004 — finding ownership lifecycle (GD-DEC-005: a finding is
// not ACTIVE until it has an accountable owner and a delivery event; "logged"
// must not masquerade as "driven").
//
// These are PURE, STATELESS derivations over the append-only registry — the
// same doctrine as the attempt, depth, and budget evaluators above: a
// finding's lifecycle state is recomputed from the registry's own FINDING
// events at evaluation time and NOTHING is stored or cached between calls
// (the registry is the append-only truth; evaluators are stateless functions
// over it). The Wave-0 union already carries the full FINDING family
// (FINDING_OPENED/OWNED/DELIVERED/CLOSED); this slice adds derivation and
// refusal policy only — no union changes. The closure evaluator is registry
// negative control #9: a FINDING_CLOSED raised for a finding lacking a
// FINDING_OWNED owner binding, a FINDING_DELIVERED delivery event, or both is
// refused with the named finding_not_active refusal citing exactly which
// prerequisite events are missing; closing an owned+delivered finding is
// permitted. The intervention-duty guard (countActiveFindings) counts only
// owner-bound findings with delivery events — unowned findings never count
// toward ODIN intervention duties.
// ---------------------------------------------------------------------------

/** The named refusal emitted when a finding closure violates GD-DEC-005. */
export const FINDING_REFUSAL_NAME = "FINDING_REFUSED" as const;

/** Named-rejection code: the finding is not ACTIVE (ownership/delivery prerequisites missing). */
export const FINDING_NOT_ACTIVE_CODE = "finding_not_active" as const;

/**
 * The FINDING event types a closure requires in the registry, in canonical
 * family order. A finding missing either prerequisite is not ACTIVE and is
 * non-closable (registry negative control #9).
 */
export const FINDING_CLOSURE_PREREQUISITES = ["FINDING_OWNED", "FINDING_DELIVERED"] as const;
export type FindingClosurePrerequisite = (typeof FINDING_CLOSURE_PREREQUISITES)[number];

/**
 * Stateless finding lifecycle derivation for one finding_id. Presence flags
 * and event-id lists (append order) are recomputed from the registry's
 * FINDING events on every call. `active` is the GD-DEC-005 binding: the
 * finding carries BOTH a FINDING_OWNED owner binding and a FINDING_DELIVERED
 * delivery event and is not closed. `missing_prerequisites` names exactly
 * which closure prerequisites are absent (canonical family order); it is
 * empty iff the finding is closable.
 */
export interface FindingStateDerivation {
  finding_id: string;
  event_count: number;
  opened: boolean;
  owned: boolean;
  delivered: boolean;
  closed: boolean;
  active: boolean;
  owner_roles: string[];
  opened_event_ids: string[];
  owned_event_ids: string[];
  delivered_event_ids: string[];
  closed_event_ids: string[];
  missing_prerequisites: FindingClosurePrerequisite[];
}

/**
 * A named finding-closure refusal. Follows the registry named-rejection
 * shape conventions ({ field, event_class, code, detail }) and additionally
 * carries the finding the closure was attempted on plus exactly which
 * prerequisite events are missing.
 */
export interface FindingClosureRefusal {
  name: typeof FINDING_REFUSAL_NAME;
  field: string;
  event_class: "FINDING";
  code: typeof FINDING_NOT_ACTIVE_CODE;
  detail: string;
  finding_id: string;
  missing_prerequisites: FindingClosurePrerequisite[];
}

export type DeriveFindingStateResult =
  | { ok: true; state: FindingStateDerivation }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type EvaluateFindingClosureResult =
  | { ok: true; permitted: true; finding_id: string; state: FindingStateDerivation }
  | { ok: true; permitted: false; refusal: FindingClosureRefusal; state: FindingStateDerivation }
  | { ok: false; rejections: GovdispRegistryRejection[] };

export type CountActiveFindingsResult =
  | { ok: true; count: number; active_finding_ids: string[]; inactive_finding_ids: string[] }
  | { ok: false; rejections: GovdispRegistryRejection[] };

function requireFindingId(findingId: unknown): GovdispRegistryRejection | null {
  if (typeof findingId !== "string" || findingId.trim() === "") {
    return registryArgumentRejection(
      "finding_id",
      "invalid_finding_id",
      "finding_id must be a non-empty string naming the finding whose lifecycle is derived"
    );
  }
  return null;
}

/**
 * Pure reducer: fold one finding's FINDING events (append order) into its
 * lifecycle state. An accountable owner is a FINDING_OWNED event (its
 * owner_role binding is reported when the event carries one); delivery is a
 * FINDING_DELIVERED event. Never touches storage — the caller supplies the
 * already-queried events.
 */
function summarizeFindingEvents(findingId: string, events: GovdispEvent[]): FindingStateDerivation {
  const openedEventIds: string[] = [];
  const ownedEventIds: string[] = [];
  const deliveredEventIds: string[] = [];
  const closedEventIds: string[] = [];
  const ownerRoles: string[] = [];
  for (const event of events) {
    if (event.event_class !== "FINDING" || event.finding_id !== findingId) continue;
    if (event.event_type === "FINDING_OPENED") openedEventIds.push(event.event_id);
    if (event.event_type === "FINDING_OWNED") {
      ownedEventIds.push(event.event_id);
      if (typeof event.owner_role === "string" && event.owner_role.trim() !== "") {
        ownerRoles.push(event.owner_role);
      }
    }
    if (event.event_type === "FINDING_DELIVERED") deliveredEventIds.push(event.event_id);
    if (event.event_type === "FINDING_CLOSED") closedEventIds.push(event.event_id);
  }
  const owned = ownedEventIds.length > 0;
  const delivered = deliveredEventIds.length > 0;
  const closed = closedEventIds.length > 0;
  const missingPrerequisites: FindingClosurePrerequisite[] = [];
  if (!owned) missingPrerequisites.push("FINDING_OWNED");
  if (!delivered) missingPrerequisites.push("FINDING_DELIVERED");
  return {
    finding_id: findingId,
    event_count: openedEventIds.length + ownedEventIds.length + deliveredEventIds.length + closedEventIds.length,
    opened: openedEventIds.length > 0,
    owned,
    delivered,
    closed,
    active: owned && delivered && !closed,
    owner_roles: ownerRoles,
    opened_event_ids: openedEventIds,
    owned_event_ids: ownedEventIds,
    delivered_event_ids: deliveredEventIds,
    closed_event_ids: closedEventIds,
    missing_prerequisites: missingPrerequisites
  };
}

/**
 * Derive the lifecycle state of one finding_id from the registry's FINDING
 * events for a scope.
 *
 * Pure and stateless: the state is recomputed from the registry on every
 * call; repeated derivation over the same log yields the identical state.
 * The derivation binds to the finding_id alone (a finding's lifecycle is its
 * own event stream, independent of every other finding in the scope).
 */
export function deriveFindingState(
  store: GovdispRegistryStoreLike,
  scope: string,
  findingId: string,
  base?: string
): DeriveFindingStateResult {
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };
  const findingFault = requireFindingId(findingId);
  if (findingFault) return { ok: false, rejections: [findingFault] };

  const queried = store.queryRegistryEvents(scope, { event_class: "FINDING" }, base);
  if (!queried.ok) return { ok: false, rejections: queried.rejections };
  return { ok: true, state: summarizeFindingEvents(findingId, queried.events) };
}

/**
 * Evaluate whether a FINDING_CLOSED may stand for one finding_id (registry
 * negative control #9, GD-DEC-005).
 *
 * The verdict is a pure derivation over the registry: a finding lacking a
 * FINDING_OWNED owner binding, a FINDING_DELIVERED delivery event, or both is
 * NOT ACTIVE, and its closure is REFUSED with a named finding_not_active
 * refusal citing exactly which prerequisite events are missing. Closing an
 * owned+delivered finding is permitted. The evaluator never appends anything;
 * repeated evaluation over the same log yields the identical verdict.
 */
export function evaluateFindingClosure(
  store: GovdispRegistryStoreLike,
  scope: string,
  findingId: string,
  base?: string
): EvaluateFindingClosureResult {
  const stateResult = deriveFindingState(store, scope, findingId, base);
  if (!stateResult.ok) return { ok: false, rejections: stateResult.rejections };
  const { state } = stateResult;

  if (state.missing_prerequisites.length === 0) {
    return { ok: true, permitted: true, finding_id: findingId, state };
  }

  return {
    ok: true,
    permitted: false,
    refusal: {
      name: FINDING_REFUSAL_NAME,
      field: "finding_id",
      event_class: "FINDING",
      code: FINDING_NOT_ACTIVE_CODE,
      detail: `finding "${findingId}" is not ACTIVE: GD-DEC-005 requires both a FINDING_OWNED owner binding and a FINDING_DELIVERED delivery event recorded in the registry before closure; missing prerequisite event(s): ${state.missing_prerequisites.join(", ")} — a logged finding must not masquerade as driven`,
      finding_id: findingId,
      missing_prerequisites: state.missing_prerequisites
    },
    state
  };
}

/**
 * The intervention-duty guard (GD-DEC-005): count the findings in a scope
 * that are ACTIVE — owner-bound (FINDING_OWNED) with a delivery event
 * (FINDING_DELIVERED) and not closed. Only active findings count toward ODIN
 * intervention duties; unowned, undelivered, and already-closed findings are
 * excluded and reported on the inactive list. Pure and stateless: findings
 * are grouped by finding_id in first-seen (append) order and each lifecycle
 * is recomputed from the registry's events on every call.
 */
export function countActiveFindings(
  store: GovdispRegistryStoreLike,
  scope: string,
  base?: string
): CountActiveFindingsResult {
  const storeFault = requireRegistryStore(store, "queryRegistryEvents");
  if (storeFault) return { ok: false, rejections: [storeFault] };
  const scopeFault = requireRegistryScope(scope);
  if (scopeFault) return { ok: false, rejections: [scopeFault] };

  const queried = store.queryRegistryEvents(scope, { event_class: "FINDING" }, base);
  if (!queried.ok) return { ok: false, rejections: queried.rejections };

  // Group by finding_id in first-seen (append) order — deterministic for a
  // given log content.
  const byFinding = new Map<string, GovdispEvent[]>();
  for (const event of queried.events) {
    if (event.event_class !== "FINDING") continue;
    const bucket = byFinding.get(event.finding_id) ?? [];
    bucket.push(event);
    byFinding.set(event.finding_id, bucket);
  }

  const activeFindingIds: string[] = [];
  const inactiveFindingIds: string[] = [];
  for (const [findingId, events] of byFinding) {
    const state = summarizeFindingEvents(findingId, events);
    if (state.active) activeFindingIds.push(findingId);
    else inactiveFindingIds.push(findingId);
  }

  return {
    ok: true,
    count: activeFindingIds.length,
    active_finding_ids: activeFindingIds,
    inactive_finding_ids: inactiveFindingIds
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
    getHarnessProbeMatrix: (input: HarnessProbeInput = {}) => getHarnessProbeMatrix(input, repository),
    getOnboardingPlan: (input: OnboardingPlanInput = {}) => getOnboardingPlan(input, repository),
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
    getRoleCard: (role_id: string) => getRoleCard(role_id, repository),
    getRuntimeNotice,
    exportProtocolSnapshot: () => exportProtocolSnapshot(repository),
    getMissionFrontrunPack: (input: MissionFrontrunInput) => getMissionFrontrunPack(input, repository),
    evaluateEscalationGate,
    validateRemediationPacket: (packet: Record<string, unknown>) => validateRemediationPacket(packet, repository),
    validateFallbackContract,
    validateSuccessorContract,
    validateOutageHandoff,
    validateClosureIndependence,
    validateEvidenceClassification,
    isVerdictClassArtifact,
    validateCommitGate,
    validateControlRecipe,
    validateHarnessControlRecipe,
    validateDeliveryVerification,
    validateAuthorityAction,
    evaluateBlockedPodRollover,
    evaluateSliceHealth,
    evaluateOversizedSliceSentinel,
    evaluateQaTimeoutSentinel,
    evaluateSpecDefectSentinel,
    validateBringUpPlan,
    appendGovdispEvent,
    queryGovdispEvents,
    deriveAttemptAccounting,
    evaluateAttemptCeiling,
    deriveMetaGovernanceDepth,
    evaluateMetaGovernanceDepth,
    deriveOverheadAccounting,
    evaluateOverheadBudget,
    recordBudgetExhaustion,
    appendGovernanceOverheadEvent,
    deriveFindingState,
    evaluateFindingClosure,
    countActiveFindings
  };
}
