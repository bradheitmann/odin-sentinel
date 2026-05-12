// ODIN Sentinel telemetry Worker.
//
// Receives opt-in session reports from clients that set ODIN_TELEMETRY_ENDPOINT
// to this Worker's URL. Stores counts and class labels only; never transcripts,
// code, or repository identity. See telemetry/README.md for the data contract.

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
  PROTOCOL_VERSION_ALLOWLIST?: string;
}

type SessionReport = {
  version?: unknown;
  teamCount?: unknown;
  layoutDriftEvents?: unknown;
  peakContextPct?: unknown;
  closeoutClean?: unknown;
  modelSignals?: unknown;
  violationClasses?: unknown;
  blockerClassifications?: unknown;
  roleSlotCount?: unknown;
  driftWarningCount?: unknown;
  degradedLayout?: unknown;
  violationCount?: unknown;
  haltCount?: unknown;
};

const MAX_BODY_BYTES = 64 * 1024;
const ALLOWED_REPORT_KEYS = new Set([
  "version",
  "teamCount",
  "violationCount",
  "haltCount",
  "layoutDriftEvents",
  "peakContextPct",
  "closeoutClean",
  "modelSignals",
  "violationClasses",
  "blockerClassifications",
  "roleSlotCount",
  "driftWarningCount",
  "degradedLayout"
]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownReportKeys(report: Record<string, unknown>): string[] {
  return Object.keys(report).filter((key) => !ALLOWED_REPORT_KEYS.has(key));
}

function stringArray(value: unknown, maxEntries = 100, maxLen = 64): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxEntries).map((entry) => toFiniteString(entry, maxLen)).filter((entry) => entry.length > 0);
}

function modelSignalSummaries(value: unknown): Array<{ role: string; model: string; violations: number }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    return [{
      role: toFiniteString(entry.role, 64),
      model: toFiniteString(entry.model, 64),
      violations: toFiniteInt(entry.violations, 0, 10_000)
    }];
  });
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

    if (!isRecord(body)) {
      return json(400, { ok: false, error: "invalid_payload" }, allowOrigin);
    }

    const unknownFields = unknownReportKeys(body);
    if (unknownFields.length > 0) {
      return json(400, { ok: false, error: "unknown_fields", fields: unknownFields }, allowOrigin);
    }

    const report = body as SessionReport;
    const version = toFiniteString(report.version, 32);
    if (version.length === 0) {
      return json(400, { ok: false, error: "missing_version" }, allowOrigin);
    }
    if (!versionAllowed(version, env)) {
      return json(403, { ok: false, error: "version_not_allowed" }, allowOrigin);
    }

    const id = crypto.randomUUID();
    const teamCount = toFiniteInt(report.teamCount, 0, 26);
    const violationCount = toFiniteInt(report.violationCount, 0, 10_000);
    const haltCount = toFiniteInt(report.haltCount, 0, 10_000);
    const layoutDriftCount = toFiniteInt(report.layoutDriftEvents, 0, 10_000);
    const peakContextPct = toFiniteInt(report.peakContextPct, 0, 100);
    const closeoutClean = report.closeoutClean === true ? 1 : 0;
    const modelSignals = modelSignalSummaries(report.modelSignals);
    const violationClasses = stringArray(report.violationClasses);
    const blockerClassifications = stringArray(report.blockerClassifications);
    const roleSlotCount = toFiniteInt(report.roleSlotCount, 0, 10_000);
    const driftWarningCount = toFiniteInt(report.driftWarningCount, 0, 10_000);
    const degradedLayout = report.degradedLayout === true ? 1 : 0;

    await env.DB.prepare(
      `INSERT INTO session_reports
         (id, protocol_version, team_count, violation_count, halt_count,
          layout_drift_count, peak_context_pct, closeout_clean, model_signals,
          violation_classes, blocker_classifications, role_slot_count,
          drift_warning_count, degraded_layout, received_at, client_redacted)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`
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
        JSON.stringify(violationClasses),
        JSON.stringify(blockerClassifications),
        roleSlotCount,
        driftWarningCount,
        degradedLayout,
        Date.now(),
        1
      )
      .run();

    return json(200, { ok: true, id }, allowOrigin);
  }
};
