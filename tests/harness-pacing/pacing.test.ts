/**
 * SLICE-FIELD-E037-DEV-001 focused tests — submit/format/crash field contract.
 * No deliberate crash-test path (AC5): tests only inspect types and data.
 * Public AC2 field name remains separator_token.
 */
import { describe, expect, it, vi } from "vitest";
import type { HarnessProfile, PacingRecommendation } from "../../src/harness-pacing/schema.js";
import {
  CONFIRMED_PRESENT_FIELDS,
  PACING_EVENT_TYPE_CRASH,
  SEPARATOR_TOKEN_FIELD,
  defaultFormatSeparator,
  deliveryStateFromSubmitted,
  isCrashEventType,
  isSafeHarnessId,
  normalizeEventFormatFields,
  type HarnessPacingEventE037,
} from "../../src/harness-pacing/types.js";
import {
  appendEvent,
  buildDefaultProfile,
  isValidHarnessProfile,
  readProfile,
} from "../../src/harness-pacing/storage.js";
import {
  applyCrashOverride,
  isConservativeRecommendation,
  loadSeed,
  recommend,
} from "../../src/harness-pacing/recommend.js";

const SEP = defaultFormatSeparator();

describe("AC1: enter_delivered vs input_bar_only", () => {
  it("maps submitted=true to enter_delivered", () => {
    expect(deliveryStateFromSubmitted(true)).toBe("enter_delivered");
  });

  it("maps submitted=false to input_bar_only", () => {
    expect(deliveryStateFromSubmitted(false)).toBe("input_bar_only");
  });

  it("maps missing submitted to undefined", () => {
    expect(deliveryStateFromSubmitted(undefined)).toBeUndefined();
  });

  it("HarnessPacingEvent carries submitted field (confirmed-present)", () => {
    const event: HarnessPacingEventE037 = {
      harness_id: "crush",
      event_type: "PROMPT_DELIVERY",
      ts: "2026-07-11T00:00:00Z",
      submitted: false,
    };
    expect(event.submitted).toBe(false);
    expect(deliveryStateFromSubmitted(event.submitted)).toBe("input_bar_only");
    expect(CONFIRMED_PRESENT_FIELDS.ac1_enter_vs_input_bar).toBe("submitted");
  });
});

describe("AC2: format fields (public separator_token contract)", () => {
  it("accepts explicit delivery_format, separator_token, modal_gate_assist", () => {
    const event = {
      harness_id: "crush",
      event_type: "PROMPT_DELIVERY" as const,
      ts: "2026-07-11T00:00:00Z",
      delivery_format: "double_enter",
      modal_gate_assist: true,
    } as HarnessPacingEventE037;
    Object.assign(event, { [SEPARATOR_TOKEN_FIELD]: SEP });
    expect(event.delivery_format).toBe("double_enter");
    expect(event.separator_token).toBe(SEP);
    expect(event.modal_gate_assist).toBe(true);
    expect(SEPARATOR_TOKEN_FIELD).toBe("separator_token");
  });

  it("normalizes delivery_format and separator_token from message_format", () => {
    const event: HarnessPacingEventE037 = {
      harness_id: "crush",
      event_type: "PROMPT_DELIVERY",
      ts: "2026-07-11T00:00:00Z",
      message_format: {
        harness_id: "crush",
        submit_profile: "single_line_flatten",
        newline_policy: "flatten_to_space",
        multi_line_ok: false,
        field_separator: SEP,
      },
    };
    const normalized = normalizeEventFormatFields(event);
    expect(normalized.delivery_format).toBe("single_line_flatten");
    expect(normalized.separator_token).toBe(SEP);
  });

  it("appendEvent stores normalized format fields", () => {
    const written: string[] = [];
    const fsExists = vi.fn().mockReturnValue(false);
    const fsRead = vi.fn();
    const fsWrite = vi.fn().mockImplementation((_p: string, data: string) => written.push(data));
    const fsMkdir = vi.fn();

    appendEvent(
      {
        harness_id: "crush",
        event_type: "PROMPT_DELIVERY",
        ts: "2026-07-11T00:00:00Z",
        submitted: true,
        message_format: {
          harness_id: "crush",
          submit_profile: "double_enter",
          newline_policy: "preserve",
          multi_line_ok: true,
          field_separator: SEP,
        },
        modal_gate_assist: false,
      },
      "/tmp/fake-e037-base",
      fsRead as never,
      fsExists,
      fsWrite as never,
      fsMkdir as never
    );

    const saved = JSON.parse(written[0]) as HarnessProfile;
    const stored = saved.events[0] as HarnessPacingEventE037;
    expect(stored.delivery_format).toBe("double_enter");
    expect(stored.separator_token).toBe(SEP);
    expect(stored.modal_gate_assist).toBe(false);
    expect(stored.submitted).toBe(true);
  });
});

describe("AC3: crush coordinator panic seed and conservative recommend", () => {
  it("crush seed has coordinator-panic crash_signatures entry", async () => {
    const { default: seed } = await import("../../src/harness-pacing/seeds/crush.json", {
      assert: { type: "json" },
    });
    const crushSeed = seed as HarnessProfile;
    expect(crushSeed.crash_signatures.length).toBeGreaterThan(0);
    const panicEvent = crushSeed.events.find(
      (e) =>
        (e as HarnessPacingEventE037).event_type === "CRASH" &&
        String((e as HarnessPacingEventE037).crash_signature_summary ?? "").includes("coordinator")
    );
    expect(panicEvent).toBeDefined();
    expect(crushSeed.crash_signatures).toContain(
      (panicEvent as HarnessPacingEventE037).crash_signature_hash
    );
    // Public contract: parsed JSON key is separator_token
    expect((panicEvent as HarnessPacingEventE037).separator_token).toBe(SEP);
  });

  it("recommend('crush') returns conservative bucket", () => {
    const rec = recommend("crush");
    expect(rec.harness_id).toBe("crush");
    expect(rec.max_word_bucket).toBe("0-100 words");
    expect(rec.slash_command_bundling).toBe("avoid");
    expect(rec.min_idle_wait_seconds).toBeGreaterThanOrEqual(5);
    expect(isConservativeRecommendation(rec)).toBe(true);
  });
});

describe("AC4: CRASH type and crash_signature fields", () => {
  it("PacingEventType includes CRASH", () => {
    expect(PACING_EVENT_TYPE_CRASH).toBe("CRASH");
    expect(isCrashEventType("CRASH")).toBe(true);
    expect(isCrashEventType("PROMPT_DELIVERY")).toBe(false);
  });

  it("HarnessPacingEvent includes crash_signature fields", () => {
    const event: HarnessPacingEventE037 = {
      harness_id: "crush",
      event_type: "CRASH",
      ts: "2026-06-11T21:10:09Z",
      crash_signature_hash: "f94360680e22b229e9fff8d9d34346689d023b2fffa2e6f8b13c7b4337d4c13f",
      crash_signature_summary: "sync.(*WaitGroup).Wait | agent.(*coordinator).run",
    };
    expect(event.crash_signature_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.crash_signature_summary).toContain("coordinator");
    expect(CONFIRMED_PRESENT_FIELDS.ac4_crash_signature_hash).toBe("crash_signature_hash");
  });

  it("appendEvent records crash_signature_hash on the profile", () => {
    const written: string[] = [];
    const fsExists = vi.fn().mockReturnValue(false);
    const fsRead = vi.fn();
    const fsWrite = vi.fn().mockImplementation((_p: string, data: string) => written.push(data));
    const fsMkdir = vi.fn();
    const hash = "f94360680e22b229e9fff8d9d34346689d023b2fffa2e6f8b13c7b4337d4c13f";

    appendEvent(
      {
        harness_id: "crush",
        event_type: "CRASH",
        ts: "2026-06-11T21:10:09Z",
        crash_signature_hash: hash,
        crash_signature_summary: "coordinator panic",
      },
      "/tmp/fake-e037-crash",
      fsRead as never,
      fsExists,
      fsWrite as never,
      fsMkdir as never
    );

    const saved = JSON.parse(written[0]) as HarnessProfile;
    expect(saved.crash_signatures).toContain(hash);
  });
});

describe("AC5: no deliberate crash-test path", () => {
  it("harness-pacing recommend module does not export a deliberate crash-test API", async () => {
    const mod = await import("../../src/harness-pacing/recommend.js");
    const names = Object.keys(mod);
    expect(names).not.toContain("deliberateCrash");
    expect(names).not.toContain("crashTest");
    expect(names).not.toContain("forceCrash");
    expect(() => recommend("no-such-harness-e037")).not.toThrow();
  });

  it("buildDefaultProfile remains safe for empty harness ids used in tests", () => {
    const p = buildDefaultProfile("e037-safe");
    expect(p.crash_signatures).toEqual([]);
    expect(p.events).toEqual([]);
  });
});

describe("QA remediation surface 1: canonical AC2 fields on HarnessPacingEvent", () => {
  it("assigns delivery_format, separator_token, modal_gate_assist on the protocol type", () => {
    const event = {
      harness_id: "crush",
      event_type: "PROMPT_DELIVERY" as const,
      ts: "2026-07-11T00:00:00Z",
      delivery_format: "double_enter",
      modal_gate_assist: false,
    } as HarnessPacingEventE037;
    Object.assign(event, { [SEPARATOR_TOKEN_FIELD]: SEP });
    expect(CONFIRMED_PRESENT_FIELDS.ac2_delivery_format).toBe("delivery_format");
    expect(CONFIRMED_PRESENT_FIELDS.ac2_separator_field).toBe("separator_token");
    expect(CONFIRMED_PRESENT_FIELDS.ac2_modal_gate_assist).toBe("modal_gate_assist");
    expect(event).toHaveProperty("delivery_format");
    expect(event).toHaveProperty("separator_token");
    expect(event).toHaveProperty("modal_gate_assist");
  });
});

describe("QA remediation surface 2: stale permissive local cannot silence seed crashes", () => {
  it("applyCrashOverride with seed crash count forces conservative over permissive rec", () => {
    const permissive: PacingRecommendation = {
      harness_id: "crush",
      max_word_bucket: "501-1000 words",
      min_idle_wait_seconds: 1,
      slash_command_bundling: "allowed",
      multi_phase_prompting: "allowed",
      notes: "stale permissive local",
    };
    const rec = applyCrashOverride(permissive, 1);
    expect(isConservativeRecommendation(rec)).toBe(true);
    expect(rec.slash_command_bundling).toBe("avoid");
    expect(rec.max_word_bucket).toBe("0-100 words");
  });

  it("recommend('crush') remains conservative (seed crash signatures always count)", () => {
    const rec = recommend("crush");
    expect(isConservativeRecommendation(rec)).toBe(true);
  });
});

describe("QA remediation surface 3: traversal harness_id rejected/contained", () => {
  it("isSafeHarnessId rejects path traversal and separators", () => {
    expect(isSafeHarnessId("../etc")).toBe(false);
    expect(isSafeHarnessId("..")).toBe(false);
    expect(isSafeHarnessId("a/b")).toBe(false);
    expect(isSafeHarnessId("a\\b")).toBe(false);
    expect(isSafeHarnessId("")).toBe(false);
    expect(isSafeHarnessId("crush")).toBe(true);
    expect(isSafeHarnessId("glm-droid")).toBe(true);
  });

  it("loadSeed returns null for traversal harness_id without reading outside seeds", () => {
    const fsExists = vi.fn().mockReturnValue(true);
    const fsRead = vi.fn().mockReturnValue("{}");
    expect(loadSeed("../etc", "/tmp/seeds", fsRead as never, fsExists)).toBeNull();
    expect(fsExists).not.toHaveBeenCalled();
    expect(fsRead).not.toHaveBeenCalled();
  });

  it("appendEvent no-ops for traversal harness_id (no write)", () => {
    const fsWrite = vi.fn();
    const fsMkdir = vi.fn();
    appendEvent(
      {
        harness_id: "../../tmp/evil",
        event_type: "PROMPT_DELIVERY",
        ts: "2026-07-11T00:00:00Z",
      },
      "/tmp/fake-e037-traversal",
      vi.fn() as never,
      vi.fn().mockReturnValue(false),
      fsWrite as never,
      fsMkdir as never
    );
    expect(fsWrite).not.toHaveBeenCalled();
    expect(fsMkdir).not.toHaveBeenCalled();
  });

  it("recommend returns conservative fallback for unsafe harness_id without throwing", () => {
    expect(() => recommend("../etc/passwd")).not.toThrow();
    const rec = recommend("../etc/passwd");
    expect(rec.max_word_bucket).toBe("0-100 words");
    expect(rec.harness_id).toBe("unsafe-harness");
  });
});

describe("QA remediation surface 4: malformed empty separator and nonboolean modal", () => {
  it("strips empty separator_token and non-boolean modal_gate_assist", () => {
    const event = {
      harness_id: "crush",
      event_type: "PROMPT_DELIVERY" as const,
      ts: "2026-07-11T00:00:00Z",
      delivery_format: "double_enter",
      modal_gate_assist: "yes" as unknown as boolean,
    } as HarnessPacingEventE037;
    Object.assign(event, { [SEPARATOR_TOKEN_FIELD]: "   " });
    const normalized = normalizeEventFormatFields(event);
    expect(normalized.delivery_format).toBe("double_enter");
    expect(normalized.separator_token).toBeUndefined();
    expect(normalized.modal_gate_assist).toBeUndefined();
  });

  it("appendEvent rejects malformed incoming format fields (zero write, no throw)", () => {
    const fsWrite = vi.fn();
    const fsMkdir = vi.fn();
    const event = {
      harness_id: "crush",
      event_type: "PROMPT_DELIVERY" as const,
      ts: "2026-07-11T00:00:00Z",
      modal_gate_assist: 1 as unknown as boolean,
      delivery_format: "double_enter",
    } as HarnessPacingEventE037;
    Object.assign(event, { [SEPARATOR_TOKEN_FIELD]: "" });
    expect(() =>
      appendEvent(
        event,
        "/tmp/fake-e037-malformed",
        vi.fn() as never,
        vi.fn().mockReturnValue(false),
        fsWrite as never,
        fsMkdir as never
      )
    ).not.toThrow();
    expect(fsWrite).not.toHaveBeenCalled();
    expect(fsMkdir).not.toHaveBeenCalled();
  });
});

describe("commit-gate: loadSeed crush file-first; embed only when absent", () => {
  it("loadSeed('crush') returns embedded seed when seed files are absent", () => {
    const fsExists = vi.fn().mockReturnValue(false);
    const fsRead = vi.fn();
    const seed = loadSeed("crush", "/tmp/no-seeds-e037-dist", fsRead as never, fsExists);
    expect(seed).not.toBeNull();
    expect(seed!.crash_signatures.length).toBeGreaterThan(0);
    expect(seed!.recommended.slash_command_bundling).toBe("avoid");
    expect(isConservativeRecommendation(seed!.recommended)).toBe(true);
    expect(fsRead).not.toHaveBeenCalled();
  });

  it("loadSeed('crush') consumes on-disk seed when present (package-relative path)", () => {
    const seedJson = JSON.stringify({
      harness_id: "crush",
      version: "1.0",
      last_updated: "2026-06-12T00:00:00Z",
      samples_total: 1,
      events: [],
      crash_signatures: ["f94360680e22b229e9fff8d9d34346689d023b2fffa2e6f8b13c7b4337d4c13f"],
      recommended: {
        harness_id: "crush",
        max_word_bucket: "0-100 words",
        min_idle_wait_seconds: 5,
        slash_command_bundling: "avoid",
        multi_phase_prompting: "avoid",
        notes: "shipped seed fixture",
      },
    });
    const fsExists = vi.fn().mockReturnValue(true);
    const fsRead = vi.fn().mockReturnValue(seedJson);
    const seed = loadSeed("crush", "/tmp/packaged-seeds", fsRead as never, fsExists);
    expect(fsExists).toHaveBeenCalled();
    expect(fsRead).toHaveBeenCalled();
    expect(seed).not.toBeNull();
    expect(seed!.recommended.notes).toBe("shipped seed fixture");
    expect(seed!.recommended.slash_command_bundling).toBe("avoid");
  });

  it("recommend('crush') is avoid when seed is available", () => {
    const rec = recommend("crush");
    expect(rec.slash_command_bundling).toBe("avoid");
    expect(rec.max_word_bucket).toBe("0-100 words");
    expect(rec.min_idle_wait_seconds).toBeGreaterThanOrEqual(5);
    expect(isConservativeRecommendation(rec)).toBe(true);
  });
});

describe("QA fail remediation: validate persisted HarnessProfile before use", () => {
  it("isValidHarnessProfile rejects non-array events", () => {
    const bad = {
      harness_id: "crush",
      version: "1.0",
      last_updated: "2026-07-11T00:00:00Z",
      samples_total: 0,
      events: { not: "array" },
      crash_signatures: [],
      recommended: {
        harness_id: "crush",
        max_word_bucket: "0-100 words",
        min_idle_wait_seconds: 3,
        slash_command_bundling: "unknown",
        multi_phase_prompting: "unknown",
        notes: "x",
      },
    };
    expect(isValidHarnessProfile(bad, "crush")).toBe(false);
  });

  it("appendEvent no-ops on present malformed profile (zero write, no throw)", () => {
    const malformed = JSON.stringify({
      harness_id: "crush",
      version: "1.0",
      last_updated: "2026-07-11T00:00:00Z",
      samples_total: 1,
      events: "not-an-array",
      crash_signatures: [],
      recommended: {
        harness_id: "crush",
        max_word_bucket: "0-100 words",
        min_idle_wait_seconds: 3,
        slash_command_bundling: "unknown",
        multi_phase_prompting: "unknown",
        notes: "malformed",
      },
    });
    const fsExists = vi.fn().mockReturnValue(true);
    const fsRead = vi.fn().mockReturnValue(malformed);
    const fsWrite = vi.fn();
    const fsMkdir = vi.fn();
    expect(() =>
      appendEvent(
        {
          harness_id: "crush",
          event_type: "PROMPT_DELIVERY",
          ts: "2026-07-11T00:00:00Z",
        },
        "/tmp/fake-e037-malformed-profile",
        fsRead as never,
        fsExists,
        fsWrite as never,
        fsMkdir as never
      )
    ).not.toThrow();
    expect(fsWrite).not.toHaveBeenCalled();
    expect(fsMkdir).not.toHaveBeenCalled();
  });

  it("appendEvent creates default when profile is absent", () => {
    const written: string[] = [];
    const fsExists = vi.fn().mockReturnValue(false);
    const fsRead = vi.fn();
    const fsWrite = vi.fn().mockImplementation((_p: string, data: string) => written.push(data));
    const fsMkdir = vi.fn();
    appendEvent(
      {
        harness_id: "crush",
        event_type: "PROMPT_DELIVERY",
        ts: "2026-07-11T00:00:00Z",
      },
      "/tmp/fake-e037-absent-profile",
      fsRead as never,
      fsExists,
      fsWrite as never,
      fsMkdir as never
    );
    expect(fsMkdir).toHaveBeenCalled();
    expect(written).toHaveLength(1);
    const saved = JSON.parse(written[0]) as HarnessProfile;
    expect(saved.samples_total).toBe(1);
    expect(Array.isArray(saved.events)).toBe(true);
    expect(saved.events).toHaveLength(1);
  });

  it("appendEvent appends when existing profile is valid", () => {
    const existing = buildDefaultProfile("crush");
    existing.recommended.qa_timeout = {
      base_seconds: 30,
      per_file_seconds: 5,
      max_seconds: 120,
    };
    existing.events.push({
      harness_id: "crush",
      event_type: "PROMPT_DELIVERY",
      ts: "2026-07-10T00:00:00Z",
    });
    existing.samples_total = 1;
    const written: string[] = [];
    const fsExists = vi.fn().mockReturnValue(true);
    const fsRead = vi.fn().mockReturnValue(JSON.stringify(existing));
    const fsWrite = vi.fn().mockImplementation((_p: string, data: string) => written.push(data));
    const fsMkdir = vi.fn();
    appendEvent(
      {
        harness_id: "crush",
        event_type: "PROMPT_DELIVERY",
        ts: "2026-07-11T00:00:00Z",
      },
      "/tmp/fake-e037-valid-profile",
      fsRead as never,
      fsExists,
      fsWrite as never,
      fsMkdir as never
    );
    expect(fsWrite).toHaveBeenCalled();
    const saved = JSON.parse(written[0]) as HarnessProfile;
    expect(saved.events).toHaveLength(2);
    expect(saved.samples_total).toBe(2);
    expect(saved.recommended.qa_timeout).toEqual({
      base_seconds: 30,
      per_file_seconds: 5,
      max_seconds: 120,
    });
  });

  it("readProfile returns null for present malformed profile", () => {
    const malformed = JSON.stringify({
      harness_id: "crush",
      version: "1.0",
      last_updated: "2026-07-11T00:00:00Z",
      samples_total: 0,
      events: null,
      crash_signatures: [],
      recommended: {
        harness_id: "crush",
        max_word_bucket: "0-100 words",
        min_idle_wait_seconds: 3,
        slash_command_bundling: "unknown",
        multi_phase_prompting: "unknown",
        notes: "x",
      },
    });
    const result = readProfile(
      "crush",
      "/tmp/fake-e037-read-malformed",
      vi.fn().mockReturnValue(malformed) as never,
      vi.fn().mockReturnValue(true)
    );
    expect(result).toBeNull();
  });
});

function validProfileShell(harness_id: string) {
  return {
    harness_id,
    version: "1.0",
    last_updated: "2026-07-11T00:00:00Z",
    samples_total: 0,
    events: [] as unknown[],
    crash_signatures: [] as string[],
    recommended: {
      harness_id,
      max_word_bucket: "0-100 words",
      min_idle_wait_seconds: 3,
      slash_command_bundling: "unknown" as const,
      multi_phase_prompting: "unknown" as const,
      notes: "x",
    },
  };
}

function expectAppendNoop(profileJson: string) {
  const fsExists = vi.fn().mockReturnValue(true);
  const fsRead = vi.fn().mockReturnValue(profileJson);
  const fsWrite = vi.fn();
  const fsMkdir = vi.fn();
  expect(() =>
    appendEvent(
      {
        harness_id: "crush",
        event_type: "PROMPT_DELIVERY",
        ts: "2026-07-11T00:00:00Z",
      },
      "/tmp/fake-e037-identity-reject",
      fsRead as never,
      fsExists,
      fsWrite as never,
      fsMkdir as never
    )
  ).not.toThrow();
  expect(fsWrite).not.toHaveBeenCalled();
  expect(fsMkdir).not.toHaveBeenCalled();
}

describe("stage readiness: harness_id identity + event_type enum", () => {
  it("rejects mismatched profile harness_id", () => {
    const p = validProfileShell("other");
    expect(isValidHarnessProfile(p, "crush")).toBe(false);
    expectAppendNoop(JSON.stringify(p));
  });

  it("rejects mismatched recommended.harness_id", () => {
    const p = validProfileShell("crush");
    p.recommended.harness_id = "other";
    expect(isValidHarnessProfile(p, "crush")).toBe(false);
    expectAppendNoop(JSON.stringify(p));
  });

  it("rejects mismatched event harness_id", () => {
    const p = validProfileShell("crush");
    p.events.push({
      harness_id: "other",
      event_type: "PROMPT_DELIVERY",
      ts: "2026-07-11T00:00:00Z",
    });
    p.samples_total = 1;
    expect(isValidHarnessProfile(p, "crush")).toBe(false);
    expectAppendNoop(JSON.stringify(p));
  });

  it("rejects unknown event_type", () => {
    const p = validProfileShell("crush");
    p.events.push({
      harness_id: "crush",
      event_type: "NOT_A_REAL_TYPE",
      ts: "2026-07-11T00:00:00Z",
    });
    p.samples_total = 1;
    expect(isValidHarnessProfile(p, "crush")).toBe(false);
    expectAppendNoop(JSON.stringify(p));
  });
});

function expectIncomingNoop(event: Record<string, unknown>, profilePresent = false) {
  const fsExists = vi.fn().mockReturnValue(profilePresent);
  const fsRead = vi.fn().mockReturnValue(
    profilePresent ? JSON.stringify(buildDefaultProfile("crush")) : undefined
  );
  const fsWrite = vi.fn();
  const fsMkdir = vi.fn();
  expect(() =>
    appendEvent(
      event as never,
      "/tmp/fake-e037-incoming-reject",
      fsRead as never,
      fsExists,
      fsWrite as never,
      fsMkdir as never
    )
  ).not.toThrow();
  expect(fsWrite).not.toHaveBeenCalled();
  expect(fsMkdir).not.toHaveBeenCalled();
}

describe("choke-point: table-driven malformed reject (zero throw/mkdir/write)", () => {
  const baseIncoming = {
    harness_id: "crush",
    event_type: "PROMPT_DELIVERY",
    ts: "2026-07-11T00:00:00Z",
  };

  const incomingCases: Array<{ name: string; event: Record<string, unknown> }> = [
    { name: "noncanonical event_type", event: { ...baseIncoming, event_type: "NOT_CANONICAL" } },
    { name: "submitted string boolean", event: { ...baseIncoming, submitted: "yes" } },
    { name: "negative duration_ms", event: { ...baseIncoming, duration_ms: -5 } },
    { name: "NaN payload_bytes", event: { ...baseIncoming, payload_bytes: Number.NaN } },
    { name: "modal_gate_assist number", event: { ...baseIncoming, modal_gate_assist: 1 } },
    { name: "empty separator_token", event: { ...baseIncoming, separator_token: "  " } },
    {
      name: "message_format bad submit_profile enum",
      event: {
        ...baseIncoming,
        message_format: {
          harness_id: "crush",
          submit_profile: "triple_enter",
          newline_policy: "preserve",
          multi_line_ok: true,
        },
      },
    },
    {
      name: "message_format harness mismatch",
      event: {
        ...baseIncoming,
        message_format: {
          harness_id: "other",
          submit_profile: "double_enter",
          newline_policy: "preserve",
          multi_line_ok: true,
        },
      },
    },
    { name: "missing ts", event: { harness_id: "crush", event_type: "PROMPT_DELIVERY" } },
    { name: "notes as number", event: { ...baseIncoming, notes: 99 } },
  ];

  for (const c of incomingCases) {
    it(`incoming: ${c.name}`, () => {
      expectIncomingNoop(c.event);
    });
  }

  const persistedCases: Array<{ name: string; mutate: (p: ReturnType<typeof validProfileShell>) => void }> = [
    {
      name: "qa_timeout_string",
      mutate: (p) => {
        (p.recommended as { qa_timeout?: unknown }).qa_timeout = "not-an-object";
      },
    },
    {
      name: "qa_timeout_negative",
      mutate: (p) => {
        (p.recommended as { qa_timeout?: unknown }).qa_timeout = {
          base_seconds: -1,
          per_file_seconds: 2,
          max_seconds: 30,
        };
      },
    },
    {
      name: "fractional_samples",
      mutate: (p) => {
        p.samples_total = 0.5;
      },
    },
    {
      name: "count_mismatch",
      mutate: (p) => {
        p.samples_total = 1;
      },
    },
    {
      name: "qa_timeout_missing_nested_member",
      mutate: (p) => {
        (p.recommended as { qa_timeout?: unknown }).qa_timeout = {
          base_seconds: 10,
          max_seconds: 30,
        };
      },
    },
    {
      name: "qa_timeout_nonfinite_nested_member",
      mutate: (p) => {
        (p.recommended as { qa_timeout?: unknown }).qa_timeout = {
          base_seconds: 10,
          per_file_seconds: Number.NaN,
          max_seconds: 30,
        };
      },
    },
    {
      name: "qa_timeout_max_below_base",
      mutate: (p) => {
        (p.recommended as { qa_timeout?: unknown }).qa_timeout = {
          base_seconds: 30,
          per_file_seconds: 2,
          max_seconds: 10,
        };
      },
    },
    {
      name: "negative samples_total",
      mutate: (p) => {
        p.samples_total = -1;
      },
    },
    {
      name: "submitted string on persisted event",
      mutate: (p) => {
        p.events.push({
          harness_id: "crush",
          event_type: "PROMPT_DELIVERY",
          ts: "2026-07-11T00:00:00Z",
          submitted: "yes",
        });
        p.samples_total = 1;
      },
    },
    {
      name: "recommended notes number",
      mutate: (p) => {
        (p.recommended as { notes: unknown }).notes = 42;
      },
    },
    {
      name: "invalid slash_command_bundling enum",
      mutate: (p) => {
        (p.recommended as { slash_command_bundling: string }).slash_command_bundling = "sometimes";
      },
    },
    {
      name: "invalid recommended submit_profile enum",
      mutate: (p) => {
        (p.recommended as { submit_profile?: string }).submit_profile = "nope";
      },
    },
    {
      name: "profile message_format harness mismatch",
      mutate: (p) => {
        (p as { message_format?: unknown }).message_format = {
          harness_id: "other",
          submit_profile: "double_enter",
          newline_policy: "preserve",
          multi_line_ok: true,
        };
      },
    },
  ];

  for (const c of persistedCases) {
    it(`persisted: ${c.name}`, () => {
      const p = validProfileShell("crush");
      c.mutate(p);
      expect(isValidHarnessProfile(p, "crush")).toBe(false);
      expectAppendNoop(JSON.stringify(p));
    });
  }
});
