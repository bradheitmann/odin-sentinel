// ODIN Sentinel telemetry Worker.
//
// Receives opt-in session reports from clients that set ODIN_TELEMETRY_ENDPOINT
// to this Worker's URL. Stores counts and class labels only; never transcripts,
// code, or repository identity. See telemetry/README.md for the data contract.

export interface Env {
  DB: D1Database;
  GLM_API_KEY?: string;
  GLM_API_URL?: string;
  ALLOWED_ORIGINS?: string;
  PROTOCOL_VERSION_ALLOWLIST?: string;
}

type SessionReport = {
  version?: unknown;
  teamCount?: unknown;
  violations?: unknown;
  halts?: unknown;
  layoutDriftEvents?: unknown;
  peakContextPct?: unknown;
  closeoutClean?: unknown;
  modelSignals?: unknown;
  violationCount?: unknown;
  haltCount?: unknown;
};

const MAX_BODY_BYTES = 64 * 1024;

function json(status: number, body: Record<string, unknown>, origin: string | null): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers["access-control-allow-origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function selectOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (allowed.length === 0) return null;
  return allowed.includes(origin) ? origin : null;
}

function toFiniteInt(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return min;
  const integer = Math.trunc(value);
  if (integer < min) return min;
  if (integer > max) return max;
  return integer;
}

function toFiniteString(value: unknown, maxLen = 64): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function lengthOfArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

async function redactWithGLM(payload: Record<string, unknown>, env: Env): Promise<Record<string, unknown>> {
  if (!env.GLM_API_KEY || !env.GLM_API_URL) return payload;
  try {
    const response = await fetch(env.GLM_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.GLM_API_KEY}`
      },
      body: JSON.stringify({
        model: "glm-4-flash",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a privacy redactor. Return ONLY a JSON object with the same shape as the input, but with any string values that look like file paths, identities, emails, repository names, code snippets, or transcripts replaced with the literal string \"<REDACTED>\". Preserve numbers, booleans, arrays, and structural keys exactly. Do not add fields."
          },
          { role: "user", content: JSON.stringify(payload) }
        ]
      })
    });
    if (!response.ok) return payload;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (typeof raw !== "string") return payload;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return payload;
  } catch {
    return payload;
  }
}

function versionAllowed(version: string, env: Env): boolean {
  const list = parseAllowedOrigins(env.PROTOCOL_VERSION_ALLOWLIST);
  if (list.length === 0) return true;
  return list.includes(version);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowOrigin = selectOrigin(request, env);

    if (request.method === "OPTIONS") {
      const headers: Record<string, string> = {
        "access-control-allow-methods": "POST",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400"
      };
      if (allowOrigin) headers["access-control-allow-origin"] = allowOrigin;
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "POST") {
      return json(405, { ok: false, error: "method_not_allowed" }, allowOrigin);
    }

    const url = new URL(request.url);
    if (url.pathname !== "/report") {
      return json(404, { ok: false, error: "not_found" }, allowOrigin);
    }

    const lengthHeader = request.headers.get("content-length");
    if (lengthHeader && Number.parseInt(lengthHeader, 10) > MAX_BODY_BYTES) {
      return json(413, { ok: false, error: "payload_too_large" }, allowOrigin);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(400, { ok: false, error: "invalid_json" }, allowOrigin);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { ok: false, error: "invalid_payload" }, allowOrigin);
    }

    const report = body as SessionReport;
    const version = toFiniteString(report.version, 32);
    if (version.length === 0) {
      return json(400, { ok: false, error: "missing_version" }, allowOrigin);
    }
    if (!versionAllowed(version, env)) {
      return json(403, { ok: false, error: "version_not_allowed" }, allowOrigin);
    }

    const redacted = await redactWithGLM(report as Record<string, unknown>, env);
    const usedServerRedaction = redacted !== report;

    const id = crypto.randomUUID();
    const teamCount = toFiniteInt(report.teamCount, 0, 26);
    const violationCount = toFiniteInt(
      report.violationCount ?? lengthOfArray(report.violations),
      0,
      10_000
    );
    const haltCount = toFiniteInt(report.haltCount ?? lengthOfArray(report.halts), 0, 10_000);
    const layoutDriftCount = toFiniteInt(report.layoutDriftEvents, 0, 10_000);
    const peakContextPct = toFiniteInt(report.peakContextPct, 0, 100);
    const closeoutClean = report.closeoutClean === true ? 1 : 0;
    const modelSignals = Array.isArray(report.modelSignals) ? report.modelSignals : [];

    await env.DB.prepare(
      `INSERT INTO session_reports
         (id, protocol_version, team_count, violation_count, halt_count,
          layout_drift_count, peak_context_pct, closeout_clean, model_signals,
          payload, received_at, client_redacted, server_redacted)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
    )
      .bind(
        id,
        version,
        teamCount,
        violationCount,
        haltCount,
        layoutDriftCount,
        peakContextPct,
        closeoutClean,
        JSON.stringify(modelSignals),
        JSON.stringify(redacted),
        Date.now(),
        1,
        usedServerRedaction ? 1 : 0
      )
      .run();

    return json(200, { ok: true, id }, allowOrigin);
  }
};
