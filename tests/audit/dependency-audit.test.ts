import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// @ts-ignore - audit script is an ESM .mjs module without declaration files.
const gate = await import("../../scripts/audit/dependency-audit.mjs");

/** Fixed evaluation instant so expiry assertions never depend on the wall clock. */
const NOW = new Date("2026-09-01T12:00:00Z");
const MS_PER_DAY = 86_400_000;

function repoText(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function daysFromNow(days: number): string {
  return new Date(Date.UTC(2026, 8, 1) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function exception(overrides: Record<string, unknown> = {}) {
  return {
    advisory: "GHSA-aaaa-bbbb-cccc",
    owner: "Release owner",
    expires: daysFromNow(30),
    rationale: "Fixture entry.",
    ...overrides
  };
}

function manifest(exceptions: unknown[]) {
  return { version: 1, exceptions };
}

function advisory(overrides: Record<string, unknown> = {}) {
  return {
    github_advisory_id: "GHSA-aaaa-bbbb-cccc",
    severity: "high",
    module_name: "fixture-package",
    title: "Fixture advisory",
    ...overrides
  };
}

/** A pnpm-audit-format JSON report, as consumed through the injection seam. */
function report(advisories: unknown[] = []): string {
  return JSON.stringify({
    advisories: Object.fromEntries(advisories.map((entry, index) => [String(index + 1), entry])),
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: advisories.length, critical: 0 } }
  });
}

function evaluate(manifestValue: unknown, reportText = report(), workspaceText: string | null = null) {
  return gate.evaluateDependencyAudit({ manifest: manifestValue, reportText, workspaceText, now: NOW });
}

const WORKSPACE_FIXTURE = ['allowBuilds:', '  esbuild: true', '', 'overrides:', '  fixture-package: "^1.2.3"', ''].join("\n");

describe("exception manifest validation", () => {
  it("accepts a well-formed entry and reports it by name, owner, and expiry", () => {
    const result = evaluate(manifest([exception()]));
    expect(result.ok).toBe(true);
    const output = result.lines.join("\n");
    expect(output).toContain("GHSA-aaaa-bbbb-cccc");
    expect(output).toContain("owner: Release owner");
    expect(output).toContain(`expires: ${daysFromNow(30)}`);
    expect(output).toContain("Dependency audit PASS");
  });

  it.each(["advisory", "owner", "expires", "rationale"])("fails when %s is missing", (field) => {
    const entry: Record<string, unknown> = exception();
    delete entry[field];
    const result = evaluate(manifest([entry]));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(`malformed — missing or empty required field(s): ${field}`);
  });

  it.each(["advisory", "owner", "expires", "rationale"])("fails when %s is whitespace only", (field) => {
    const result = evaluate(manifest([exception({ [field]: "   " })]));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("missing or empty required field(s)");
  });

  it.each([
    ["lowercase prefix", "ghsa-aaaa-bbbb-cccc"],
    ["uppercase body", "GHSA-AAAA-BBBB-CCCC"],
    ["wrong segment length", "GHSA-aaa-bbbb-cccc"],
    ["extra segment", "GHSA-aaaa-bbbb-cccc-dddd"],
    ["numeric advisory id", "1234"],
    ["surrounding text", "see GHSA-aaaa-bbbb-cccc"]
  ])("rejects a %s advisory id as malformed", (_label, id) => {
    const result = evaluate(manifest([exception({ advisory: id })]));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("malformed advisory id");
  });

  it("rejects duplicate advisory ids", () => {
    const result = evaluate(manifest([exception(), exception({ rationale: "Second copy." })]));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("duplicate advisory id");
  });

  it("treats an expiry equal to the current UTC date as EXPIRED", () => {
    const result = evaluate(manifest([exception({ expires: daysFromNow(0) })]));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("EXPIRED");
  });

  it("fails a past-dated entry", () => {
    const result = evaluate(manifest([exception({ expires: daysFromNow(-1) })]));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("EXPIRED");
  });

  it("accepts an expiry one day out and at the 90-day horizon, and rejects beyond it", () => {
    expect(evaluate(manifest([exception({ expires: daysFromNow(1) })])).ok).toBe(true);
    expect(evaluate(manifest([exception({ expires: daysFromNow(90) })])).ok).toBe(true);
    const overHorizon = evaluate(manifest([exception({ expires: daysFromNow(91) })]));
    expect(overHorizon.ok).toBe(false);
    expect(overHorizon.errors.join("\n")).toContain("over-horizon");
  });

  it.each(["20261001", "2026-13-01", "2026-02-30", "2026-10-1", "October 1 2026", "2026-10-01T00:00:00Z"])(
    "rejects %s as a malformed expiry",
    (expires) => {
      const result = evaluate(manifest([exception({ expires })]));
      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toContain("malformed expiry");
    }
  );

  it("requires the manifest to be an object declaring an exceptions array", () => {
    expect(evaluate([]).ok).toBe(false);
    expect(evaluate({ version: 1 }).errors.join("\n")).toContain("`exceptions` array");
  });

  it("validates the manifest BEFORE the audit — a bad entry fails even with an unreadable report", () => {
    const result = evaluate(manifest([exception({ expires: daysFromNow(-5) })]), "not json at all");
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("EXPIRED");
  });

  it("fails an expired entry whose advisory is absent from the tree", () => {
    const result = evaluate(manifest([exception({ expires: daysFromNow(-1) })]), report([]));
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("Manifest INVALID");
  });
});

describe("recorded pin linkage", () => {
  it("passes when the recorded pin matches the workspace overrides block", () => {
    const entry = exception({ pin: { package: "fixture-package", range: "^1.2.3" } });
    expect(evaluate(manifest([entry]), report(), WORKSPACE_FIXTURE).ok).toBe(true);
  });

  it("fails when the recorded pin has drifted from the workspace overrides block", () => {
    const entry = exception({ pin: { package: "fixture-package", range: "^9.9.9" } });
    const result = evaluate(manifest([entry]), report(), WORKSPACE_FIXTURE);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("drifted");
  });

  it("fails when the recorded pin is absent from the workspace overrides block", () => {
    const entry = exception({ pin: { package: "not-pinned", range: "^1.0.0" } });
    const result = evaluate(manifest([entry]), report(), WORKSPACE_FIXTURE);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("absent from the workspace overrides block");
  });

  it("rejects a malformed pin record", () => {
    const result = evaluate(manifest([exception({ pin: { package: "fixture-package" } })]), report(), WORKSPACE_FIXTURE);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("malformed pin");
  });

  it("reads only the top-level overrides block", () => {
    const overrides = gate.parseOverridesBlock(WORKSPACE_FIXTURE);
    expect(overrides.get("fixture-package")).toBe("^1.2.3");
    expect(overrides.has("esbuild")).toBe(false);
  });
});

describe("advisory reconciliation at the high severity floor", () => {
  it("fails on an unaccepted high advisory and names it", () => {
    const result = evaluate(manifest([]), report([advisory()]));
    expect(result.ok).toBe(false);
    const output = result.lines.join("\n");
    expect(output).toContain("UNACCEPTED high GHSA-aaaa-bbbb-cccc in fixture-package");
    expect(output).toContain("Dependency audit FAIL");
  });

  it("fails on an unaccepted critical advisory", () => {
    const result = evaluate(manifest([]), report([advisory({ severity: "critical" })]));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("unaccepted critical advisory");
  });

  it.each(["moderate", "low", "info"])("ignores a %s advisory — the floor is high", (severity) => {
    const result = evaluate(manifest([]), report([advisory({ severity })]));
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("Advisories at or above high: 0");
  });

  it("accepts a high advisory named by a valid entry and says so in the output", () => {
    const result = evaluate(manifest([exception()]), report([advisory()]));
    expect(result.ok).toBe(true);
    const output = result.lines.join("\n");
    expect(output).toContain("ACCEPTING live high advisory in fixture-package");
    expect(output).toContain("owner: Release owner");
  });

  it("does not let an entry suppress a different advisory", () => {
    const result = evaluate(manifest([exception()]), report([advisory({ github_advisory_id: "GHSA-zzzz-yyyy-xxxx" })]));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("GHSA-zzzz-yyyy-xxxx");
  });

  it("fails an advisory that carries no advisory id", () => {
    const result = evaluate(manifest([exception()]), report([advisory({ github_advisory_id: undefined })]));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("<no advisory id>");
  });

  it("reports an entry with no matching advisory instead of hiding it", () => {
    const result = evaluate(manifest([exception()]), report([]));
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("no matching advisory in the current tree");
  });
});

describe("report parsing and the injection seam", () => {
  it("reads a clean pnpm-audit-format report", () => {
    expect(gate.parseAuditReport(report([]))).toEqual([]);
  });

  it("normalizes advisory records", () => {
    expect(gate.parseAuditReport(report([advisory()]))).toEqual([
      { id: "GHSA-aaaa-bbbb-cccc", severity: "high", module: "fixture-package", title: "Fixture advisory" }
    ]);
  });

  it("rejects a report that is not JSON", () => {
    expect(() => gate.parseAuditReport("not json")).toThrow(/not valid JSON/);
  });

  it("documents the seam and leaves it inert when no input is supplied", () => {
    const options = gate.parseArgs([], {});
    expect(options.reportFile).toBeNull();
    expect(gate.parseArgs([], { [gate.REPORT_FILE_ENV_VAR]: "fixture.json" }).reportFile).toBe("fixture.json");
    expect(gate.parseArgs(["--report-file", "fixture.json"], {}).reportFile).toBe("fixture.json");
    expect(gate.parseArgs(["--workspace", "telemetry"], {}).workspaceLabel).toBe("telemetry");
    expect(() => gate.parseArgs(["--nope"], {})).toThrow(/Unknown argument/);
  });
});

describe("shipped configuration", () => {
  it("keeps the severity floor at high and gates only high and critical", () => {
    expect(gate.SEVERITY_FLOOR).toBe("high");
    expect([...gate.GATED_SEVERITIES].sort()).toEqual(["critical", "high"]);
    expect(gate.MAX_EXPIRY_HORIZON_DAYS).toBe(90);
  });

  it("records every workspace override pin in the shipped exception manifest", () => {
    const shipped = JSON.parse(repoText("scripts/audit/audit-exceptions.json"));
    const workspaceText = repoText("pnpm-workspace.yaml");
    const result = gate.evaluateDependencyAudit({
      manifest: shipped,
      reportText: report([]),
      workspaceText,
      now: NOW
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);

    for (const id of [
      "GHSA-v2v4-37r5-5v8g",
      "GHSA-qp7p-654g-cw7p",
      "GHSA-p77w-8qqv-26rm",
      "GHSA-hm8q-7f3q-5f36",
      "GHSA-q8mj-m7cp-5q26"
    ]) {
      expect(result.entries.map((entry: { advisory: string }) => entry.advisory)).toContain(id);
    }

    const pinned = new Set(result.entries.filter((entry: { pin: unknown }) => entry.pin).map((entry: { pin: { package: string } }) => entry.pin.package));
    for (const overridden of gate.parseOverridesBlock(workspaceText).keys()) {
      expect(pinned).toContain(overridden);
    }
  });

  it("puts the gate on the publish path and leaves no bare audit in the workflows", () => {
    const pkg = JSON.parse(repoText("package.json"));
    expect(pkg.scripts["audit:deps"]).toContain("scripts/audit/dependency-audit.mjs");
    expect(pkg.scripts.validate).toContain("audit:deps");
    expect(pkg.scripts.prepublishOnly).toBe("pnpm run validate");

    for (const workflow of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
      const text = repoText(workflow);
      expect(text).not.toMatch(/run:\s*pnpm audit\b/);
      expect(text).toContain("audit:deps");
      expect(text).toContain("dependency-audit.mjs --workspace telemetry");
    }
  });

  it("packages the gate and its manifest", async () => {
    // @ts-ignore - audit script is an ESM .mjs module without declaration files.
    const verifyPack = await import("../../scripts/audit/verify-pack.mjs");
    expect(verifyPack.requiredPackageFiles).toContain("scripts/audit/dependency-audit.mjs");
    expect(verifyPack.requiredPackageFiles).toContain("scripts/audit/audit-exceptions.json");
  });
});
