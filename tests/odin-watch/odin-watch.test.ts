import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WakeState } from "../../src/protocol/schemas.js";
import {
  classify,
  type ClassifierInput,
} from "../../src/odin-watch/classifier.js";
import { writeWakeFiles } from "../../src/odin-watch/writers.js";
import { execFileNoThrow } from "../../src/utils/execFileNoThrow.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_MS = 1_750_000_000_000;

function baseInput(overrides: Partial<ClassifierInput> = {}): ClassifierInput {
  return {
    text: "",
    hash: "hash-a",
    prev_hash: null,
    elapsed_ms: 0,
    now_ms: NOW_MS,
    mandatory_audit_interval_ms: 600_000,
    stale_threshold_ms: 360_000,
    write_scope: [],
    dirty_paths: [],
    last_verdict: null,
    last_mandatory_audit_ts: null,
    ...overrides,
  };
}

function makeWakeState(wake: 0 | 1, reasons: string[]): WakeState {
  return {
    schema_version: "1.0",
    ts: "2026-06-12T00:00:00.000Z",
    surface: "surface-1",
    pane_id: "surface-1",
    substrate: "cmux",
    state: wake === 0 ? "WORKING" : "UNKNOWN_NEEDS_READ",
    wake,
    reason_codes: reasons,
    dirty_paths: [],
    dirty_out_of_scope: [],
    screen_hash: "deadbeef",
    screen_changed: false,
    prompt_budget_class: wake === 0 ? "silent" : "compact",
    next_mandatory_audit_due: "2026-06-12T00:10:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// classify() — purity / determinism
// ---------------------------------------------------------------------------

describe("classify purity", () => {
  it("is deterministic: identical inputs produce identical outputs", () => {
    const input = baseInput({
      text: "some screen text",
      last_mandatory_audit_ts: NOW_MS - 100_000,
    });
    const a = classify(input);
    const b = classify({ ...input });
    expect(a).toEqual(b);
  });

  it("depends on now_ms input, not the wall clock", () => {
    // Audit due relative to injected now_ms even though real Date.now() differs
    const input = baseInput({
      last_verdict: "WORKING",
      last_mandatory_audit_ts: NOW_MS - 600_000,
    });
    const result = classify(input);
    expect(result.wake).toBe(1);
    expect(result.reason_codes).toContain("MANDATORY_AUDIT interval elapsed");
  });
});

// ---------------------------------------------------------------------------
// classify() — Rule 1: mandatory audit
// ---------------------------------------------------------------------------

describe("classify rule 1: mandatory audit", () => {
  it("fires when now_ms - last_mandatory_audit_ts >= interval", () => {
    const result = classify(
      baseInput({
        last_verdict: "WORKING",
        last_mandatory_audit_ts: NOW_MS - 600_000,
      })
    );
    expect(result.wake).toBe(1);
    expect(result.reason_codes).toEqual(["MANDATORY_AUDIT interval elapsed"]);
    expect(result.prompt_budget_class).toBe("compact");
  });

  it("preserves the current verdict", () => {
    const result = classify(
      baseInput({
        last_verdict: "BLOCKED",
        last_mandatory_audit_ts: NOW_MS - 700_000,
      })
    );
    expect(result.verdict).toBe("BLOCKED");
  });

  it("uses elapsed_ms when no audit has occurred yet", () => {
    const result = classify(
      baseInput({ elapsed_ms: 600_000, last_verdict: "WORKING" })
    );
    expect(result.wake).toBe(1);
    expect(result.reason_codes).toContain("MANDATORY_AUDIT interval elapsed");
  });

  it("wins over later rules (first-match): crash text present but audit due", () => {
    const result = classify(
      baseInput({
        text: "fatal error: panic",
        last_verdict: "WORKING",
        last_mandatory_audit_ts: NOW_MS - 600_000,
      })
    );
    expect(result.reason_codes).toEqual(["MANDATORY_AUDIT interval elapsed"]);
    expect(result.verdict).toBe("WORKING");
  });

  it("does not fire before the interval elapses", () => {
    const result = classify(
      baseInput({
        text: "Running tests",
        last_mandatory_audit_ts: NOW_MS - 100_000,
      })
    );
    expect(result.reason_codes).not.toContain("MANDATORY_AUDIT interval elapsed");
  });
});

// ---------------------------------------------------------------------------
// classify() — Rule 2: approval markers
// ---------------------------------------------------------------------------

describe("classify rule 2: approval markers", () => {
  it.each([
    "Proceed with the proposal",
    "Proceed with comment",
    "No and explain why",
    "Enter Select",
  ])("string marker '%s' -> WAITING_APPROVAL wake=1 diagnostic", (marker) => {
    const result = classify(baseInput({ text: `prompt: ${marker}` }));
    expect(result.verdict).toBe("WAITING_APPROVAL");
    expect(result.wake).toBe(1);
    expect(result.prompt_budget_class).toBe("diagnostic");
    expect(result.last_marker).toBe(marker);
  });

  it("numbered interactive options match /^\\d+\\.\\s/m", () => {
    const result = classify(baseInput({ text: "Choose:\n1. Yes\n2. No" }));
    expect(result.verdict).toBe("WAITING_APPROVAL");
    expect(result.wake).toBe(1);
  });

  it("wins over crash markers (first-match)", () => {
    const result = classify(
      baseInput({ text: "Proceed with the proposal after the panic" })
    );
    expect(result.verdict).toBe("WAITING_APPROVAL");
  });
});

// ---------------------------------------------------------------------------
// classify() — Rule 3: crash markers
// ---------------------------------------------------------------------------

describe("classify rule 3: crash markers", () => {
  it.each([
    "panic",
    "stack trace",
    "program experienced a panic",
    "TUI run error",
    "fatal error",
  ])("marker '%s' -> CRASHED wake=1 forensic", (marker) => {
    const result = classify(baseInput({ text: `oops ${marker} occurred` }));
    expect(result.verdict).toBe("CRASHED");
    expect(result.wake).toBe(1);
    expect(result.prompt_budget_class).toBe("forensic");
  });

  it("wins over completion markers (first-match)", () => {
    const result = classify(baseInput({ text: "QA_COMPLETE then panic" }));
    expect(result.verdict).toBe("CRASHED");
  });
});

// ---------------------------------------------------------------------------
// classify() — Rule 4: completion markers
// ---------------------------------------------------------------------------

describe("classify rule 4: completion markers", () => {
  it.each(["QA COMPLETE", "QA_COMPLETE"])(
    "'%s' -> QA_COMPLETE wake=1 compact",
    (marker) => {
      const result = classify(baseInput({ text: marker }));
      expect(result.verdict).toBe("QA_COMPLETE");
      expect(result.wake).toBe(1);
      expect(result.prompt_budget_class).toBe("compact");
    }
  );

  it.each(["DEV_COMPLETE_QA_PENDING", "implementation complete", "ready for QA"])(
    "'%s' -> DEV_COMPLETE_QA_PENDING wake=1 compact",
    (marker) => {
      const result = classify(baseInput({ text: marker }));
      expect(result.verdict).toBe("DEV_COMPLETE_QA_PENDING");
      expect(result.wake).toBe(1);
      expect(result.prompt_budget_class).toBe("compact");
    }
  );

  it("wins over blocker markers (first-match)", () => {
    const result = classify(baseInput({ text: "QA_COMPLETE but BLOCKED" }));
    expect(result.verdict).toBe("QA_COMPLETE");
  });
});

// ---------------------------------------------------------------------------
// classify() — Rule 5: blocker markers
// ---------------------------------------------------------------------------

describe("classify rule 5: blocker markers", () => {
  it.each([
    "BLOCKED",
    "cannot proceed",
    "missing",
    "permission denied",
    "need approval",
    "SPEC-AMENDMENT",
    "non-fast-forward",
  ])("marker '%s' -> BLOCKED wake=1 diagnostic", (marker) => {
    const result = classify(baseInput({ text: `state ${marker} here` }));
    expect(result.verdict).toBe("BLOCKED");
    expect(result.wake).toBe(1);
    expect(result.prompt_budget_class).toBe("diagnostic");
  });

  it("wins over scope violation (first-match)", () => {
    const result = classify(
      baseInput({
        text: "cannot proceed",
        write_scope: ["src/allowed"],
        dirty_paths: ["src/forbidden/file.ts"],
      })
    );
    expect(result.reason_codes).toEqual(["BLOCKER_MARKER"]);
    expect(result.dirty_out_of_scope).toEqual(["src/forbidden/file.ts"]);
  });
});

// ---------------------------------------------------------------------------
// classify() — Rule 6: scope violation
// ---------------------------------------------------------------------------

describe("classify rule 6: scope violation", () => {
  it("dirty path outside write_scope -> wake=1 with DIRTY_OUT_OF_SCOPE reason", () => {
    const result = classify(
      baseInput({
        text: "Running tests",
        write_scope: ["src/allowed"],
        dirty_paths: ["src/forbidden/file.ts"],
      })
    );
    expect(result.wake).toBe(1);
    expect(result.reason_codes).toEqual([
      "DIRTY_OUT_OF_SCOPE src/forbidden/file.ts",
    ]);
    expect(result.prompt_budget_class).toBe("diagnostic");
  });

  it("in-scope dirty paths do not trigger the rule", () => {
    const result = classify(
      baseInput({
        text: "Running tests",
        write_scope: ["src/allowed"],
        dirty_paths: ["src/allowed/file.ts"],
      })
    );
    expect(result.reason_codes).not.toContain(
      "DIRTY_OUT_OF_SCOPE src/allowed/file.ts"
    );
    expect(result.verdict).toBe("WORKING");
  });

  it("wins over stale hash (first-match)", () => {
    const result = classify(
      baseInput({
        text: "Running tests",
        write_scope: ["src/allowed"],
        dirty_paths: ["src/forbidden/file.ts"],
        prev_hash: "hash-a",
        hash: "hash-a",
        elapsed_ms: 400_000,
      })
    );
    expect(result.reason_codes[0]).toMatch(/^DIRTY_OUT_OF_SCOPE/);
    expect(result.verdict).not.toBe("IDLE");
  });
});

// ---------------------------------------------------------------------------
// classify() — Rule 7: stale hash
// ---------------------------------------------------------------------------

describe("classify rule 7: stale hash", () => {
  it("unchanged hash beyond threshold -> IDLE wake=1 compact", () => {
    const result = classify(
      baseInput({
        text: "Running tests",
        prev_hash: "hash-a",
        hash: "hash-a",
        elapsed_ms: 400_000,
        stale_threshold_ms: 360_000,
      })
    );
    expect(result.verdict).toBe("IDLE");
    expect(result.wake).toBe(1);
    expect(result.reason_codes).toEqual(["STALE_HASH"]);
    expect(result.prompt_budget_class).toBe("compact");
  });

  it("changed hash does not trigger stale (falls through to rule 8)", () => {
    const result = classify(
      baseInput({
        text: "Running tests",
        prev_hash: "hash-a",
        hash: "hash-b",
        elapsed_ms: 400_000,
      })
    );
    expect(result.verdict).toBe("WORKING");
  });

  it("unchanged hash within threshold does not trigger stale", () => {
    const result = classify(
      baseInput({
        text: "Running tests",
        prev_hash: "hash-a",
        hash: "hash-a",
        elapsed_ms: 100_000,
        stale_threshold_ms: 360_000,
      })
    );
    expect(result.verdict).toBe("WORKING");
  });
});

// ---------------------------------------------------------------------------
// classify() — Rule 8 + conservative bias
// ---------------------------------------------------------------------------

describe("classify rule 8: all clear vs conservative bias", () => {
  it.each(["⠋ thinking", "Running tests", "Compiling project", "Fetching deps"])(
    "positive evidence '%s' -> WORKING wake=0 silent",
    (text) => {
      const result = classify(baseInput({ text }));
      expect(result.verdict).toBe("WORKING");
      expect(result.wake).toBe(0);
      expect(result.prompt_budget_class).toBe("silent");
    }
  );

  it("empty text (no stale trigger) -> UNKNOWN_NEEDS_READ wake=1", () => {
    const result = classify(baseInput({ text: "" }));
    expect(result.verdict).toBe("UNKNOWN_NEEDS_READ");
    expect(result.wake).toBe(1);
  });

  it("non-empty text without positive evidence -> UNKNOWN_NEEDS_READ wake=1", () => {
    const result = classify(baseInput({ text: "$ " }));
    expect(result.verdict).toBe("UNKNOWN_NEEDS_READ");
    expect(result.wake).toBe(1);
  });

  it("never produces wake=0 for a sweep of ambiguous inputs", () => {
    const ambiguous = ["", "$ ", "ok", "idle shell prompt", "> ", "done?"];
    for (const text of ambiguous) {
      const result = classify(baseInput({ text }));
      expect(result.wake, `text='${text}' must wake`).toBe(1);
      expect(result.verdict).toBe("UNKNOWN_NEEDS_READ");
    }
  });

  it("WORKING wake=0 requires positive evidence, never default", () => {
    // Identical input minus the working indicator flips to UNKNOWN_NEEDS_READ
    const working = classify(baseInput({ text: "Generating output" }));
    const ambiguous = classify(baseInput({ text: "output" }));
    expect(working.wake).toBe(0);
    expect(ambiguous.wake).toBe(1);
    expect(ambiguous.verdict).toBe("UNKNOWN_NEEDS_READ");
  });
});

// ---------------------------------------------------------------------------
// writeWakeFiles — flag byte contract
// ---------------------------------------------------------------------------

describe("writeWakeFiles", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir !== null) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it("flag file is exactly one byte '1' with no newline", () => {
    dir = mkdtempSync(join(tmpdir(), "odin-watch-test-"));
    writeWakeFiles(dir, "dev-a", makeWakeState(1, ["AMBIGUOUS_STATE"]));
    const buf = readFileSync(join(dir, "dev-a.flag"));
    expect(buf.length).toBe(1);
    expect(buf.toString("utf8")).toBe("1");
  });

  it("flag file is exactly one byte '0' with no newline", () => {
    dir = mkdtempSync(join(tmpdir(), "odin-watch-test-"));
    writeWakeFiles(dir, "dev-a", makeWakeState(0, ["ALL_CLEAR"]));
    const buf = readFileSync(join(dir, "dev-a.flag"));
    expect(buf.length).toBe(1);
    expect(buf.toString("utf8")).toBe("0");
  });

  it("reason file contains one reason code per line", () => {
    dir = mkdtempSync(join(tmpdir(), "odin-watch-test-"));
    writeWakeFiles(dir, "dev-a", makeWakeState(1, ["R1", "R2"]));
    const text = readFileSync(join(dir, "dev-a.reason"), "utf8");
    expect(text).toBe("R1\nR2");
  });

  it("state file is valid WakeState JSON", () => {
    dir = mkdtempSync(join(tmpdir(), "odin-watch-test-"));
    const state = makeWakeState(1, ["AMBIGUOUS_STATE"]);
    writeWakeFiles(dir, "dev-a", state);
    const parsed = JSON.parse(
      readFileSync(join(dir, "dev-a.state.json"), "utf8")
    ) as WakeState;
    expect(parsed).toEqual(state);
    expect(parsed.schema_version).toBe("1.0");
    expect([0, 1]).toContain(parsed.wake);
  });

  it("creates the flag directory when missing", () => {
    dir = mkdtempSync(join(tmpdir(), "odin-watch-test-"));
    const nested = join(dir, "deep", "nested");
    writeWakeFiles(nested, "dev-b", makeWakeState(1, ["X"]));
    const buf = readFileSync(join(nested, "dev-b.flag"));
    expect(buf.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// execFileNoThrow — never throws
// ---------------------------------------------------------------------------

describe("execFileNoThrow", () => {
  it("returns status 0 and stdout for a successful command", async () => {
    const result = await execFileNoThrow("node", ["-e", "console.log('ok')"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
  });

  it("does not throw on a nonzero exit code", async () => {
    const result = await execFileNoThrow("node", ["-e", "process.exit(3)"]);
    expect(result.status).toBe(3);
  });

  it("does not throw on ENOENT (missing binary)", async () => {
    const result = await execFileNoThrow(
      "definitely-not-a-real-binary-odin-watch-test",
      []
    );
    expect(result.status).not.toBe(0);
  });

  it("captures stderr without throwing", async () => {
    const result = await execFileNoThrow("node", [
      "-e",
      "console.error('boom'); process.exit(2)",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("boom");
  });
});

// ---------------------------------------------------------------------------
// CmuxBackend — empty text on failure (mocked execFileNoThrow)
// ---------------------------------------------------------------------------

describe("CmuxBackend", () => {
  let dir: string | null = null;

  afterEach(() => {
    vi.doUnmock("../../src/utils/execFileNoThrow.js");
    vi.resetModules();
    if (dir !== null) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  async function loadBackendWith(result: {
    status: number;
    stdout: string;
    stderr: string;
  }) {
    vi.resetModules();
    vi.doMock("../../src/utils/execFileNoThrow.js", () => ({
      execFileNoThrow: vi.fn().mockResolvedValue(result),
    }));
    const mod = await import("../../src/odin-watch/backends/cmux.js");
    return mod.CmuxBackend;
  }

  it("returns empty text when the cmux command fails", async () => {
    dir = mkdtempSync(join(tmpdir(), "odin-watch-cmux-"));
    const CmuxBackend = await loadBackendWith({
      status: 1,
      stdout: "should-be-ignored",
      stderr: "cmux: command not found",
    });
    const backend = new CmuxBackend(dir);
    const snapshot = await backend.capture("pane-1");
    expect(snapshot.text).toBe("");
    expect(snapshot.hash).toBe(
      createHash("sha256").update("").digest("hex")
    );
    expect(snapshot.substrate).toBe("cmux");
    expect(snapshot.pane_id).toBe("pane-1");
  });

  it("returns stdout text and archives it on success", async () => {
    dir = mkdtempSync(join(tmpdir(), "odin-watch-cmux-"));
    const CmuxBackend = await loadBackendWith({
      status: 0,
      stdout: "screen contents here",
      stderr: "",
    });
    const backend = new CmuxBackend(dir);
    const snapshot = await backend.capture("pane-2");
    expect(snapshot.text).toBe("screen contents here");
    expect(snapshot.hash).toBe(
      createHash("sha256").update("screen contents here").digest("hex")
    );
    const archived = readdirSync(dir);
    expect(archived.length).toBe(1);
    const content = readFileSync(join(dir, archived[0]), "utf8");
    expect(content).toBe("screen contents here");
  });
});
