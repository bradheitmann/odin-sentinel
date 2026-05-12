export type TelemetryConfig = {
  enabled: boolean;
  endpoint: string | undefined;
  source: "env" | "default";
};

export type PublicTelemetryConfig = {
  enabled: boolean;
  endpointConfigured: boolean;
  endpoint: string | undefined;
  source: "env" | "default";
};

const ENDPOINT_ENV_VAR = "ODIN_TELEMETRY_ENDPOINT";

export function redactTelemetryEndpoint(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  try {
    const parsed = new URL(endpoint);
    const hasSensitiveSurface =
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.pathname !== "/" ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0;
    return hasSensitiveSurface ? `${parsed.origin}/<redacted>` : parsed.origin;
  } catch {
    return "<configured>";
  }
}

export function readTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  const raw = env[ENDPOINT_ENV_VAR];
  const endpoint = typeof raw === "string" ? raw.trim() : "";
  if (endpoint.length === 0) {
    return { enabled: false, endpoint: undefined, source: "default" };
  }
  return { enabled: true, endpoint, source: "env" };
}

export function publicTelemetryConfig(config: TelemetryConfig = readTelemetryConfig()): PublicTelemetryConfig {
  return {
    enabled: config.enabled,
    endpointConfigured: typeof config.endpoint === "string" && config.endpoint.length > 0,
    endpoint: redactTelemetryEndpoint(config.endpoint),
    source: config.source
  };
}

export { ENDPOINT_ENV_VAR };
