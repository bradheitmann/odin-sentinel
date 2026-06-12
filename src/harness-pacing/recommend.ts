/**
 * recommend() — conservative pacing recommendation query.
 *
 * Decision logic:
 *  1. Local runtime profile (.odin/harness-pacing/) takes precedence over seeds.
 *  2. If crash samples are present in the local profile, the smallest safe bucket
 *     (0-100 words) is enforced and slash_command_bundling is set to "avoid".
 *  3. Seed profile is returned when no local profile exists.
 *  4. Unknown harness_id returns a conservative fallback (never throws).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PacingRecommendation, HarnessProfile } from "./schema.js";
import { readProfile } from "./storage.js";

/** Resolved at module load via import.meta.url so seeds are found relative to this file. */
const SEED_DIR = new URL("./seeds/", import.meta.url).pathname;

/** Load a seed profile by harness_id. Returns null when no seed exists. */
export function loadSeed(
  harness_id: string,
  seedDir = SEED_DIR,
  fsRead: typeof readFileSync = readFileSync,
  fsExists: typeof existsSync = existsSync
): HarnessProfile | null {
  const path = join(seedDir, `${harness_id}.json`);
  if (!fsExists(path)) return null;
  try {
    return JSON.parse(fsRead(path, "utf8") as string) as HarnessProfile;
  } catch {
    return null;
  }
}

/**
 * Apply conservative crash override: when a profile has crash signatures the
 * recommendation must use the smallest safe bucket, longest safe wait, and
 * must mark slash-command bundling as "avoid".
 *
 * This function is pure and exported for unit testing.
 */
export function applyCrashOverride(rec: PacingRecommendation, crashCount: number): PacingRecommendation {
  if (crashCount === 0) return rec;
  return {
    ...rec,
    max_word_bucket: "0-100 words",
    min_idle_wait_seconds: Math.max(rec.min_idle_wait_seconds, 5),
    slash_command_bundling: "avoid",
    notes: rec.notes.includes("crash")
      ? rec.notes
      : `${rec.notes}; crash override applied (${crashCount} known crash signature(s))`,
  };
}

/**
 * Return a PacingRecommendation for the given harness_id.
 * Optional _role parameter is reserved for future role-specific tuning.
 * Never throws — unknown harnesses receive conservative defaults.
 */
export function recommend(harness_id: string, _role?: string): PacingRecommendation {
  // 1. Local profile takes precedence over seed.
  const local = readProfile(harness_id);
  if (local) {
    return applyCrashOverride(local.recommended, local.crash_signatures.length);
  }

  // 2. Seed profile.
  const seed = loadSeed(harness_id);
  if (seed) {
    return applyCrashOverride(seed.recommended, seed.crash_signatures.length);
  }

  // 3. Conservative fallback for unknown harnesses — never throws.
  return {
    harness_id,
    max_word_bucket: "0-100 words",
    min_idle_wait_seconds: 5,
    slash_command_bundling: "unknown",
    multi_phase_prompting: "unknown",
    notes: "No profile data available; using conservative defaults",
  };
}
