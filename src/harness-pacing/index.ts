/**
 * harness-pacing — public module export surface.
 *
 * Consumers import from "odin/harness-pacing" or directly from this file.
 * All public types and functions are re-exported here; nothing else is public.
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
