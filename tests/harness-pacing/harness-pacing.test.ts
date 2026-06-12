import { describe, expect, it, vi } from "vitest";
import type { HarnessPacingEvent } from "../../src/protocol/schemas.js";
import type { HarnessProfile } from "../../src/harness-pacing/schema.js";
import {
  buildDefaultProfile,
  readProfile,
  appendEvent,
  getProfilePath,
  LOCAL_PROFILE_BASE,
} from "../../src/harness-pacing/storage.js";
import {
  recommend,
  loadSeed,
  applyCrashOverride,
} from "../../src/harness-pacing/recommend.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCrashEvent(harness_id: string, hash: string): HarnessPacingEvent {
  return {
    harness_id,
    event_type: "CRASH",
    ts: "2026-06-11T21:10:09Z",
    crash_signature_hash: hash,
    crash_signature_summary: "test panic",
    recovery_action: "restart",
  };
}

function makePromptEvent(harness_id: string): HarnessPacingEvent {
  return {
    harness_id,
    event_type: "PROMPT_DELIVERY",
    ts: "2026-06-12T00:00:00Z",
    payload_bytes: 256,
  };
}

// ---------------------------------------------------------------------------
// buildDefaultProfile
// ---------------------------------------------------------------------------

describe("buildDefaultProfile", () => {
  it("returns a profile with correct harness_id and zero samples", () => {
    const p = buildDefaultProfile("crush");
    expect(p.harness_id).toBe("crush");
    expect(p.samples_total).toBe(0);
    expect(p.events).toHaveLength(0);
    expect(p.crash_signatures).toHaveLength(0);
  });

  it("recommended uses conservative unknown bundling", () => {
    const p = buildDefaultProfile("new-harness");
    expect(p.recommended.slash_command_bundling).toBe("unknown");
    expect(p.recommended.max_word_bucket).toBe("0-100 words");
  });
});

// ---------------------------------------------------------------------------
// getProfilePath
// ---------------------------------------------------------------------------

describe("getProfilePath", () => {
  it("produces the correct path under the default base", () => {
    const path = getProfilePath("crush");
    expect(path).toBe(`${LOCAL_PROFILE_BASE}/crush/profile.json`);
  });

  it("accepts a custom base", () => {
    const path = getProfilePath("glm-droid", "/tmp/odin-test");
    expect(path).toBe("/tmp/odin-test/glm-droid/profile.json");
  });
});

// ---------------------------------------------------------------------------
// readProfile — fs-stubbed
// ---------------------------------------------------------------------------

describe("readProfile", () => {
  it("returns null for a path that does not exist", () => {
    const fsExists = vi.fn().mockReturnValue(false);
    const fsRead = vi.fn();
    const result = readProfile("unknown-harness-xyz", "/tmp/fake-base", fsRead as never, fsExists);
    expect(result).toBeNull();
    expect(fsRead).not.toHaveBeenCalled();
  });

  it("returns null when JSON parse fails", () => {
    const fsExists = vi.fn().mockReturnValue(true);
    const fsRead = vi.fn().mockReturnValue("not-valid-json{{{");
    const result = readProfile("crush", "/tmp/fake-base", fsRead as never, fsExists);
    expect(result).toBeNull();
  });

  it("returns parsed profile when file exists and is valid JSON", () => {
    const profile = buildDefaultProfile("crush");
    const fsExists = vi.fn().mockReturnValue(true);
    const fsRead = vi.fn().mockReturnValue(JSON.stringify(profile));
    const result = readProfile("crush", "/tmp/fake-base", fsRead as never, fsExists);
    expect(result).not.toBeNull();
    expect(result!.harness_id).toBe("crush");
  });
});

// ---------------------------------------------------------------------------
// appendEvent — fs-stubbed
// ---------------------------------------------------------------------------

describe("appendEvent", () => {
  it("creates a new profile and increments samples_total", () => {
    const written: string[] = [];
    const fsExists = vi.fn().mockReturnValue(false);
    const fsRead = vi.fn();
    const fsWrite = vi.fn().mockImplementation((_p: string, data: string) => written.push(data));
    const fsMkdir = vi.fn();

    appendEvent(
      makePromptEvent("crush"),
      "/tmp/fake-base",
      fsRead as never,
      fsExists,
      fsWrite as never,
      fsMkdir as never
    );

    expect(fsMkdir).toHaveBeenCalledWith("/tmp/fake-base/crush", { recursive: true });
    expect(written).toHaveLength(1);
    const saved = JSON.parse(written[0]) as HarnessProfile;
    expect(saved.samples_total).toBe(1);
    expect(saved.events).toHaveLength(1);
  });

  it("appends to an existing profile", () => {
    const existing = buildDefaultProfile("crush");
    existing.events.push(makePromptEvent("crush"));
    existing.samples_total = 1;

    const written: string[] = [];
    const fsExists = vi.fn().mockReturnValue(true);
    const fsRead = vi.fn().mockReturnValue(JSON.stringify(existing));
    const fsWrite = vi.fn().mockImplementation((_p: string, data: string) => written.push(data));
    const fsMkdir = vi.fn();

    appendEvent(
      makePromptEvent("crush"),
      "/tmp/fake-base",
      fsRead as never,
      fsExists,
      fsWrite as never,
      fsMkdir as never
    );

    const saved = JSON.parse(written[0]) as HarnessProfile;
    expect(saved.samples_total).toBe(2);
    expect(saved.events).toHaveLength(2);
  });

  it("adds crash_signature_hash to crash_signatures (no duplicates)", () => {
    const written: string[] = [];
    const fsExists = vi.fn().mockReturnValue(false);
    const fsRead = vi.fn();
    const fsWrite = vi.fn().mockImplementation((_p: string, data: string) => written.push(data));
    const fsMkdir = vi.fn();

    const hash = "f94360680e22b229e9fff8d9d34346689d023b2fffa2e6f8b13c7b4337d4c13f";
    appendEvent(
      makeCrashEvent("crush", hash),
      "/tmp/fake-base",
      fsRead as never,
      fsExists,
      fsWrite as never,
      fsMkdir as never
    );

    const saved = JSON.parse(written[0]) as HarnessProfile;
    expect(saved.crash_signatures).toContain(hash);
    expect(saved.crash_signatures).toHaveLength(1);
  });

  it("does not duplicate a crash_signature_hash already in the profile", () => {
    const hash = "f94360680e22b229e9fff8d9d34346689d023b2fffa2e6f8b13c7b4337d4c13f";
    const existing = buildDefaultProfile("crush");
    existing.crash_signatures.push(hash);

    const written: string[] = [];
    const fsExists = vi.fn().mockReturnValue(true);
    const fsRead = vi.fn().mockReturnValue(JSON.stringify(existing));
    const fsWrite = vi.fn().mockImplementation((_p: string, data: string) => written.push(data));
    const fsMkdir = vi.fn();

    appendEvent(
      makeCrashEvent("crush", hash),
      "/tmp/fake-base",
      fsRead as never,
      fsExists,
      fsWrite as never,
      fsMkdir as never
    );

    const saved = JSON.parse(written[0]) as HarnessProfile;
    expect(saved.crash_signatures).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// applyCrashOverride
// ---------------------------------------------------------------------------

describe("applyCrashOverride", () => {
  it("returns recommendation unchanged when crashCount is 0", () => {
    const rec = buildDefaultProfile("cmux").recommended;
    const result = applyCrashOverride(rec, 0);
    expect(result).toEqual(rec);
  });

  it("forces smallest bucket and avoid bundling when crashes > 0", () => {
    const rec = {
      harness_id: "test",
      max_word_bucket: "501-1000 words",
      min_idle_wait_seconds: 2,
      slash_command_bundling: "allowed" as const,
      multi_phase_prompting: "allowed" as const,
      notes: "nominal",
    };
    const result = applyCrashOverride(rec, 1);
    expect(result.max_word_bucket).toBe("0-100 words");
    expect(result.slash_command_bundling).toBe("avoid");
    expect(result.min_idle_wait_seconds).toBeGreaterThanOrEqual(5);
  });

  it("does not duplicate crash note when already present", () => {
    const rec = {
      harness_id: "crush",
      max_word_bucket: "0-100 words",
      min_idle_wait_seconds: 5,
      slash_command_bundling: "avoid" as const,
      multi_phase_prompting: "avoid" as const,
      notes: "crash override applied",
    };
    const result = applyCrashOverride(rec, 2);
    expect(result.notes).not.toMatch(/crash.*crash/);
  });
});

// ---------------------------------------------------------------------------
// loadSeed
// ---------------------------------------------------------------------------

describe("loadSeed", () => {
  it("returns null for a seed directory that lacks the requested harness", () => {
    const fsExists = vi.fn().mockReturnValue(false);
    const fsRead = vi.fn();
    const result = loadSeed("nonexistent", "/tmp/seeds", fsRead as never, fsExists);
    expect(result).toBeNull();
  });

  it("returns null when seed JSON is malformed", () => {
    const fsExists = vi.fn().mockReturnValue(true);
    const fsRead = vi.fn().mockReturnValue("{bad json");
    const result = loadSeed("crush", "/tmp/seeds", fsRead as never, fsExists);
    expect(result).toBeNull();
  });

  it("returns parsed seed when valid", () => {
    const seed = buildDefaultProfile("crush");
    const fsExists = vi.fn().mockReturnValue(true);
    const fsRead = vi.fn().mockReturnValue(JSON.stringify(seed));
    const result = loadSeed("crush", "/tmp/seeds", fsRead as never, fsExists);
    expect(result).not.toBeNull();
    expect(result!.harness_id).toBe("crush");
  });
});

// ---------------------------------------------------------------------------
// recommend() — integration against real seed files
// ---------------------------------------------------------------------------

describe("recommend() against real seed files", () => {
  it("crush: returns slash_command_bundling='avoid' and min_idle_wait_seconds > 0", () => {
    const rec = recommend("crush");
    expect(rec.slash_command_bundling).toBe("avoid");
    expect(rec.min_idle_wait_seconds).toBeGreaterThan(0);
    expect(rec.harness_id).toBe("crush");
  });

  it("glm-droid: returns a valid PacingRecommendation", () => {
    const rec = recommend("glm-droid");
    expect(rec.harness_id).toBe("glm-droid");
    expect(rec.max_word_bucket).toBeTruthy();
    expect(typeof rec.min_idle_wait_seconds).toBe("number");
    expect(["allowed", "avoid", "unknown"]).toContain(rec.slash_command_bundling);
    expect(["allowed", "avoid", "unknown"]).toContain(rec.multi_phase_prompting);
  });

  it("cmux: returns a valid PacingRecommendation", () => {
    const rec = recommend("cmux");
    expect(rec.harness_id).toBe("cmux");
    expect(rec.max_word_bucket).toBeTruthy();
    expect(typeof rec.min_idle_wait_seconds).toBe("number");
    expect(["allowed", "avoid", "unknown"]).toContain(rec.slash_command_bundling);
  });

  it("unknown harness: returns conservative fallback without throwing", () => {
    const rec = recommend("unknown-harness-xyz");
    expect(rec.harness_id).toBe("unknown-harness-xyz");
    expect(rec.max_word_bucket).toBe("0-100 words");
    expect(rec.min_idle_wait_seconds).toBeGreaterThanOrEqual(5);
    expect(rec.slash_command_bundling).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Seed file structural assertions (no private data)
// ---------------------------------------------------------------------------

describe("crush seed profile integrity", () => {
  it("contains at least one event with crash_signature_hash", async () => {
    const { default: seed } = await import("../../src/harness-pacing/seeds/crush.json", {
      assert: { type: "json" },
    });
    const crushSeed = seed as HarnessProfile;
    expect(crushSeed.crash_signatures.length).toBeGreaterThan(0);
    const hasHash = crushSeed.events.some(
      (e) => (e as HarnessPacingEvent & { crash_signature_hash?: string }).crash_signature_hash
    );
    expect(hasHash).toBe(true);
  });

  it("crash_signature_hash in events matches crash_signatures list", async () => {
    const { default: seed } = await import("../../src/harness-pacing/seeds/crush.json", {
      assert: { type: "json" },
    });
    const crushSeed = seed as HarnessProfile;
    for (const ev of crushSeed.events) {
      const event = ev as HarnessPacingEvent & { crash_signature_hash?: string };
      if (event.crash_signature_hash) {
        expect(crushSeed.crash_signatures).toContain(event.crash_signature_hash);
      }
    }
  });

  it("seed files contain no absolute paths or secret patterns", async () => {
    const [{ default: crush }, { default: glmDroid }, { default: cmux }] = await Promise.all([
      import("../../src/harness-pacing/seeds/crush.json", { assert: { type: "json" } }),
      import("../../src/harness-pacing/seeds/glm-droid.json", { assert: { type: "json" } }),
      import("../../src/harness-pacing/seeds/cmux.json", { assert: { type: "json" } }),
    ]);

    const forbidden = ["/Users/", "/home/", "api_key", "secret", "password", "sk-", "prompt_text"];
    for (const [name, seed] of [["crush", crush], ["glm-droid", glmDroid], ["cmux", cmux]] as const) {
      const raw = JSON.stringify(seed).toLowerCase();
      for (const pattern of forbidden) {
        expect(raw, `${name} seed must not contain '${pattern}'`).not.toContain(pattern.toLowerCase());
      }
    }
  });
});
