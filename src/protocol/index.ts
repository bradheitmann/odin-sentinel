export {
  GOVERNED_CONTEXT_PROOF_SCHEMA,
  VERSION,
  classifyGovernedReadiness,
  createProtocolService,
  exportProtocolSnapshot,
  getActivationGates,
  getCloseoutChecklist,
  getDelegationPacket,
  getOnboardingPlan,
  getRoleProfile,
  getRuntimeNotice,
  getStartupPacket,
  harnessCategory,
  evaluateBlockedPodRollover,
  evaluateEscalationGate,
  evaluateSliceHealth,
  evaluateOversizedSliceSentinel,
  evaluateQaTimeoutSentinel,
  evaluateSpecDefectSentinel,
  validateBootReceipt,
  validateBringUpPlan,
  validateAuthorityAction,
  validateClosureIndependence,
  validateControlRecipe,
  validateHarnessControlRecipe,
  validateDeliveryVerification,
  validateCommitGate,
  validateFallbackContract,
  validateOutageHandoff,
  validateRemediationPacket,
  validateSuccessorContract,
  validateCmuxDeliveryProof,
  validateDelegationPacket,
  validateGovernedContextProof,
  validateInstructionReadProof,
  validateTeamManifest
} from "./service.js";

export type {
  AssuranceLevel,
  CloseoutMode,
  DelegationPacketInput,
  GovernedReadinessInput,
  GovernedReadinessResult,
  GovernedReadinessState,
  HarnessCategory,
  ProtocolData,
  RuntimeNotice,
  StartupPacket,
  StartupPacketInput,
  ValidationResult,
  SentinelSignal
} from "./service.js";

// STORY-GOVTRUTH-R1 — canonical role identity. Exported so direct library
// consumers and the MCP boundary reach the SAME classification the authority
// gates use, rather than re-deriving one per surface.
export {
  RATIFIED_COMMIT_ISSUER_SLOTS,
  ROSTER_MUTATION_AUTHORITY_SLOTS,
  canonicalRoleSlot,
  describeRoleSlotInput,
  hasExecutiveAuthority,
  hasRosterMutationAuthority,
  isHighAuthorityRole,
  parseRoleSlot,
  roleKindOf,
  roleSlotsEqual
} from "./role-identity.js";

export type { ParsedRoleSlot } from "./role-identity.js";

export {
  computeSurfaceLayout,
  computeSurfaceLayoutGate,
  getSubstrateCapability,
  renderSurfaceLayoutAscii
} from "./surface-layout.js";

export type {
  SurfaceLayout,
  SurfaceLayoutColumn,
  SurfaceLayoutSurface,
  SurfaceLayoutGate
} from "./surface-layout.js";

// New types for SCP performance/portability program (E1-E5 unblocking)
// CapabilityFlag is exported as a value (runtime const) and as a type via the same export.
export { CapabilityFlag } from "./schemas.js";

export type {
  BootReceipt,
  DeliveryReceiptPacingExtension,
  HarnessPacingEvent,
  PacingEventType,
  PromptBudgetClass,
  ReceiptType,
  SubstrateCapability,
  SubstrateType,
  WakeState,
  WakeVerdict
} from "./schemas.js";
