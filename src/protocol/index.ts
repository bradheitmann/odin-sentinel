export {
  VERSION,
  createProtocolService,
  exportProtocolSnapshot,
  getCloseoutChecklist,
  getDelegationPacket,
  getRoleProfile,
  getRuntimeNotice,
  getStartupPacket,
  validateBootReceipt,
  validateDelegationPacket,
  validateTeamManifest
} from "./service.js";

export type {
  CloseoutMode,
  DelegationPacketInput,
  ProtocolData,
  RuntimeNotice,
  StartupPacket,
  StartupPacketInput,
  ValidationResult
} from "./service.js";

export {
  computeSurfaceLayout,
  computeSurfaceLayoutGate,
  renderSurfaceLayoutAscii
} from "./surface-layout.js";

export type {
  SurfaceLayout,
  SurfaceLayoutColumn,
  SurfaceLayoutSurface,
  SurfaceLayoutGate
} from "./surface-layout.js";
