import { describe, expect, it } from "vitest";
import { publicTelemetryConfig, readTelemetryConfig, ENDPOINT_ENV_VAR } from "../../src/telemetry/config.js";
import { compileSessionReport, type SessionReportInput } from "../../src/telemetry/report.js";
import { submitSessionReport, toTelemetryPayload } from "../../src/telemetry/submit.js";

function check(status: "verified" | "missing" | "blocked" | "unknown" | "not_applicable", detail?: string) {
  return { status, detail };
}

function makeInput(): SessionReportInput {
  return {
    teamCount: 4,
    violations: [{ class: "staffing_gate_skipped" }],
    halts: [{ source: "A/EXEC-ODIN", target: "A/EXEC-PM", trigger: "staffing without gate" }],
    layoutDriftEvents: 0,
    peakContextPct: 62,
    closeoutClean: true,
    modelSignals: [{ role: "A/EXEC-PM", model: "opus", violations: 0 }],
    ax: {
      roleSlots: [
        {
          role: "B/DEV-1",
          team: "B",
          harness: "OpenHands",
          model: "gpt-test",
          locator: { workspace: "main", pane: "2", surface: "left" },
          mcpAccess: check("verified"),
          mcpVersion: "0.2.1",
          minimumCompatibleMcpVersion: "0.4.5",
          skillAccess: check("missing", "native skill absent"),
          fullProtocolTextReceived: check("missing", "short prompt only"),
          promptType: "short_boot_prompt",
          operatorAuthorityRecognized: check("unknown"),
          readinessStatus: "blocked",
          bootReceiptStatus: "missing",
          activeWatchStatus: "not_applicable",
          blockerClassification: ["missing_skill", "short_prompt", "auth_blocker"],
          childContextText: "OPENAI_API_KEY=sk-0123456789abcdefghijklmnopqrstuv"
        }
      ]
    }
  };
}

describe("readTelemetryConfig", () => {
  it("is disabled when ODIN_TELEMETRY_ENDPOINT is unset", () => {
    const env: NodeJS.ProcessEnv = {};
    const config = readTelemetryConfig(env);
    expect(config.enabled).toBe(false);
    expect(config.endpoint).toBeUndefined();
    expect(config.source).toBe("default");
  });

  it("is enabled when endpoint env var is set", () => {
    const env: NodeJS.ProcessEnv = { [ENDPOINT_ENV_VAR]: "https://telemetry.example/report" };
    const config = readTelemetryConfig(env);
    expect(config.enabled).toBe(true);
    expect(config.endpoint).toBe("https://telemetry.example/report");
    expect(config.source).toBe("env");
  });

  it("redacts credential-bearing endpoints for public display", () => {
    const env: NodeJS.ProcessEnv = { [ENDPOINT_ENV_VAR]: "https://hooks.example/report/secret-token?key=abc123" };
    const publicConfig = publicTelemetryConfig(readTelemetryConfig(env));
    expect(publicConfig.enabled).toBe(true);
    expect(publicConfig.endpointConfigured).toBe(true);
    expect(publicConfig.endpoint).toBe("https://hooks.example/<redacted>");
    expect(JSON.stringify(publicConfig)).not.toContain("secret-token");
    expect(JSON.stringify(publicConfig)).not.toContain("abc123");
  });

  it("ignores whitespace-only endpoints", () => {
    const env: NodeJS.ProcessEnv = { [ENDPOINT_ENV_VAR]: "   " };
    const config = readTelemetryConfig(env);
    expect(config.enabled).toBe(false);
  });
});

describe("compileSessionReport", () => {
  it("derives counts, embeds version + timestamp, summarizes AX blockers, and redacts child context", () => {
    const report = compileSessionReport(makeInput(), "0.4.0");
    expect(report.version).toBe("0.4.0");
    expect(report.violationCount).toBe(1);
    expect(report.haltCount).toBe(1);
    expect(report.compiledAt).toMatch(/T.+Z$/);
    expect(report.axSummary?.roleSlotCount).toBe(1);
    expect(report.axSummary?.blockerClassifications).toEqual(
      expect.arrayContaining(["missing_skill", "short_prompt", "missing_protocol_text", "auth_blocker", "receipt_missing"])
    );
    expect(report.ax?.roleSlots?.[0]?.childContextText).toContain("OPENAI_API_KEY=<ENV_VALUE>");
    expect(report.ax?.roleSlots?.[0]?.childContextText).not.toContain("0123456789abcdefghijklmnopqrstuv");
  });
});

describe("submitSessionReport", () => {
  it("returns submitted=false and does not call fetch when telemetry is not configured", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      return new Response("unexpected", { status: 500 });
    };
    const result = await submitSessionReport(
      compileSessionReport(makeInput(), "0.4.0") as unknown as Record<string, unknown>,
      { config: { enabled: false, endpoint: undefined, source: "default" }, fetchImpl: fakeFetch, userConsentConfirmed: true }
    );
    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("not configured");
    expect(calls).toBe(0);
  });

  it("returns submitted=false and does not call fetch without explicit user consent", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const compiled = compileSessionReport(makeInput(), "0.4.0") as unknown as Record<string, unknown>;
    const result = await submitSessionReport(compiled, {
      config: { enabled: true, endpoint: "https://telemetry.example/report", source: "env" },
      fetchImpl: fakeFetch
    });

    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("explicit user consent required");
    expect(calls).toBe(0);
  });

  it("POSTs the redacted payload when configured", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : "<request>";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      return new Response(JSON.stringify({ ok: true, id: "abc-123" }), { status: 200 });
    };

    const compiled = compileSessionReport(makeInput(), "0.4.0") as unknown as Record<string, unknown>;
    const result = await submitSessionReport(compiled, {
      config: { enabled: true, endpoint: "https://telemetry.example/report?key=secret-value", source: "env" },
      fetchImpl: fakeFetch,
      userConsentConfirmed: true
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://telemetry.example/report?key=secret-value");
    expect(JSON.stringify(calls[0].body)).not.toContain("0123456789abcdefghijklmnopqrstuv");
    expect(JSON.stringify(calls[0].body)).not.toContain("OPENAI_API_KEY");
    expect(JSON.stringify(calls[0].body)).not.toContain("childContextText");
    expect(JSON.stringify(calls[0].body)).not.toContain("roleSlots");
    expect(JSON.stringify(calls[0].body)).toContain("missing_skill");
    expect(calls[0].body).toMatchObject({
      version: "0.4.0",
      teamCount: 4,
      violationCount: 1,
      haltCount: 1,
      roleSlotCount: 1,
      driftWarningCount: 0,
      degradedLayout: false
    });
    expect(calls[0].body.violationClasses).toEqual(["staffing_gate_skipped"]);
    expect(calls[0].body.blockerClassifications).toEqual(
      expect.arrayContaining(["missing_skill", "short_prompt", "missing_protocol_text", "auth_blocker", "receipt_missing"])
    );
    expect(result.submitted).toBe(true);
    expect(result.id).toBe("abc-123");
    expect(result.status).toBe(200);
    expect(result.endpoint).toBe("https://telemetry.example/<redacted>");
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("returns submitted=false with the HTTP status when the server rejects", async () => {
    const fakeFetch: typeof fetch = async () => new Response("nope", { status: 503 });
    const compiled = compileSessionReport(makeInput(), "0.4.0") as unknown as Record<string, unknown>;
    const result = await submitSessionReport(compiled, {
      config: { enabled: true, endpoint: "https://telemetry.example/report", source: "env" },
      fetchImpl: fakeFetch,
      userConsentConfirmed: true
    });
    expect(result.submitted).toBe(false);
    expect(result.status).toBe(503);
    expect(result.reason).toBe("HTTP 503");
  });

  it("returns submitted=false when fetch throws", async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new Error("network down at /Users/example/private with sk-proj-" + "0123456789abcdefghijklmnopqrstuv_0123456789");
    };
    const compiled = compileSessionReport(makeInput(), "0.4.0") as unknown as Record<string, unknown>;
    const result = await submitSessionReport(compiled, {
      config: { enabled: true, endpoint: "https://telemetry.example/report", source: "env" },
      fetchImpl: fakeFetch,
      userConsentConfirmed: true
    });
    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("network down");
    expect(result.reason).not.toContain("/Users/example");
    expect(result.reason).not.toContain("0123456789abcdefghijklmnopqrstuv");
  });

  it("converts reports to an allowlisted telemetry payload before network submission", () => {
    const compiled = compileSessionReport(makeInput(), "0.4.0") as unknown as Record<string, unknown>;
    const payload = toTelemetryPayload(compiled);
    expect(payload).toMatchObject({
      version: "0.4.0",
      teamCount: 4,
      violationCount: 1,
      haltCount: 1,
      roleSlotCount: 1
    });
    expect(Object.keys(payload).sort()).toEqual([
      "blockerClassifications",
      "closeoutClean",
      "degradedLayout",
      "driftWarningCount",
      "haltCount",
      "layoutDriftEvents",
      "modelSignals",
      "peakContextPct",
      "roleSlotCount",
      "teamCount",
      "version",
      "violationClasses",
      "violationCount"
    ]);
    expect(JSON.stringify(payload)).not.toContain("OPENAI_API_KEY");
  });
});
