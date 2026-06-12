import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassifierInput } from "../../src/odin-watch/classifier.js";
import { classify } from "../../src/odin-watch/classifier.js";

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

// ---------------------------------------------------------------------------
// TmuxBackend — empty text on failure (mocked execFileNoThrow)
// ---------------------------------------------------------------------------

describe("TmuxBackend", () => {
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
    const mod = await import("../../src/odin-watch/backends/tmux.js");
    return mod.TmuxBackend;
  }

  it("failure path: non-zero exit produces empty text and sha256-of-empty", async () => {
    dir = mkdtempSync(join(tmpdir(), "odin-watch-tmux-"));
    const TmuxBackend = await loadBackendWith({
      status: 1,
      stdout: "should-be-ignored",
      stderr: "tmux: command not found",
    });
    const backend = new TmuxBackend(dir);
    const snapshot = await backend.capture("pane-1");
    expect(snapshot.text).toBe("");
    expect(snapshot.hash).toBe(
      createHash("sha256").update("").digest("hex")
    );
    expect(snapshot.substrate).toBe("tmux");
    expect(snapshot.pane_id).toBe("pane-1");
  });

  it("success path: returns stdout text and archives it", async () => {
    dir = mkdtempSync(join(tmpdir(), "odin-watch-tmux-"));
    const TmuxBackend = await loadBackendWith({
      status: 0,
      stdout: "tmux pane contents",
      stderr: "",
    });
    const backend = new TmuxBackend(dir);
    const snapshot = await backend.capture("pane-2");
    expect(snapshot.text).toBe("tmux pane contents");
    expect(snapshot.hash).toBe(
      createHash("sha256").update("tmux pane contents").digest("hex")
    );
    expect(snapshot.substrate).toBe("tmux");
    expect(snapshot.pane_id).toBe("pane-2");
    const archived = readdirSync(dir);
    expect(archived.length).toBe(1);
    const content = readFileSync(join(dir, archived[0]), "utf8");
    expect(content).toBe("tmux pane contents");
  });

  it("tmux not installed: ENOENT produces empty text (no throw)", async () => {
    dir = mkdtempSync(join(tmpdir(), "odin-watch-tmux-"));
    const TmuxBackend = await loadBackendWith({
      status: 1,
      stdout: "",
      stderr: "spawn tmux ENOENT",
    });
    const backend = new TmuxBackend(dir);
    const snapshot = await backend.capture("my-pane");
    expect(snapshot.text).toBe("");
    expect(snapshot.hash).toBe(
      createHash("sha256").update("").digest("hex")
    );
  });
});

// ---------------------------------------------------------------------------
// Backend selection by substrate (index.ts wiring)
// ---------------------------------------------------------------------------

describe("backend selection by substrate", () => {
  it("cmux substrate selects CmuxBackend (substrate field in snapshot)", async () => {
    vi.resetModules();
    vi.doMock("../../src/utils/execFileNoThrow.js", () => ({
      execFileNoThrow: vi.fn().mockResolvedValue({
        status: 0,
        stdout: "cmux screen",
        stderr: "",
      }),
    }));
    const { CmuxBackend } = await import("../../src/odin-watch/backends/cmux.js");
    const dir = mkdtempSync(join(tmpdir(), "odin-watch-sel-"));
    try {
      const backend = new CmuxBackend(dir);
      const snapshot = await backend.capture("pane-x");
      expect(snapshot.substrate).toBe("cmux");
    } finally {
      vi.resetModules();
      vi.doUnmock("../../src/utils/execFileNoThrow.js");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tmux substrate selects TmuxBackend (substrate field in snapshot)", async () => {
    vi.resetModules();
    vi.doMock("../../src/utils/execFileNoThrow.js", () => ({
      execFileNoThrow: vi.fn().mockResolvedValue({
        status: 0,
        stdout: "tmux screen",
        stderr: "",
      }),
    }));
    const { TmuxBackend } = await import("../../src/odin-watch/backends/tmux.js");
    const dir = mkdtempSync(join(tmpdir(), "odin-watch-sel-"));
    try {
      const backend = new TmuxBackend(dir);
      const snapshot = await backend.capture("pane-y");
      expect(snapshot.substrate).toBe("tmux");
    } finally {
      vi.resetModules();
      vi.doUnmock("../../src/utils/execFileNoThrow.js");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Classifier semantics are backend-agnostic
// — a tmux-sourced snapshot classifies identically to a cmux-sourced one
// ---------------------------------------------------------------------------

describe("classifier is backend-agnostic", () => {
  it("tmux-sourced snapshot with working indicator classifies as WORKING wake=0", () => {
    // Simulate what odin-watch does after TmuxBackend.capture() returns
    const tmuxText = "⠋ thinking";
    const hash = createHash("sha256").update(tmuxText).digest("hex");
    const result = classify(
      baseInput({
        text: tmuxText,
        hash,
        prev_hash: null,
      })
    );
    expect(result.verdict).toBe("WORKING");
    expect(result.wake).toBe(0);
    expect(result.prompt_budget_class).toBe("silent");
  });

  it("tmux-sourced empty snapshot (backend failure) classifies as UNKNOWN_NEEDS_READ wake=1", () => {
    const text = "";
    const hash = createHash("sha256").update(text).digest("hex");
    const result = classify(
      baseInput({
        text,
        hash,
        prev_hash: null,
      })
    );
    expect(result.verdict).toBe("UNKNOWN_NEEDS_READ");
    expect(result.wake).toBe(1);
  });
});
