/**
 * harness-pacing — module export surface (internal).
 *
 * This module is internal: package.json has no "./harness-pacing" export, so consumers
 * outside this repository cannot import it. In-repo code imports from this file. All of the
 * module's shared types and functions are re-exported here.
 */

// Types
export type { HarnessProfile, PacingRecommendation } from "./schema.js";

// Re-exported protocol types (canonical definitions live in protocol/schemas.ts)
export type { HarnessPacingEvent, PacingEventType } from "../protocol/schemas.js";

// Storage layer
export {
  getProfilePath,
  buildDefaultProfile,
  readProfile,
  appendEvent,
  LOCAL_PROFILE_BASE,
} from "./storage.js";

// Recommendation engine
export { recommend, loadSeed, applyCrashOverride } from "./recommend.js";
