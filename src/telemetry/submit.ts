import { readTelemetryConfig, redactTelemetryEndpoint, type TelemetryConfig } from "./config.js";
import { redactPayload, redactString } from "./redactor.js";

export type SubmitResult = {
  submitted: boolean;
  endpoint?: string;
  status?: number;
  id?: string;
  reason?: string;
};

export type SubmitOptions = {
  config?: TelemetryConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userConsentConfirmed?: boolean;
};

const DEFAULT_TIMEOUT_MS = 8000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeString(value: unknown, maxLen = 96): string {
  if (typeof value !== "string") return "";
  const redacted = redactString(value).trim();
  return redacted.length > maxLen ? redacted.slice(0, maxLen) : redacted;
}

function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const integer = Math.trunc(value);
  if (integer < min) return min;
  if (integer > max) return max;
  return integer;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => safeString(entry)).filter(Boolean))];
}

function violationClasses(report: Record<string, unknown>): string[] {
  const direct = safeStringArray(report.violationClasses);
  if (direct.length > 0) return direct;
  if (!Array.isArray(report.violations)) return [];
  return [...new Set(report.violations.flatMap((entry) => isRecord(entry) ? [safeString(entry.class)] : []).filter(Boolean))];
}

function blockerClassifications(report: Record<string, unknown>): string[] {
  const axSummary = isRecord(report.axSummary) ? report.axSummary : {};
  return safeStringArray(axSummary.blockerClassifications);
}

function modelSignals(report: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(report.modelSignals)) return [];
  return report.modelSignals.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    return [{
      role: safeString(entry.role),
      model: safeString(entry.model),
      violations: safeInt(entry.violations, 0, 0, 10_000)
    }];
  });
}

export function toTelemetryPayload(report: Record<string, unknown>): Record<string, unknown> {
  const axSummary = isRecord(report.axSummary) ? report.axSummary : {};
  return {
    version: safeString(report.version, 32),
    teamCount: safeInt(report.teamCount, 0, 0, 26),
    violationCount: safeInt(report.violationCount, Array.isArray(report.violations) ? report.violations.length : 0, 0, 10_000),
    haltCount: safeInt(report.haltCount, Array.isArray(report.halts) ? report.halts.length : 0, 0, 10_000),
    layoutDriftEvents: safeInt(report.layoutDriftEvents, 0, 0, 10_000),
    peakContextPct: safeInt(report.peakContextPct, 0, 0, 100),
    closeoutClean: report.closeoutClean === true,
    modelSignals: modelSignals(report),
    violationClasses: violationClasses(report),
    blockerClassifications: blockerClassifications(report),
    roleSlotCount: safeInt(axSummary.roleSlotCount, 0, 0, 10_000),
    driftWarningCount: safeInt(axSummary.driftWarningCount, 0, 0, 10_000),
    degradedLayout: axSummary.degradedLayout === true
  };
}

export async function submitSessionReport(
  report: Record<string, unknown>,
  options: SubmitOptions = {}
): Promise<SubmitResult> {
  if (options.userConsentConfirmed !== true) {
    return {
      submitted: false,
      reason: "explicit user consent required for telemetry submission"
    };
  }

  const config = options.config ?? readTelemetryConfig();
  if (!config.enabled || !config.endpoint) {
    return {
      submitted: false,
      reason: "telemetry not configured (set ODIN_TELEMETRY_ENDPOINT to opt in)"
    };
  }

  const redacted = redactPayload(toTelemetryPayload(report));
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(redacted),
      signal: controller.signal
    });

    let parsed: { ok?: unknown; id?: unknown } = {};
    try {
      parsed = (await response.json()) as { ok?: unknown; id?: unknown };
    } catch {
      // non-JSON response is acceptable; status code is the source of truth
    }

    return {
      submitted: response.ok,
      endpoint: redactTelemetryEndpoint(config.endpoint),
      status: response.status,
      id: typeof parsed.id === "string" ? parsed.id : undefined,
      reason: response.ok ? undefined : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      submitted: false,
      endpoint: redactTelemetryEndpoint(config.endpoint),
      reason: error instanceof Error ? redactString(error.message) : "network error"
    };
  } finally {
    clearTimeout(timer);
  }
}
