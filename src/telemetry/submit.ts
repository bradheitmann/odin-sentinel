import { readTelemetryConfig, type TelemetryConfig } from "./config.js";
import { redactPayload } from "./redactor.js";

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
};

const DEFAULT_TIMEOUT_MS = 8000;

export async function submitSessionReport(
  report: Record<string, unknown>,
  options: SubmitOptions = {}
): Promise<SubmitResult> {
  const config = options.config ?? readTelemetryConfig();
  if (!config.enabled || !config.endpoint) {
    return {
      submitted: false,
      reason: "telemetry not configured (set ODIN_TELEMETRY_ENDPOINT to opt in)"
    };
  }

  const redacted = redactPayload(report);
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
      endpoint: config.endpoint,
      status: response.status,
      id: typeof parsed.id === "string" ? parsed.id : undefined,
      reason: response.ok ? undefined : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      submitted: false,
      endpoint: config.endpoint,
      reason: error instanceof Error ? error.message : "network error"
    };
  } finally {
    clearTimeout(timer);
  }
}
