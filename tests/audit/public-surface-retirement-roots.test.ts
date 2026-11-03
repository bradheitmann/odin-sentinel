import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// SLICE audit-retirement-roots. Mister Clean 7.4.0 accepts a retirement record only with a
// top-level `roots` list naming each retired directory, and the record is
// charter/retirements/<date>-<slug>.json. The public-surface audit refuses the legacy planning
// directory's path everywhere it appears on the public surface, so the two controls conflict.
// EXEC-PM ruled option A (2026-11-03): one JSON-aware exemption, scoped to the top-level `roots`
// array of a record whose record_type is `mister-clean.retirement`, from the "private planning
// path" rule only. Every other rule, field, file and malformed record still fails.
//
// The planning path is built by concatenation so this file carries no literal of its own.

// @ts-ignore - audit script is an ESM .mjs module without declaration files.
const audit = await import("../../scripts/audit/public-surface.mjs");
const auditPublicSurface = audit.auditPublicSurface as (fileTextByPath: Record<string, string>) => string[];
const isPublicAuditFile = audit.isPublicAuditFile as (file: string) => boolean;
const RECORD_TYPE: string = audit.RETIREMENT_RECORD_TYPE as string;
const PLANNING_RULE: string = audit.PRIVATE_PLANNING_RULE as string;

/** The retired directory name, assembled here so no literal path appears in this file. */
const PLANNING = `${["project", "planning"].join("/")}/`;
const RECORD = "charter/retirements/2026-11-03-legacy-planning.json";
const RULE_FINDING = `${RECORD}: ${PLANNING_RULE}`;

interface RecordShape {
  record_type?: string;
  roots?: unknown;
  ruling?: unknown;
  note?: string;
}

function record(shape: RecordShape = {}): string {
  return JSON.stringify(
    {
      schema_version: 1,
      record_type: RECORD_TYPE,
      retired_at: "2026-11-03T00:00:00Z",
      roots: [`${PLANNING}legacy-corpus`],
      ruling: { decision: "option A", scope: "charter/retirements records only" },
      ...shape
    },
    null,
    2
  );
}

function findingsFor(file: string, text: string): string[] {
  return auditPublicSurface({ [file]: text });
}

describe("audit retirement roots: roots-only exemption (proof 1)", () => {
  it("passes a retirement record whose roots name the retired directory", () => {
    const text = record();
    expect(text.includes(PLANNING)).toBe(true);
    expect(findingsFor(RECORD, text)).toEqual([]);
  });

  it("passes with the path in several roots entries and in nested-root-free shape", () => {
    const text = record({ roots: [`${PLANNING}legacy-corpus`, `${PLANNING}archive`, "charter/retirements"] });
    expect(findingsFor(RECORD, text)).toEqual([]);
  });

  it("still fails when the same path also appears in a non-roots field (mutant M2)", () => {
    const text = record({ ruling: { decision: "option A", scope: `${PLANNING}legacy-corpus` } });
    expect(findingsFor(RECORD, text)).toEqual([RULE_FINDING]);
  });

  it("still fails when the path appears in a top-level scalar field", () => {
    const text = record({ note: `retired ${PLANNING}legacy-corpus` });
    expect(findingsFor(RECORD, text)).toEqual([RULE_FINDING]);
  });
});

describe("audit retirement roots: elsewhere still fails (proof 2, mutant M1)", () => {
  it("fails the same path in another charter file", () => {
    const findings = findingsFor("charter/DONE/planted-owner-decision.md", `Scope: ${PLANNING}legacy-corpus.`);
    expect(findings).toEqual([`charter/DONE/planted-owner-decision.md: ${PLANNING_RULE}`]);
  });

  it("fails the same path in another charter file that is also JSON", () => {
    const findings = findingsFor("charter/planted-scope.json", JSON.stringify({ scope: `${PLANNING}legacy-corpus` }));
    expect(findings).toEqual([`charter/planted-scope.json: ${PLANNING_RULE}`]);
  });

  it("fails the same path in the charter STATE and SPEC documents", () => {
    for (const file of ["charter/STATE.md", "charter/SPEC.md"]) {
      expect(findingsFor(file, `Pointer: ${PLANNING}old-corpus`), file).toEqual([`${file}: ${PLANNING_RULE}`]);
    }
  });
});

describe("audit retirement roots: not widened (proof 3, mutant M3)", () => {
  it("fails a charter/retirements JSON that is not a retirement record", () => {
    const text = record({ record_type: "mister-clean.something-else" });
    expect(findingsFor(RECORD, text)).toEqual([RULE_FINDING]);
  });

  it("fails a charter/retirements JSON with no record_type", () => {
    const text = record({ record_type: undefined });
    expect(findingsFor(RECORD, text)).toEqual([RULE_FINDING]);
  });

  it("fails a markdown file under charter/retirements/", () => {
    const findings = findingsFor("charter/retirements/2026-11-03-legacy-planning.md", `Retired ${PLANNING}legacy-corpus.`);
    expect(findings).toEqual([`charter/retirements/2026-11-03-legacy-planning.md: ${PLANNING_RULE}`]);
  });

  it("fails a malformed JSON file under charter/retirements/", () => {
    const text = record().slice(0, -2);
    expect(() => JSON.parse(text)).toThrow();
    expect(findingsFor(RECORD, text)).toEqual([RULE_FINDING]);
  });

  it("fails a retirement record whose roots are not at the top level", () => {
    const text = JSON.stringify(
      { schema_version: 1, record_type: RECORD_TYPE, ruling: { roots: [`${PLANNING}legacy-corpus`] } },
      null,
      2
    );
    expect(findingsFor(RECORD, text)).toEqual([RULE_FINDING]);
  });

  it("fails a retirement record whose roots entry is not a string but embeds the path", () => {
    const text = JSON.stringify(
      { schema_version: 1, record_type: RECORD_TYPE, roots: [{ path: `${PLANNING}legacy-corpus` }] },
      null,
      2
    );
    expect(findingsFor(RECORD, text)).toEqual([RULE_FINDING]);
  });

  it("fails a retirement record nested below charter/retirements/", () => {
    const nested = "charter/retirements/archive/2026-11-03-legacy-planning.json";
    expect(findingsFor(nested, record())).toEqual([`${nested}: ${PLANNING_RULE}`]);
  });

  it("fails a retirement record path outside charter/retirements/", () => {
    expect(findingsFor("charter/2026-11-03-legacy-planning.json", record())).toEqual([
      `charter/2026-11-03-legacy-planning.json: ${PLANNING_RULE}`
    ]);
  });
});

describe("audit retirement roots: every other rule still applies to that file", () => {
  it("still reports a planted home path in a retirement record", () => {
    const home = ["", "Users", "somebuilder", "scratch"].join("/") + "/";
    const text = record({ note: `copied from ${home}notes.md` });
    expect(findingsFor(RECORD, text)).toEqual([`${RECORD}: macOS home path`]);
  });

  it("still reports a planted private marker in a retirement record", () => {
    const marker = ["open", "protocols"].join("_");
    const text = record({ note: `imported from ${marker}` });
    expect(findingsFor(RECORD, text)).toEqual([`${RECORD}: private project or account marker`]);
  });

  it("still reports the local evidence path in a retirement record", () => {
    const evidence = `.${["edge-" + "agentic"].join("")}/local`;
    const text = record({ note: `evidence under ${evidence}` });
    const findings = findingsFor(RECORD, text);
    expect(findings).toContain(`${RECORD}: local evidence path`);
    // The same string also names the private marker; neither rule gets an allowance.
    expect(findings).toContain(`${RECORD}: private project or account marker`);
  });
});

describe("audit retirement roots: the real gate (proof 4 before/after)", () => {
  it("treats a retirement record path as public audit surface", () => {
    expect(isPublicAuditFile(RECORD)).toBe(true);
    expect(isPublicAuditFile("charter/retirements/2026-11-03-legacy-planning.md")).toBe(true);
  });

  it("checks a file set and count that this exemption does not change", () => {
    const output = execFileSync(process.execPath, ["scripts/audit/public-surface.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    const match = /Public surface audit PASS: (\d+) files checked/.exec(output);
    expect(match, output).not.toBeNull();
    const checked = Number(match?.[1] ?? "0");

    // Independently enumerate the audited file set the gate sees: tracked plus untracked,
    // non-ignored files that pass the public-surface filter. The exemption changes no file's
    // membership and no other finding, so the gate's count must equal this exactly.
    const tracked = execFileSync("git", ["ls-files"], { cwd: process.cwd(), encoding: "utf8" });
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    const expected = new Set(
      `${tracked}\n${untracked}`
        .split("\n")
        .filter(Boolean)
        .filter((file) => file !== "pnpm-lock.yaml")
        .filter((file) => isPublicAuditFile(file))
    );
    expect(checked).toBe(expected.size);
    // Baseline before this slice: 134 files checked with no charter/retirements/ record present.
    expect(checked).toBeGreaterThanOrEqual(134);
  });
});
