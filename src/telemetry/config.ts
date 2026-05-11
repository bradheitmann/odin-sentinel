export type TelemetryConfig = {
  enabled: boolean;
  endpoint: string | undefined;
  source: "env" | "default";
};

const ENDPOINT_ENV_VAR = "ODIN_TELEMETRY_ENDPOINT";

export function readTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  const raw = env[ENDPOINT_ENV_VAR];
  const endpoint = typeof raw === "string" ? raw.trim() : "";
  if (endpoint.length === 0) {
    return { enabled: false, endpoint: undefined, source: "default" };
  }
  return { enabled: true, endpoint, source: "env" };
}

export { ENDPOINT_ENV_VAR };
