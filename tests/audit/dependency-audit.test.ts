import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
    const fromEnv = gate.parseArgs([], { [gate.REPORT_FILE_ENV_VAR]: "fixture.json" });
    expect(fromEnv.reportFile).toBe("fixture.json");
    expect(fromEnv.reportFileFromEnv).toBe(true);
    expect(gate.parseArgs(["--report-file", "fixture.json"], {}).reportFile).toBe("fixture.json");
    expect(gate.parseArgs(["--workspace", "telemetry"], {}).workspaceLabel).toBe("telemetry");
    expect(() => gate.parseArgs(["--nope"], {})).toThrow(/Unknown argument/);
  });

  it("AC8: the environment-variable seam requires --allow-injected-report and injects nothing alone", () => {
    const envOptions = gate.parseArgs([], { [gate.REPORT_FILE_ENV_VAR]: "fixture.json" });
    expect(envOptions.reportFile).toBe("fixture.json");
    expect(envOptions.reportFileFromEnv).toBe(true);
    expect(() => gate.assertReportFileAllowed(envOptions)).toThrow(/--allow-injected-report/);
    expect(() => gate.assertReportFileAllowed(envOptions)).toThrow(/ODIN_DEPENDENCY_AUDIT_REPORT_FILE/);

    const allowed = gate.parseArgs(["--allow-injected-report"], { [gate.REPORT_FILE_ENV_VAR]: "fixture.json" });
    expect(allowed.reportFileFromEnv).toBe(true);
    expect(allowed.allowInjectedReport).toBe(true);
    expect(() => gate.assertReportFileAllowed(allowed)).not.toThrow();

    const explicit = gate.parseArgs(["--report-file", "fixture.json"], {});
    expect(explicit.reportFileFromEnv).toBe(false);
    expect(() => gate.assertReportFileAllowed(explicit)).not.toThrow();

    const precedence = gate.parseArgs(["--report-file", "explicit.json"], { [gate.REPORT_FILE_ENV_VAR]: "env.json" });
    expect(precedence.reportFile).toBe("explicit.json");
    expect(precedence.reportFileFromEnv).toBe(false);

    const alone = gate.parseArgs(["--allow-injected-report"], {});
    expect(alone.reportFile).toBeNull();
    expect(alone.allowInjectedReport).toBe(true);
  });
});

describe("AC1-AC3 regression: fail-closed report validation", () => {
  /** A pnpm-audit-format report that also carries a top-level `error` key. */
  function reportWithError(errorValue: unknown): string {
    return JSON.stringify({
      advisories: {},
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
      error: errorValue
    });
  }

  it("AC1: rejects a top-level error key by presence, naming code/message, even with otherwise complete proof", () => {
    for (const errorValue of [null, {}, "", false]) {
      const verdict = gate.validateAuditReport(reportWithError(errorValue));
      expect(verdict.ok).toBe(false);
      expect(verdict.name).toBe("REPORT_CARRIES_ERROR_KEY");
      expect(verdict.message).toContain('"error"');
    }
    const coded = gate.validateAuditReport(
      reportWithError({ code: "ERR_PNPM_AUDIT_NO_LOCKFILE", message: "No lockfile in this directory." })
    );
    expect(coded.ok).toBe(false);
    expect(coded.message).toContain("ERR_PNPM_AUDIT_NO_LOCKFILE");
    expect(coded.message).toContain("No lockfile in this directory");
    // the error key wins even alongside otherwise complete positive proof
    const gated = evaluate(manifest([exception()]), reportWithError({ code: "E1", message: "boom" }));
    expect(gated.ok).toBe(false);
    expect(gated.lines.join("\n")).toContain("could not be verified to have run");
  });

  it("AC2: positive proof requires advisories as object/array and metadata.vulnerabilities as object", () => {
    for (const badAdvisories of ["str", 1, true, null]) {
      const verdict = gate.validateAuditReport(
        JSON.stringify({ advisories: badAdvisories, metadata: { vulnerabilities: {} } })
      );
      expect(verdict.ok).toBe(false);
      expect(verdict.message).toContain('"advisories"');
    }
    const missingAdvisories = gate.validateAuditReport(JSON.stringify({ metadata: { vulnerabilities: {} } }));
    expect(missingAdvisories.ok).toBe(false);
    expect(missingAdvisories.message).toContain('"advisories"');

    for (const badVuln of ["str", 1, true, null, []]) {
      const verdict = gate.validateAuditReport(
        JSON.stringify({ advisories: {}, metadata: { vulnerabilities: badVuln } })
      );
      expect(verdict.ok).toBe(false);
      expect(verdict.message).toContain('"metadata.vulnerabilities"');
    }
    const missingVuln = gate.validateAuditReport(JSON.stringify({ advisories: {} }));
    expect(missingVuln.ok).toBe(false);
    expect(missingVuln.message).toContain('"metadata.vulnerabilities"');

    expect(
      gate.validateAuditReport(JSON.stringify({ advisories: {}, metadata: { vulnerabilities: {} } })).ok
    ).toBe(true);
    expect(
      gate.validateAuditReport(JSON.stringify({ advisories: [], metadata: { vulnerabilities: {} } })).ok
    ).toBe(true);
  });

  it("AC3: absence is never zero — could-not-verify is a distinct named failure class", () => {
    const couldNotVerify = evaluate(
      manifest([exception()]),
      JSON.stringify({ error: { code: "ERR_PNPM_AUDIT_NO_LOCKFILE", message: "No lockfile." } })
    );
    expect(couldNotVerify.ok).toBe(false);
    const couldNotOutput = couldNotVerify.lines.join("\n");
    expect(couldNotOutput).toContain("Dependency audit FAIL: the audit could not be verified to have run");
    expect(couldNotOutput).not.toContain("0 unaccepted advisories");

    const unaccepted = evaluate(manifest([]), report([advisory()]));
    const unacceptedOutput = unaccepted.lines.join("\n");
    expect(unacceptedOutput).toContain("Dependency audit FAIL: 1 unaccepted advisory");
    expect(unacceptedOutput).not.toContain("could not be verified to have run");

    const manifestInvalid = evaluate(manifest([exception({ expires: daysFromNow(-1) })]), report([]));
    const invalidOutput = manifestInvalid.lines.join("\n");
    expect(invalidOutput).toContain("Manifest INVALID");
    expect(invalidOutput).not.toContain("could not be verified to have run");
  });
});

describe("AC4-AC7 regression: live semantics, positive control, strict JSON, source line", () => {
  it("AC4: a non-zero live exit with an error report fails; an advisory-bearing report is still reconciled", () => {
    const errorReport = JSON.stringify({
      error: { code: "ERR_PNPM_AUDIT_NO_LOCKFILE", message: "No lockfile in this directory." }
    });
    const failed = evaluate(manifest([exception()]), errorReport);
    expect(failed.ok).toBe(false);
    expect(failed.lines.join("\n")).toContain("could not be verified to have run");
    expect(failed.lines.join("\n")).toContain("ERR_PNPM_AUDIT_NO_LOCKFILE");

    const advisoryReport = evaluate(manifest([]), report([advisory()]));
    expect(advisoryReport.ok).toBe(false);
    expect(advisoryReport.lines.join("\n")).toContain("UNACCEPTED high GHSA-aaaa-bbbb-cccc");
    expect(advisoryReport.lines.join("\n")).not.toContain("could not be verified to have run");
  });

  it("AC5: positive control — a genuine clean audit passes; one unaccepted high advisory fails as unaccepted", () => {
    const clean = evaluate(manifest([exception()]), report([]));
    expect(clean.ok).toBe(true);
    expect(clean.lines.join("\n")).toContain("Dependency audit PASS");

    const oneHigh = evaluate(manifest([]), report([advisory()]));
    expect(oneHigh.ok).toBe(false);
    expect(oneHigh.lines.join("\n")).toContain("Dependency audit FAIL: 1 unaccepted advisory");
    expect(oneHigh.lines.join("\n")).not.toContain("could not be verified to have run");
  });

  it("AC6: no JSON is recovered from surrounding output", () => {
    const embedded = `prefix ${report([])} suffix`;
    const verdict = gate.validateAuditReport(embedded);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("not valid JSON");
    expect(gate.validateAuditReport(report([]).slice(0, 40)).ok).toBe(false);
    expect(gate.validateAuditReport("[1,2,3]").ok).toBe(false);
    expect(gate.validateAuditReport('"just a string"').ok).toBe(false);
    expect(evaluate(manifest([]), embedded).ok).toBe(false);
    // Rework finding 1: a UTF-8 BOM prefix must fail closed, never be
    // normalized into valid JSON by trimming (trim() treats U+FEFF as
    // whitespace, which would otherwise make the BOM-prefixed report parse).
    expect(gate.validateAuditReport(`\uFEFF${report([])}`).ok).toBe(false);
    expect(gate.validateAuditReport(` \uFEFF${report([])}`).ok).toBe(false);
    expect(gate.validateAuditReport(`\uFEFF${report([])}`).message).toContain("UTF-8 BOM");
    expect(evaluate(manifest([]), `\uFEFF${report([])}`).ok).toBe(false);
  });

  it("AC7: the first output line names the report source", () => {
    const live = gate.evaluateDependencyAudit({ manifest: manifest([]), reportText: report([]), now: NOW });
    expect(live.lines[0]).toContain("report source: live pnpm audit");
    const injected = gate.evaluateDependencyAudit({
      manifest: manifest([]),
      reportText: report([]),
      now: NOW,
      reportSource: "injected report /tmp/fixture.json"
    });
    expect(injected.lines[0]).toContain("report source: injected report /tmp/fixture.json");
  });
});

describe("AC9 regression: workspace resolution", () => {
  it("AC9: equivalent workspace spellings resolve to the same workspace", () => {
    const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
    for (const spelling of [".", "./", ROOT, "sub/..", `${ROOT}/.`]) {
      expect(gate.normalizeWorkspaceLabel(spelling)).toBe(".");
    }
    for (const spelling of ["telemetry", "./telemetry", `${ROOT}/telemetry`, "telemetry/../telemetry"]) {
      expect(gate.normalizeWorkspaceLabel(spelling)).toBe("telemetry");
    }
    expect(gate.parseArgs(["--workspace", "telemetry"], {}).workspaceFile.endsWith("telemetry/pnpm-workspace.yaml")).toBe(
      true
    );
    expect(gate.parseArgs(["--workspace", "."], {}).workspaceFile.endsWith("/pnpm-workspace.yaml")).toBe(true);
  });
});

describe("AC10-AC11 regression: workspace-scoped pin linkage", () => {
  const TELEMETRY_FIXTURE = ["overrides:", '  ws: "^8.21.0"', '  undici: "^7.28.0"', ""].join("\n");

  it("AC10: a pin from another workspace is reported not applicable and never counted absent/drifted", () => {
    const manifestValue = manifest([
      exception({ advisory: "GHSA-aaab-bbbb-cccc", pin: { package: "ws", range: "^8.21.0", workspace: "telemetry" } }),
      exception({ advisory: "GHSA-aaac-bbbb-cccc", pin: { package: "undici", range: "^7.28.0", workspace: "telemetry" } })
    ]);
    const rootRun = evaluate(manifestValue, report([]), WORKSPACE_FIXTURE);
    expect(rootRun.ok).toBe(true);
    const output = rootRun.lines.join("\n");
    expect(output).toContain("not applicable to this run");
    expect(output).toContain("reconciled against that workspace's file");
    // the root workspace file has no ws/undici override, yet no absent/drifted failure
    expect(rootRun.errors.join("\n")).not.toContain("GHSA-aaab-bbbb-cccc");
    expect(rootRun.errors.join("\n")).not.toContain("GHSA-aaac-bbbb-cccc");
  });

  it("AC10: a telemetry run reconciles telemetry pins against telemetry's own file", () => {
    const manifestValue = manifest([
      exception({
        advisory: "GHSA-96hv-2xvq-fx4p",
        pin: { package: "ws", range: "^8.21.0", workspace: "telemetry" }
      }),
      exception({
        advisory: "GHSA-vmh5-mc38-953g",
        pin: { package: "undici", range: "^7.28.0", workspace: "telemetry" }
      })
    ]);
    const result = gate.evaluateDependencyAudit({
      manifest: manifestValue,
      reportText: report([]),
      workspaceText: TELEMETRY_FIXTURE,
      workspaceLabel: "telemetry",
      now: NOW
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("AC10: a drifted telemetry override fails the telemetry run and a drifted root pin fails the root run", () => {
    const telemetryDrift = gate.evaluateDependencyAudit({
      manifest: manifest([exception({ pin: { package: "ws", range: "^9.0.0", workspace: "telemetry" } })]),
      reportText: report([]),
      workspaceText: TELEMETRY_FIXTURE,
      workspaceLabel: "telemetry",
      now: NOW
    });
    expect(telemetryDrift.ok).toBe(false);
    expect(telemetryDrift.errors.join("\n")).toContain("drifted");
    expect(telemetryDrift.errors.join("\n")).toContain("ws");

    const rootDrift = gate.evaluateDependencyAudit({
      manifest: manifest([exception({ pin: { package: "fixture-package", range: "^9.0.0", workspace: "." } })]),
      reportText: report([]),
      workspaceText: WORKSPACE_FIXTURE,
      workspaceLabel: ".",
      now: NOW
    });
    expect(rootDrift.ok).toBe(false);
    expect(rootDrift.errors.join("\n")).toContain("drifted");
  });

  it("AC11: an applicable pin with a missing/unreadable workspace file fails and names the file", () => {
    const telemetryMissing = gate.evaluateDependencyAudit({
      manifest: manifest([exception({ pin: { package: "ws", range: "^8.21.0", workspace: "telemetry" } })]),
      reportText: report([]),
      workspaceText: null,
      workspaceLabel: "telemetry",
      now: NOW
    });
    expect(telemetryMissing.ok).toBe(false);
    expect(telemetryMissing.errors.join("\n")).toContain("telemetry/pnpm-workspace.yaml");
    expect(telemetryMissing.errors.join("\n")).toContain("absent or unreadable");

    const rootMissing = gate.evaluateDependencyAudit({
      manifest: manifest([exception({ pin: { package: "fixture-package", range: "^1.2.3", workspace: "." } })]),
      reportText: report([]),
      workspaceText: null,
      workspaceLabel: ".",
      now: NOW
    });
    expect(rootMissing.ok).toBe(false);
    expect(rootMissing.errors.join("\n")).toContain("pnpm-workspace.yaml");
  });

  it("AC11: no applicable pins means a missing workspace file does not fail linkage", () => {
    const result = gate.evaluateDependencyAudit({
      manifest: manifest([exception()]),
      reportText: report([]),
      workspaceText: null,
      workspaceLabel: "telemetry",
      now: NOW
    });
    expect(result.ok).toBe(true);
  });
});

describe("AC12 regression: rendered manifest text cannot forge a log line", () => {
  const FORGED = "Dependency audit PASS: 0 unaccepted advisories; 1 recorded exception(s)";

  it("strips control characters and collapses whitespace on the passing render path", () => {
    const owner = `Release owner\u0000\u001Bevil\n${FORGED}`;
    const result = evaluate(manifest([exception({ owner })]), report([]));
    expect(result.ok).toBe(true); // exit codes are unaffected by rendering
    const output = result.lines.join("\n");
    expect(output).toContain("owner: Release owner evil Dependency audit PASS: 0 unaccepted advisories; 1 recorded exception(s)");
    expect(output).not.toContain("\u0000");
    expect(output).not.toContain("\u001B");
    // the injected sentence appears inline on that exception's own line — only the gate's
    // own verdict line reads as an independent verdict
    const verdictLines = output.split("\n").filter((line: string) => /^Dependency audit PASS/.test(line));
    expect(verdictLines.length).toBe(1);
    expect(verdictLines[0]).toBe("Dependency audit PASS: 0 unaccepted advisories; 1 recorded exception(s)");
  });

  it("sanitizes pin package/range rendering on the passing path for non-applicable pins", () => {
    const result = gate.evaluateDependencyAudit({
      manifest: manifest([
        exception({ pin: { package: "ws\u0000\nx", range: "^8.21.0\u0007y", workspace: "telemetry" } })
      ]),
      reportText: report([]),
      workspaceText: WORKSPACE_FIXTURE,
      workspaceLabel: ".",
      now: NOW
    });
    expect(result.ok).toBe(true);
    const output = result.lines.join("\n");
    expect(output).not.toContain("\u0000");
    expect(output).not.toContain("\u0007");
    expect(output).toContain("pin ws x ^8.21.0 y (workspace telemetry)");
  });

  it("sanitizes manifest-error rendering (malformed advisory id with embedded controls)", () => {
    const result = evaluate(manifest([exception({ advisory: "GHSA-aaaa-bbbb-\n\u0000cccc" })]), report([]));
    expect(result.ok).toBe(false);
    const output = result.lines.join("\n");
    expect(output).toContain("malformed advisory id");
    expect(output).not.toContain("\u0000");
    expect(output).toContain("GHSA-aaaa-bbbb- cccc");
    expect(output).not.toContain(FORGED);
  });
});

describe("AC14 regression: could-not-audit propagation through the documented seam", () => {
  let tmpDir: string;
  let errorReportPath: string;
  let cleanReportPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "govedge-s2-"));
    errorReportPath = join(tmpDir, "error-report.json");
    cleanReportPath = join(tmpDir, "clean-report.json");
    writeFileSync(
      errorReportPath,
      JSON.stringify({ error: { code: "ERR_PNPM_AUDIT_NO_LOCKFILE", message: "No lockfile in this directory." } })
    );
    writeFileSync(cleanReportPath, report([]));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("AC14: a could-not-audit report through --report-file exits non-zero (gate rejects)", async () => {
    let err: unknown = null;
    try {
      await gate.main(["--report-file", errorReportPath], {});
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Dependency audit gate failed");
    expect((err as Error).message).toContain("ERR_PNPM_AUDIT_NO_LOCKFILE");
  });

  it("AC14: a clean injected report through the same seam passes", async () => {
    let err: unknown = null;
    try {
      await gate.main(["--report-file", cleanReportPath], {});
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeNull();
  });

  it("AC14: the env-var seam propagates the failure when opted in, and refuses before reading when not", async () => {
    let err: unknown = null;
    try {
      await gate.main(["--allow-injected-report"], { [gate.REPORT_FILE_ENV_VAR]: errorReportPath });
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Dependency audit gate failed");

    let refusal: unknown = null;
    try {
      await gate.main([], { [gate.REPORT_FILE_ENV_VAR]: join(tmpDir, "never-read.json") });
    } catch (caught) {
      refusal = caught;
    }
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toContain("--allow-injected-report");
  });

  it("AC14: the publish path observes the fix — prepublishOnly runs validate which runs audit:deps", () => {
    const pkg = JSON.parse(repoText("package.json"));
    expect(pkg.scripts.prepublishOnly).toBe("pnpm run validate");
    expect(pkg.scripts.validate).toContain("audit:deps");
    expect(pkg.scripts["audit:deps"]).toContain("scripts/audit/dependency-audit.mjs");
  });
});

describe("rework regressions: workspace attribution fails closed", () => {
  let tmpDir: string;
  let cleanReportPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "govedge-s2-ws-"));
    mkdirSync(join(tmpDir, "telemetry"));
    cleanReportPath = join(tmpDir, "clean.json");
    writeFileSync(cleanReportPath, report([]));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("workspace error: a --workspace value resolving to a nonexistent directory fails closed", () => {
    expect(() =>
      gate.validateWorkspaceDirectory({ workspaceDir: join(tmpDir, "missing"), workspaceLabel: "missing", packageRoot: tmpDir })
    ).toThrow(/workspace error/);
    expect(() =>
      gate.validateWorkspaceDirectory({ workspaceDir: join(tmpDir, "missing"), workspaceLabel: "missing", packageRoot: tmpDir })
    ).toThrow(/does not exist as a directory/);
  });

  it("workspace error: a wrong-case --workspace value fails closed on every filesystem", () => {
    let err: unknown = null;
    try {
      gate.validateWorkspaceDirectory({
        workspaceDir: join(tmpDir, "TELEMETRY"),
        workspaceLabel: "TELEMETRY",
        packageRoot: tmpDir
      });
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/workspace error/);
    // Attributed either as nonexistent (case-sensitive filesystem) or as a
    // case mismatch (case-insensitive filesystem) — never a silent
    // not-applicable PASS.
    expect((err as Error).message).toMatch(/does not exist as a directory|does not match an on-disk workspace directory/);
  });

  it("workspace error: the correct-case workspace entry is accepted", () => {
    expect(() =>
      gate.validateWorkspaceDirectory({ workspaceDir: join(tmpDir, "telemetry"), workspaceLabel: "telemetry", packageRoot: tmpDir })
    ).not.toThrow();
  });

  it("workspace error: a path escaping the package root is refused", () => {
    expect(() =>
      gate.validateWorkspaceDirectory({ workspaceDir: join(tmpDir, "..", "outside"), workspaceLabel: "..", packageRoot: tmpDir })
    ).toThrow(/outside the package root/);
  });

  it("integration: a wrong-case --workspace fails main() with an attributable error before any audit", async () => {
    let err: unknown = null;
    try {
      await gate.main(["--workspace", "TELEMETRY", "--report-file", cleanReportPath], {});
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("workspace error");
    expect((err as Error).message).toContain("TELEMETRY");
  });

  it("integration: the correct-case --workspace telemetry passes main() with the documented seam", async () => {
    let err: unknown = null;
    try {
      await gate.main(["--workspace", "telemetry", "--report-file", cleanReportPath], {});
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeNull();
  });
});

describe("shipped configuration", () => {
  it("keeps the severity floor at high and gates only high and critical", () => {
    expect(gate.SEVERITY_FLOOR).toBe("high");
    expect([...gate.GATED_SEVERITIES].sort()).toEqual(["critical", "high"]);
    expect(gate.MAX_EXPIRY_HORIZON_DAYS).toBe(90);
  });

  it("AC13: ships workspace-scoped pins — root pins fully cover the root overrides", () => {
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

    const rootPinned = new Set(
      result.entries
        .filter((entry: { pin: { workspace: string } }) => entry.pin && entry.pin.workspace === ".")
        .map((entry: { pin: { package: string } }) => entry.pin.package)
    );
    for (const overridden of gate.parseOverridesBlock(workspaceText).keys()) {
      expect(rootPinned).toContain(overridden);
    }
  });

  it("AC13: ships telemetry pins for ws and undici that fully cover the telemetry overrides", () => {
    const shipped = JSON.parse(repoText("scripts/audit/audit-exceptions.json"));
    const telemetryText = repoText("telemetry/pnpm-workspace.yaml");
    const result = gate.evaluateDependencyAudit({
      manifest: shipped,
      reportText: report([]),
      workspaceText: telemetryText,
      workspaceLabel: "telemetry",
      now: NOW
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);

    for (const id of ["GHSA-96hv-2xvq-fx4p", "GHSA-vmh5-mc38-953g", "GHSA-vxpw-j846-p89q"]) {
      expect(result.entries.map((entry: { advisory: string }) => entry.advisory)).toContain(id);
    }

    const telemetryPinned = new Set(
      result.entries
        .filter((entry: { pin: { workspace: string } }) => entry.pin && entry.pin.workspace === "telemetry")
        .map((entry: { pin: { package: string } }) => entry.pin.package)
    );
    for (const overridden of gate.parseOverridesBlock(telemetryText).keys()) {
      expect(telemetryPinned).toContain(overridden);
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
