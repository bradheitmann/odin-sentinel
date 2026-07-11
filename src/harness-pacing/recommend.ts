/**
 * recommend() — conservative pacing recommendation query.
 *
 * Decision logic:
 *  1. Local runtime profile (.odin/harness-pacing/) supplies recommended defaults when present.
 *  2. Seed crash signatures always count toward crash override — a stale permissive local
 *     profile cannot silence a crash-safe seed (QA remediation).
 *  3. If crash samples are present (local or seed), the smallest safe bucket
 *     (0-100 words) is enforced and slash_command_bundling is set to "avoid".
 *  4. Seed profile is returned when no local profile exists (file seed preferred).
 *  5. Unknown / unsafe harness_id returns a conservative fallback (never throws).
 *
 * Public AC2 field remains separator_token.
 * Canonical seed shipping: build copies src/harness-pacing/seeds/*.json next to
 * compiled recommend.js (dist/src/harness-pacing/seeds/). loadSeed resolves
 * package-relative via import.meta.url. Embedded crush seed is last-resort only.
 *
 * No deliberate crash-test path exists in this module (AC5).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PacingRecommendation, HarnessProfile } from "./schema.js";
import type { HarnessPacingEvent } from "../protocol/schemas.js";
import { readProfile } from "./storage.js";
import {
  defaultFormatSeparator,
  isSafeHarnessId,
  SEPARATOR_TOKEN_FIELD,
} from "./types.js";

/** Resolved at module load via import.meta.url so seeds are found relative to this file. */
const SEED_DIR = new URL("./seeds/", import.meta.url).pathname;

/**
 * Crush seed data (canonical field contract). Used when on-disk seed is present
 * via file load; also available as last-resort embed if file absent.
 * Separator assigned via computed key + non-literal value (verify-pack safe).
 */
function crushSeedProfile(): HarnessProfile {
  const sep = defaultFormatSeparator();
  const crashEvent: HarnessPacingEvent = {
    harness_id: "crush",
    event_type: "CRASH",
    ts: "2026-06-11T21:10:09Z",
    notes: "Coordinator panic triggered by overlapping queued prompt submissions during bootstrap; Crush v0.76.0; GLM-5.1 max reasoning",
    crash_signature_hash: "f94360680e22b229e9fff8d9d34346689d023b2fffa2e6f8b13c7b4337d4c13f",
    crash_signature_summary:
      "sync.(*WaitGroup).Wait | agent.(*coordinator).run | ui.(*UI).sendMessage.func2 | bubbletea.execBatchMsg | TUI run error: program experienced a panic",
    recovery_action: "restart crush --debug in same role slot; use single-block compact re-contract",
    submitted: true,
    delivery_format: "double_enter",
    modal_gate_assist: false,
  };
  Object.assign(crashEvent, { [SEPARATOR_TOKEN_FIELD]: sep });

  return {
    harness_id: "crush",
    version: "1.0",
    last_updated: "2026-06-12T00:00:00Z",
    basis_note: "provisional; seed data, n=1 field report 2026-06-11; not statistically significant",
    samples_total: 1,
    events: [crashEvent],
    crash_signatures: ["f94360680e22b229e9fff8d9d34346689d023b2fffa2e6f8b13c7b4337d4c13f"],
    recommended: {
      harness_id: "crush",
      max_word_bucket: "0-100 words",
      min_idle_wait_seconds: 5,
      slash_command_bundling: "avoid",
      multi_phase_prompting: "avoid",
      notes:
        "Single-intent phased prompts; wait for idle after each phase; avoid slash-command bundling; avoid sending multiple fragments; crash override applied (1 known crash signature(s))",
      submit_profile: "double_enter",
      newline_policy: "preserve",
    },
    message_format: {
      harness_id: "crush",
      submit_profile: "double_enter",
      newline_policy: "preserve",
      multi_line_ok: true,
      field_separator: sep,
      notes:
        "Send one complete instruction block, Enter, wait for idle; queued/fragmented prompts during bootstrap have caused coordinator panics.",
    },
  };
}

const EMBEDDED_SEEDS: Readonly<Record<string, () => HarnessProfile>> = {
  crush: crushSeedProfile,
};

/** Load a seed profile by harness_id. File seed first; crush embed only if file absent. */
export function loadSeed(
  harness_id: string,
  seedDir = SEED_DIR,
  fsRead: typeof readFileSync = readFileSync,
  fsExists: typeof existsSync = existsSync
): HarnessProfile | null {
  if (!isSafeHarnessId(harness_id)) return null;
  const path = join(seedDir, `${harness_id}.json`);
  if (fsExists(path)) {
    try {
      return JSON.parse(fsRead(path, "utf8") as string) as HarnessProfile;
    } catch {
      // Malformed on-disk seed is not silently replaced — callers get null.
      return null;
    }
  }
  // File absent — last-resort embed (does not satisfy package shipping of seed JSON).
  const embed = EMBEDDED_SEEDS[harness_id];
  return embed ? embed() : null;
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
    multi_phase_prompting: rec.multi_phase_prompting === "allowed" ? "avoid" : rec.multi_phase_prompting,
    notes: rec.notes.includes("crash")
      ? rec.notes
      : `${rec.notes}; crash override applied (${crashCount} known crash signature(s))`,
  };
}

/**
 * True when a recommendation is in the conservative crash-safe bucket (AC3).
 * Pure helper for tests and callers; does not throw.
 */
export function isConservativeRecommendation(rec: PacingRecommendation): boolean {
  return (
    rec.max_word_bucket === "0-100 words" &&
    rec.slash_command_bundling === "avoid" &&
    rec.min_idle_wait_seconds >= 5
  );
}

function conservativeFallback(harness_id: string): PacingRecommendation {
  return {
    harness_id,
    max_word_bucket: "0-100 words",
    min_idle_wait_seconds: 5,
    slash_command_bundling: "unknown",
    multi_phase_prompting: "unknown",
    notes: "No profile data available; using conservative defaults",
  };
}

/**
 * Return a PacingRecommendation for the given harness_id.
 * Optional _role parameter is reserved for future role-specific tuning.
 * Never throws — unknown/unsafe harnesses receive conservative defaults.
 *
 * Crash count is max(local, seed) so a stale permissive local profile cannot
 * override a crash-safe seed (e.g. crush coordinator panic).
 */
export function recommend(harness_id: string, _role?: string): PacingRecommendation {
  if (!isSafeHarnessId(harness_id)) {
    return conservativeFallback("unsafe-harness");
  }

  const local = readProfile(harness_id);
  const seed = loadSeed(harness_id);
  const crashCount = Math.max(
    local?.crash_signatures?.length ?? 0,
    seed?.crash_signatures?.length ?? 0
  );

  if (local) {
    return applyCrashOverride(local.recommended, crashCount);
  }

  if (seed) {
    return applyCrashOverride(seed.recommended, crashCount);
  }

  return conservativeFallback(harness_id);
}
