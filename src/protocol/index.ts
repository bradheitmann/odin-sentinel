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
  validateBootReceipt,
  validateBringUpPlan,
  validateAuthorityAction,
  validateClosureIndependence,
  validateControlRecipe,
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
  ValidationResult
} from "./service.js";

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
