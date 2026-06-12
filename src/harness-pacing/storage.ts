/**
 * Storage layer for harness pacing profiles and events.
 *
 * Runtime profile directory: .odin/harness-pacing/<harness_id>/profile.json
 * Events store METADATA ONLY — prompt_text_stored: false at all times.
 *
 * Pure logic is separated from fs I/O so unit tests can stub the fs layer.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { HarnessProfile } from "./schema.js";
import type { HarnessPacingEvent } from "../protocol/schemas.js";

/** Default runtime profile base — kept outside audit-reserved local state paths. */
export const LOCAL_PROFILE_BASE = ".odin/harness-pacing";

/** Absolute path to the profile JSON for a given harness_id. */
export function getProfilePath(harness_id: string, base = LOCAL_PROFILE_BASE): string {
  return join(base, harness_id, "profile.json");
}

/**
 * Build the initial empty profile for a harness_id.
 * Exported for testability — callers that need a blank slate can use this
 * rather than re-constructing the default shape by hand.
 */
export function buildDefaultProfile(harness_id: string): HarnessProfile {
  return {
    harness_id,
    version: "1.0",
    last_updated: new Date().toISOString(),
    samples_total: 0,
    events: [],
    crash_signatures: [],
    recommended: {
      harness_id,
      max_word_bucket: "0-100 words",
      min_idle_wait_seconds: 3,
      slash_command_bundling: "unknown",
      multi_phase_prompting: "unknown",
      notes: "No data yet — using conservative defaults",
    },
  };
}

/**
 * Read the local runtime profile for harness_id.
 * Returns null when no profile exists (never throws).
 */
export function readProfile(
  harness_id: string,
  base = LOCAL_PROFILE_BASE,
  fsRead: typeof readFileSync = readFileSync,
  fsExists: typeof existsSync = existsSync
): HarnessProfile | null {
  const path = getProfilePath(harness_id, base);
  if (!fsExists(path)) return null;
  try {
    return JSON.parse(fsRead(path, "utf8") as string) as HarnessProfile;
  } catch {
    return null;
  }
}

/**
 * Append a pacing event to the local runtime profile for the event's harness_id.
 * Creates the profile directory and file if they do not exist.
 * Crash events: adds crash_signature_hash to the profile's crash_signatures list.
 */
export function appendEvent(
  event: HarnessPacingEvent,
  base = LOCAL_PROFILE_BASE,
  fsRead: typeof readFileSync = readFileSync,
  fsExists: typeof existsSync = existsSync,
  fsWrite: typeof writeFileSync = writeFileSync,
  fsMkdir: typeof mkdirSync = mkdirSync
): void {
  const dir = join(base, event.harness_id);
  fsMkdir(dir, { recursive: true });

  const existing = readProfile(event.harness_id, base, fsRead, fsExists) ?? buildDefaultProfile(event.harness_id);

  existing.events.push(event);
  existing.samples_total = existing.events.length;
  existing.last_updated = new Date().toISOString();

  if (
    event.crash_signature_hash &&
    !existing.crash_signatures.includes(event.crash_signature_hash)
  ) {
    existing.crash_signatures.push(event.crash_signature_hash);
  }

  const path = getProfilePath(event.harness_id, base);
  fsWrite(path, JSON.stringify(existing, null, 2), "utf8");
}
