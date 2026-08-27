import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { createFileProtocolRepository } from "../../src/protocol/repository.js";
import { canonicalHarnessId, getHarnessProbeMatrix } from "../../src/protocol/service.js";

// ---------------------------------------------------------------------------
// STORY-GOVTRUTH-R4 — harness matrix single source of truth parity test.
//
// Sources compared (by canonical snake_case machine id only — AC7):
//   1. protocol/resources/harness-control-matrix.yaml   (the SOLE source, AC1)
//   2. protocol/receipts/harness-probe-matrix.yaml      (mirror/transport)
//   3. the API default probe output (getHarnessProbeMatrix rows)
//
// Negative fixtures use the SCRATCH-COPY pattern: the protocol tree is copied
// aside, the copy is mutated, the parity check runs against the copy, and the
// copy is discarded. The live tree is never edited.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RESOURCE_PATH = "protocol/resources/harness-control-matrix.yaml";
const RECEIPT_PATH = "protocol/receipts/harness-probe-matrix.yaml";
const API_SOURCE = "API default probe output";

const EXPECTED_IDS = [
  "claude_code",
  "droid",
  "opencode",
  "crush",
  "pi",
  "codex",
  "goose",
  "openhands",
  "kilocode",
  "aider",
  "nanocoder"
].sort();

const COMPARED_FIELDS = [
  "version_pin",
  "submit_profile",
  "newline_policy",
  "quit_verb",
  "model_set_recipe",
  "control_recipe"
] as const;

const SUBMIT_PROFILE_ENUM = ["single_line_flatten", "double_enter", "single_enter_verify"];

type RawEntry = Record<string, unknown>;

function readYamlFile(root: string, relPath: string): Record<string, unknown> {
  return YAML.parse(readFileSync(join(root, relPath), "utf8")) as Record<string, unknown>;
}

function writeYamlFile(root: string, relPath: string, value: Record<string, unknown>): void {
  writeFileSync(join(root, relPath), YAML.stringify(value), "utf8");
}

function resourceEntries(root: string): RawEntry[] {
  const doc = readYamlFile(root, RESOURCE_PATH);
  const matrix = doc.harness_control_matrix as Record<string, unknown>;
  return (matrix.harnesses as RawEntry[]) ?? [];
}

function receiptEntries(root: string): RawEntry[] {
  const doc = readYamlFile(root, RECEIPT_PATH);
  return (doc.harnesses as RawEntry[]) ?? [];
}

function idsOf(entries: RawEntry[]): string[] {
  return entries.map((entry) => String(entry.harness_id));
}

function membershipViolations(sourceA: string, idsA: string[], sourceB: string, idsB: string[]): string[] {
  const violations: string[] = [];
  const setA = new Set(idsA);
  const setB = new Set(idsB);
  for (const id of idsA) {
    if (!setB.has(id)) {
      violations.push(`membership drift: harness "${id}" is present in ${sourceA} but absent from ${sourceB} — diverging source: ${sourceA}`);
    }
  }
  for (const id of idsB) {
    if (!setA.has(id)) {
      violations.push(`membership drift: harness "${id}" is present in ${sourceB} but absent from ${sourceA} — diverging source: ${sourceB}`);
    }
  }
  return violations;
}

/**
 * The parity check itself: returns [] when the resource, the receipt, and the
 * API default probe output agree on membership (canonical ids) and on every
 * compared recipe field. Each violation message names the diverging source
 * with the divergent value.
 */
function computeParityViolations(root: string): string[] {
  const violations: string[] = [];
  const resource = resourceEntries(root);
  const receipt = receiptEntries(root);
  const resourceIds = idsOf(resource);
  const receiptIds = idsOf(receipt);

  // Membership parity: resource <-> receipt, by canonical id only.
  violations.push(...membershipViolations(RESOURCE_PATH, resourceIds, RECEIPT_PATH, receiptIds));

  // Value parity: resource <-> receipt for every shared id.
  const receiptById = new Map(receipt.map((entry) => [String(entry.harness_id), entry]));
  for (const entry of resource) {
    const id = String(entry.harness_id);
    const mirror = receiptById.get(id);
    if (!mirror) continue;
    for (const field of COMPARED_FIELDS) {
      const a = entry[field] ?? null;
      const b = mirror[field] ?? null;
      if (a !== b) {
        violations.push(
          `value drift for harness "${id}" field "${field}": ${RESOURCE_PATH} declares ${JSON.stringify(a)} but ${RECEIPT_PATH} declares ${JSON.stringify(b)}`
        );
      }
    }
  }

  // Membership parity: resource <-> API default probe output (which is also
  // the default probe list — the API derives it from the resource at runtime).
  const repository = createFileProtocolRepository(root);
  const matrix = getHarnessProbeMatrix({}, repository);
  const rows = matrix.rows as Array<Record<string, unknown>>;
  const apiIds = rows.map((row) => String(row.harnessId));
  violations.push(...membershipViolations(RESOURCE_PATH, resourceIds, API_SOURCE, apiIds));

  return violations;
}

/** Scratch-copy pattern: copy the protocol tree aside, mutate the copy, run,
 *  discard. Never mutates the live tree. */
function withScratchProtocol<T>(mutate: (scratchRoot: string) => void, run: (scratchRoot: string) => T): T {
  const scratchRoot = mkdtempSync(join(tmpdir(), "govtruth-r4-"));
  try {
    cpSync(join(REPO_ROOT, "protocol"), join(scratchRoot, "protocol"), { recursive: true });
    mutate(scratchRoot);
    return run(scratchRoot);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

function mutateResource(root: string, mutator: (doc: Record<string, unknown>) => void): void {
  const doc = readYamlFile(root, RESOURCE_PATH);
  mutator(doc);
  writeYamlFile(root, RESOURCE_PATH, doc);
}

function mutateReceipt(root: string, mutator: (doc: Record<string, unknown>) => void): void {
  const doc = readYamlFile(root, RECEIPT_PATH);
  mutator(doc);
  writeYamlFile(root, RECEIPT_PATH, doc);
}

const PHANTOM_ENTRY: RawEntry = {
  harness_id: "phantom_harness",
  display_name: "Phantom Harness",
  verified: false,
  quit_verb: "/exit",
  model_set_recipe: "/model <name>",
  control_recipe: "clear-before-send: ctrl+u; quit: /exit"
};

describe("harness matrix single source of truth (STORY-GOVTRUTH-R4)", () => {
  it("holds full parity across resource, receipt, and API output on the live tree", () => {
    expect(computeParityViolations(REPO_ROOT)).toEqual([]);
  });

  it("carries the canonical eleven harnesses by snake_case machine id, including opencode, in every source", () => {
    const resourceIds = idsOf(resourceEntries(REPO_ROOT)).sort();
    const receiptIds = idsOf(receiptEntries(REPO_ROOT)).sort();
    expect(resourceIds).toEqual(EXPECTED_IDS);
    expect(receiptIds).toEqual(EXPECTED_IDS);
    for (const id of resourceIds) {
      expect(id).toMatch(/^[a-z0-9_]+$/);
    }

    const rows = getHarnessProbeMatrix({}).rows as Array<Record<string, unknown>>;
    expect(rows.map((row) => String(row.harnessId)).sort()).toEqual(EXPECTED_IDS);
    expect(rows.map((row) => String(row.harnessId))).toContain("opencode");
  });

  it("exposes all six recipe fields on every probe row, with versionPin read from the resource", () => {
    const rows = getHarnessProbeMatrix({}).rows as Array<Record<string, unknown>>;
    const entriesById = new Map(resourceEntries(REPO_ROOT).map((entry) => [String(entry.harness_id), entry]));
    for (const row of rows) {
      for (const field of ["versionPin", "submitProfile", "newlinePolicy", "quitVerb", "modelSetRecipe", "controlRecipe"]) {
        expect(Object.keys(row)).toContain(field);
      }
      const entry = entriesById.get(String(row.harnessId)) as RawEntry;
      expect(row.versionPin).toBe(entry.version_pin ?? null);
      expect(row.quitVerb).toBe(entry.quit_verb);
      expect(row.controlRecipe).toBe(entry.control_recipe);
      expect(row.modelSetRecipe).toBe(entry.model_set_recipe);
    }
  });

  it("labels unverified entries: verified false, no version pin, recipeVerification unverified (AC4)", () => {
    const rows = getHarnessProbeMatrix({}).rows as Array<Record<string, unknown>>;
    const unverifiedIds = ["codex", "goose", "openhands", "kilocode", "aider", "nanocoder"];
    for (const id of unverifiedIds) {
      const row = rows.find((candidate) => candidate.harnessId === id) as Record<string, unknown>;
      expect(row.verified).toBe(false);
      expect(row.recipeVerification).toBe("unverified");
      expect(row.versionPin).toBeNull();
    }
    for (const entry of [...resourceEntries(REPO_ROOT), ...receiptEntries(REPO_ROOT)]) {
      if (entry.verified === false) {
        expect(entry.version_pin).toBeUndefined();
      } else {
        expect(entry.verified).toBe(true);
        expect(typeof entry.version_pin).toBe("string");
        expect(String(entry.version_pin)).not.toMatch(/^(latest|\*|any)$/i);
      }
    }
  });

  it("treats display_name as an explicit tested field, never an inferred transform of the id (AC7)", () => {
    const expectedDisplayNames: Record<string, string> = {
      claude_code: "Claude Code",
      droid: "Droid",
      opencode: "OpenCode",
      crush: "Crush",
      pi: "Pi",
      codex: "Codex",
      goose: "Goose",
      openhands: "OpenHands",
      kilocode: "KiloCode",
      aider: "Aider",
      nanocoder: "NanoCoder"
    };
    const receiptById = new Map(receiptEntries(REPO_ROOT).map((entry) => [String(entry.harness_id), entry]));
    for (const entry of resourceEntries(REPO_ROOT)) {
      const id = String(entry.harness_id);
      expect(entry.display_name).toBe(expectedDisplayNames[id]);
      expect((receiptById.get(id) as RawEntry).display_name).toBe(expectedDisplayNames[id]);
      // The canonical id is already-exact declared data: canonicalHarnessId
      // accepts it verbatim and NEVER derives it from the display name (or
      // from any other string) by folding or transform.
      expect(canonicalHarnessId(id)).toBe(id);
      expect(() => canonicalHarnessId(String(entry.display_name))).toThrow(/non_canonical_harness_id/);
    }
    const rows = getHarnessProbeMatrix({}).rows as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row.displayName).toBe(expectedDisplayNames[String(row.harnessId)]);
    }
  });

  it("keeps every submit_profile enum-legal in both sources; claude_code is double_enter, pi pins 0.79.6+ (AC5)", () => {
    for (const [source, entries] of [
      [RESOURCE_PATH, resourceEntries(REPO_ROOT)],
      [RECEIPT_PATH, receiptEntries(REPO_ROOT)]
    ] as Array<[string, RawEntry[]]>) {
      for (const entry of entries) {
        if (entry.submit_profile !== undefined) {
          expect(SUBMIT_PROFILE_ENUM, `${source} entry ${String(entry.harness_id)}`).toContain(entry.submit_profile);
        }
      }
      const claudeCode = entries.find((entry) => entry.harness_id === "claude_code") as RawEntry;
      expect(claudeCode.submit_profile).toBe("double_enter");
      const pi = entries.find((entry) => entry.harness_id === "pi") as RawEntry;
      expect(pi.version_pin).toBe("0.79.6+");
    }
    expect(readFileSync(join(REPO_ROOT, RECEIPT_PATH), "utf8")).not.toContain("multi_line");
  });

  // --- AC7 fail-closed identity: exact canonical match only, never folding ---

  it("resolves an exact canonical snake_case id to its resource-backed member", () => {
    for (const id of ["droid", "goose", "kilocode", "claude_code"]) {
      expect(canonicalHarnessId(id)).toBe(id);
      const rows = getHarnessProbeMatrix({ intendedHarnesses: [id] }).rows as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0].harnessId).toBe(id);
    }
    // Resource-backed, not fabricated: the row carries the entry's declared fields.
    const entriesById = new Map(resourceEntries(REPO_ROOT).map((entry) => [String(entry.harness_id), entry]));
    const [droidRow] = getHarnessProbeMatrix({ intendedHarnesses: ["droid"] }).rows as Array<Record<string, unknown>>;
    const droidEntry = entriesById.get("droid") as RawEntry;
    expect(droidRow.displayName).toBe(droidEntry.display_name);
    expect(droidRow.versionPin).toBe(droidEntry.version_pin ?? null);
    expect(droidRow.controlRecipe).toBe(droidEntry.control_recipe);
  });

  it("REFUSES case-respelled harness ids by name — fail closed, never silently case-folded (AC7)", () => {
    for (const respelled of ["DROID", "GOOsE", "kilOcode", "Claude_Code", "OPENCODE"]) {
      // The canonical-id primitive itself refuses the non-canonical form by name.
      expect(() => canonicalHarnessId(respelled)).toThrow(/non_canonical_harness_id/);
      expect(() => canonicalHarnessId(respelled)).toThrow(new RegExp(`"${respelled}"`));
      // And the resolution path refuses it end-to-end: no resource-backed row.
      expect(() => getHarnessProbeMatrix({ intendedHarnesses: [respelled] })).toThrow(/unknown_or_non_canonical_harness/);
      expect(() => getHarnessProbeMatrix({ intendedHarnesses: [respelled] })).toThrow(new RegExp(`"${respelled}"`));
    }
    // A respelled id never silently folds into membership even when mixed
    // with valid names — the whole probe is refused, naming the bad form.
    expect(() => getHarnessProbeMatrix({ intendedHarnesses: ["droid", "GOOsE"] })).toThrow(/"GOOsE"/);
  });

  it("keeps the explicit display_name channel unaffected: exact declared display names still resolve (AC7)", () => {
    const rows = getHarnessProbeMatrix({
      intendedHarnesses: ["Droid", "Goose", "KiloCode", "Claude Code"]
    }).rows as Array<Record<string, unknown>>;
    expect(rows.map((row) => String(row.harnessId))).toEqual(["droid", "goose", "kilocode", "claude_code"]);
    expect(rows.map((row) => String(row.displayName))).toEqual(["Droid", "Goose", "KiloCode", "Claude Code"]);
  });

  // --- Negative fixtures: BOTH drift directions, scratch-copy pattern (AC6) ---

  it("fails on membership drift injected into the RESOURCE, naming the resource as the diverging source", () => {
    const violations = withScratchProtocol(
      (root) => mutateResource(root, (doc) => {
        ((doc.harness_control_matrix as Record<string, unknown>).harnesses as RawEntry[]).push({ ...PHANTOM_ENTRY });
      }),
      (root) => computeParityViolations(root)
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((violation) =>
      violation.includes("phantom_harness") && violation.includes(`diverging source: ${RESOURCE_PATH}`)
    )).toBe(true);
  });

  it("fails on membership drift injected into the RECEIPT, naming the receipt as the diverging source", () => {
    const violations = withScratchProtocol(
      (root) => mutateReceipt(root, (doc) => {
        (doc.harnesses as RawEntry[]).push({ ...PHANTOM_ENTRY });
      }),
      (root) => computeParityViolations(root)
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((violation) =>
      violation.includes("phantom_harness") && violation.includes(`diverging source: ${RECEIPT_PATH}`)
    )).toBe(true);
  });

  it("fails on value drift injected into the RESOURCE (pi version pin), citing the resource's divergent value", () => {
    const violations = withScratchProtocol(
      (root) => mutateResource(root, (doc) => {
        const entries = (doc.harness_control_matrix as Record<string, unknown>).harnesses as RawEntry[];
        const pi = entries.find((entry) => entry.harness_id === "pi") as RawEntry;
        pi.version_pin = "0.80.0+";
        pi.harness_version = "0.80.0+";
      }),
      (root) => computeParityViolations(root)
    );
    expect(violations.some((violation) =>
      violation.includes('harness "pi" field "version_pin"') &&
      violation.includes(`${RESOURCE_PATH} declares "0.80.0+"`)
    )).toBe(true);
  });

  it("fails on value drift injected into the RECEIPT (pi version pin), citing the receipt's divergent value", () => {
    const violations = withScratchProtocol(
      (root) => mutateReceipt(root, (doc) => {
        const pi = (doc.harnesses as RawEntry[]).find((entry) => entry.harness_id === "pi") as RawEntry;
        pi.version_pin = "9.9.9+";
      }),
      (root) => computeParityViolations(root)
    );
    expect(violations.some((violation) =>
      violation.includes('harness "pi" field "version_pin"') &&
      violation.includes(`${RECEIPT_PATH} declares "9.9.9+"`)
    )).toBe(true);
  });

  it("fails on submit_profile drift injected into the RECEIPT (the historical multi_line defect direction)", () => {
    const violations = withScratchProtocol(
      (root) => mutateReceipt(root, (doc) => {
        const claudeCode = (doc.harnesses as RawEntry[]).find((entry) => entry.harness_id === "claude_code") as RawEntry;
        claudeCode.submit_profile = "multi_line";
      }),
      (root) => computeParityViolations(root)
    );
    expect(violations.some((violation) =>
      violation.includes('harness "claude_code" field "submit_profile"') &&
      violation.includes(`${RECEIPT_PATH} declares "multi_line"`)
    )).toBe(true);
  });

  // --- AC8: versionPin is READ on an executable path ---

  it("follows a scratch mutation of the resource's pin in the API answer (versionPin is read, not dead data)", () => {
    withScratchProtocol(
      (root) => mutateResource(root, (doc) => {
        const entries = (doc.harness_control_matrix as Record<string, unknown>).harnesses as RawEntry[];
        const claudeCode = entries.find((entry) => entry.harness_id === "claude_code") as RawEntry;
        claudeCode.version_pin = "9.9.9+";
        claudeCode.harness_version = "9.9.9+";
      }),
      (root) => {
        const repository = createFileProtocolRepository(root);
        const rows = getHarnessProbeMatrix({}, repository).rows as Array<Record<string, unknown>>;
        const row = rows.find((candidate) => candidate.harnessId === "claude_code") as Record<string, unknown>;
        expect(row.versionPin).toBe("9.9.9+");
        // The live tree still answers with the real pin — proof the mutated
        // answer came from the scratch resource, not a constant.
        const liveRows = getHarnessProbeMatrix({}).rows as Array<Record<string, unknown>>;
        const liveRow = liveRows.find((candidate) => candidate.harnessId === "claude_code") as Record<string, unknown>;
        expect(liveRow.versionPin).toBe("2.1.170+");
        return undefined;
      }
    );
  });

  it("fails closed when an unverified entry is injected WITH a version pin (no unverified recipe presents as pinned)", () => {
    withScratchProtocol(
      (root) => mutateResource(root, (doc) => {
        const entries = (doc.harness_control_matrix as Record<string, unknown>).harnesses as RawEntry[];
        const codex = entries.find((entry) => entry.harness_id === "codex") as RawEntry;
        codex.version_pin = "1.0.0+";
      }),
      (root) => {
        const repository = createFileProtocolRepository(root);
        expect(() => getHarnessProbeMatrix({}, repository)).toThrow(/unverified entry "codex" must NOT carry a version_pin/);
        return undefined;
      }
    );
  });
});
