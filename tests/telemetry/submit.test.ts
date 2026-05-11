import { describe, expect, it } from "vitest";
import { readTelemetryConfig, ENDPOINT_ENV_VAR } from "../../src/telemetry/config.js";
import { compileSessionReport } from "../../src/telemetry/report.js";
import { submitSessionReport } from "../../src/telemetry/submit.js";

function makeInput() {
  return {
    teamCount: 4,
    violations: [{ class: "staffing_gate_skipped" }],
    halts: [{ source: "A/EXEC-ODIN", target: "A/EXEC-PM", trigger: "staffing without gate" }],
    layoutDriftEvents: 0,
    peakContextPct: 62,
    closeoutClean: true,
    modelSignals: [{ role: "A/EXEC-PM", model: "opus", violations: 0 }]
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

  it("ignores whitespace-only endpoints", () => {
    const env: NodeJS.ProcessEnv = { [ENDPOINT_ENV_VAR]: "   " };
    const config = readTelemetryConfig(env);
    expect(config.enabled).toBe(false);
  });
});

describe("compileSessionReport", () => {
  it("derives counts and embeds version + timestamp", () => {
    const report = compileSessionReport(makeInput(), "0.4.0");
    expect(report.version).toBe("0.4.0");
    expect(report.violationCount).toBe(1);
    expect(report.haltCount).toBe(1);
    expect(report.compiledAt).toMatch(/T.+Z$/);
  });
});

describe("submitSessionReport", () => {
  it("returns submitted=false when telemetry is not configured", async () => {
    const result = await submitSessionReport(
      compileSessionReport(makeInput(), "0.4.0") as unknown as Record<string, unknown>,
      { config: { enabled: false, endpoint: undefined, source: "default" } }
    );
    expect(result.submitted).toBe(false);
    expect(result.reason).toContain("not configured");
  });

  it("POSTs the redacted payload when configured", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : "<request>";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      return new Response(JSON.stringify({ ok: true, id: "abc-123" }), { status: 200 });
    };

    const compiled = compileSessionReport(makeInput(), "0.4.0") as unknown as Record<string, unknown>;
    const result = await submitSessionReport(compiled, {
      config: { enabled: true, endpoint: "https://telemetry.example/report", source: "env" },
      fetchImpl: fakeFetch
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://telemetry.example/report");
    expect(result.submitted).toBe(true);
    expect(result.id).toBe("abc-123");
    expect(result.status).toBe(200);
  });

  it("returns submitted=false with the HTTP status when the server rejects", async () => {
    const fakeFetch: typeof fetch = async () => new Response("nope", { status: 503 });
    const compiled = compileSessionReport(makeInput(), "0.4.0") as unknown as Record<string, unknown>;
    const result = await submitSessionReport(compiled, {
      config: { enabled: true, endpoint: "https://telemetry.example/report", source: "env" },
      fetchImpl: fakeFetch
    });
    expect(result.submitted).toBe(false);
    expect(result.status).toBe(503);
    expect(result.reason).toBe("HTTP 503");
  });

  it("returns submitted=false when fetch throws", async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new Error("network down");
    };
    const compiled = compileSessionReport(makeInput(), "0.4.0") as unknown as Record<string, unknown>;
    const result = await submitSessionReport(compiled, {
      config: { enabled: true, endpoint: "https://telemetry.example/report", source: "env" },
      fetchImpl: fakeFetch
    });
    expect(result.submitted).toBe(false);
    expect(result.reason).toBe("network down");
  });
});
