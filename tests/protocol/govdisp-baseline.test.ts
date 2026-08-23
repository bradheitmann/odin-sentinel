import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ATTEMPT_EVENT_TYPES,
  BREAK_GLASS_EVENT_TYPES,
  BUDGET_EVENT_TYPES,
  FINDING_EVENT_TYPES,
  GOVDISP_EVENT_CLASSES,
  GOVDISP_EVENT_SCHEMA_VERSION,
  TERMINAL_EVENT_TYPES,
  type BreakGlassEvent,
  type GovdispEvent,
  type StableObjectiveId,
  type TerminalEvent
} from "../../src/protocol/event-registry/types.js";
import {
  attemptEventSchema,
  breakGlassEventSchema,
  budgetEventSchema,
  findingEventSchema,
  govdispEventSchema,
  stableObjectiveIdSchema,
  terminalEventSchema
} from "../../src/protocol/schemas.js";

// @ts-ignore - audit script is an ESM .mjs module without declaration files.
const generator = await import("../../scripts/audit/generate-govdisp-baseline.mjs");

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = join(repoRoot, "tests/fixtures/govdisp/baseline-manifest.json");
const typesModulePath = "src/protocol/event-registry/types.ts";
const schemasPath = "src/protocol/schemas.ts";

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walkFiles(path) : [path];
  });
}

function toPosix(filePath: string): string {
  return filePath.split("\\").join("/");
}

function repoText(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function eventBase() {
  return {
    schema_version: GOVDISP_EVENT_SCHEMA_VERSION,
    event_id: "evt-1",
    ts: "2026-08-14T13:24:00Z",
    stable_objective_id: "obj-govdisp-w0a"
  };
}

describe("govdisp Wave-0 baseline manifest", () => {
  it("regenerates the committed fixture byte-for-byte and covers every protocol surface file", () => {
    const generated = generator.serializeManifest(generator.generateBaselineManifest(repoRoot));
    const committed = readFileSync(fixturePath, "utf8");
    expect(generated).toBe(committed);

    const manifest = JSON.parse(committed) as {
      schema: string;
      roots: string[];
      file_count: number;
      files: Array<{ path: string; bytes: number; sha256: string }>;
    };
    expect(manifest.schema).toBe(generator.GOVDISP_BASELINE_SCHEMA);
    expect(manifest.roots).toEqual(generator.GOVDISP_BASELINE_ROOTS);

    const expected = generator.GOVDISP_BASELINE_ROOTS.flatMap((root: string) =>
      walkFiles(join(repoRoot, root)).map((absPath) => toPosix(absPath.slice(repoRoot.length).replace(/^\//, "")))
    ).sort((a: string, b: string) => a.localeCompare(b));
    expect(manifest.files.map((entry) => entry.path)).toEqual(expected);
    expect(manifest.file_count).toBe(expected.length);
    expect(manifest.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
  });
});

describe("govdisp typed event union", () => {
  it("exports stable_objective_id typing and the five event-class families", () => {
    const objectiveId: StableObjectiveId = "obj-govdisp-w0a";
    expect(stableObjectiveIdSchema.parse(objectiveId)).toBe(objectiveId);
    expect(GOVDISP_EVENT_CLASSES).toEqual(["ATTEMPT", "FINDING", "BREAK_GLASS", "BUDGET", "TERMINAL", "AUDIT"]);
    expect(ATTEMPT_EVENT_TYPES.every((name) => name.startsWith("ATTEMPT_"))).toBe(true);
    expect(FINDING_EVENT_TYPES.every((name) => name.startsWith("FINDING_"))).toBe(true);
    expect(BREAK_GLASS_EVENT_TYPES.every((name) => name.startsWith("BREAK_GLASS_"))).toBe(true);
    expect(BUDGET_EVENT_TYPES.every((name) => name.startsWith("BUDGET_"))).toBe(true);
    expect(TERMINAL_EVENT_TYPES.every((name) => name.startsWith("TERMINAL_"))).toBe(true);
  });

  it("accepts one valid event per class and requires break-glass and terminal fields", () => {
    const attempt = {
      ...eventBase(),
      event_class: "ATTEMPT" as const,
      event_type: "ATTEMPT_STARTED" as const,
      attempt_index: 1,
      trigger: "start" as const
    };
    const finding = {
      ...eventBase(),
      event_class: "FINDING" as const,
      event_type: "FINDING_OPENED" as const,
      finding_id: "finding-1"
    };
    const breakGlass: BreakGlassEvent = {
      ...eventBase(),
      event_class: "BREAK_GLASS",
      event_type: "BREAK_GLASS_RECORDED",
      authorizing_human: "operator",
      contradiction_ref: "GDR-20260808-001"
    };
    const budget = {
      ...eventBase(),
      event_class: "BUDGET" as const,
      event_type: "BUDGET_EXHAUSTED" as const,
      budget_kind: "tokens" as const
    };
    const terminal: TerminalEvent = {
      ...eventBase(),
      event_class: "TERMINAL",
      event_type: "TERMINAL_BLOCKED",
      content_hashes: [{ path: typesModulePath, sha256: "a".repeat(64) }]
    };

    const events: GovdispEvent[] = [attempt, finding, breakGlass, budget, terminal];
    expect(events.map((event) => govdispEventSchema.parse(event))).toEqual(events);
    expect(attemptEventSchema.parse(attempt).event_class).toBe("ATTEMPT");
    expect(findingEventSchema.parse(finding).event_class).toBe("FINDING");
    expect(breakGlassEventSchema.parse(breakGlass).authorizing_human).toBe("operator");
    expect(budgetEventSchema.parse(budget).budget_kind).toBe("tokens");
    expect(terminalEventSchema.parse(terminal).content_hashes).toHaveLength(1);

    expect(() => breakGlassEventSchema.parse({ ...breakGlass, authorizing_human: undefined })).toThrow();
    expect(() => breakGlassEventSchema.parse({ ...breakGlass, contradiction_ref: "" })).toThrow();
    expect(() => terminalEventSchema.parse({ ...terminal, content_hashes: [] })).toThrow();
    expect(() => govdispEventSchema.parse({ ...terminal, content_hashes: undefined })).toThrow();
  });
});

describe("govdisp runtime isolation", () => {
  it("does not import event-registry types outside tests/ and schemas.ts", () => {
    const importPattern = /from\s+["'][^"']*event-registry(?:\/types)?(?:\.js)?["']|require\(\s*["'][^"']*event-registry/;
    const scanRoots = ["src", "scripts"];
    const offenders = scanRoots
      .flatMap((root) => walkFiles(join(repoRoot, root)))
      .map((absPath) => toPosix(absPath.slice(repoRoot.length).replace(/^\//, "")))
      .filter((relativePath) => /\.(ts|js|mjs|cjs)$/.test(relativePath))
      .filter((relativePath) => relativePath !== typesModulePath)
      .filter((relativePath) => relativePath !== schemasPath)
      .filter((relativePath) => importPattern.test(repoText(relativePath)));

    expect(offenders).toEqual([]);
    expect(repoText(schemasPath)).toMatch(/event-registry\/types/);
    expect(repoText("src/protocol/service.ts")).not.toMatch(/event-registry/);
    expect(repoText("src/mcp/server.ts")).not.toMatch(/event-registry/);
  });
});
