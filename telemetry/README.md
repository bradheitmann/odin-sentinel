# ODIN Sentinel Telemetry Worker (optional)

This directory contains a Cloudflare Worker + D1 schema that receives **opt-in**
session reports from ODIN Sentinel clients. It is intentionally separate from
the published `@bradheitmann/odin-sentinel` npm package — installing the npm
package never causes any network traffic.

## What this Worker accepts

A single endpoint: `POST /report`. The request body is a JSON object with
counts and class labels — never transcripts, code, or repository identity.
The Worker rejects unknown fields and records only this allowlist in D1:

| Column              | Source                          |
|---------------------|---------------------------------|
| `protocol_version`  | ODIN Sentinel version string    |
| `team_count`        | 0..26                           |
| `violation_count`   | Number of contract breaches     |
| `halt_count`        | Number of HALT directives issued|
| `layout_drift_count`| Surface layout deviations       |
| `peak_context_pct`  | Highest agent context window % |
| `closeout_clean`    | Boolean                         |
| `model_signals`     | `[{role, model, violations}]`   |
| `violation_classes` | Violation class labels          |
| `blocker_classifications` | Blocker class labels      |
| `role_slot_count`   | Count of AX role slots          |
| `drift_warning_count` | Version/layout drift warnings |
| `degraded_layout`   | Boolean                         |

The Worker is not a transcript redactor. Clients must send only the counts and
class labels produced by ODIN Sentinel's allowlisted telemetry payload builder.
If a request contains unknown fields, the Worker rejects it with
`unknown_fields` instead of storing a raw payload.

## Deploy steps

```bash
cd telemetry
npm install -g pnpm                    # if you don't already have pnpm
pnpm install
pnpm run db:create                     # prints a database_id for local/deploy config
cp wrangler.toml wrangler.deploy.toml  # keep account-specific IDs out of git
pnpm run db:migrate                    # applies schema.sql to remote D1
pnpm exec wrangler secret put INGEST_TOKEN # provision a random secret of at least 32 characters
pnpm run deploy                        # uploads the Worker
```

If you keep the checked-in `wrangler.toml` placeholder unchanged, put the real
`database_id` in the gitignored `wrangler.deploy.toml` file and deploy with:

```bash
pnpm run deploy:configured
```

The checked-in config sets `workers_dev = false` so deployments do not expose an
account-identifying `*.workers.dev` endpoint by default. To collect telemetry
from public users, attach a neutral custom route/domain you control and use that
as the endpoint. Do not publish a personal or account-identifying workers.dev
subdomain as a public telemetry destination.

`schema.sql` is the bootstrap schema for new databases. Existing databases that
pre-date the allowlisted telemetry columns need the one-time upgrade migration:

```bash
pnpm run db:migrate:allowlist-columns
```

Run that migration only if the remote `session_reports` table is missing one or
more of these columns: `violation_classes`, `blocker_classifications`,
`role_slot_count`, `drift_warning_count`, or `degraded_layout`.

Take the neutral deployed URL and configure clients:

```bash
export ODIN_TELEMETRY_ENDPOINT="https://telemetry.example.com/report"
# Provision ODIN_TELEMETRY_TOKEN privately with the same INGEST_TOKEN value.
```

The endpoint opts a client into telemetry; the deployed Worker also requires its ingestion token. With it unset,
`odin.submit_session_report` returns `{ submitted: false, reason: "telemetry
not configured" }` and no network call is made.

## Ingestion security

The Worker rejects reports with 503 until `INGEST_TOKEN` is configured (at least
32 characters), then requires `Authorization: Bearer <token>` for every report.
Provision the same value privately as `ODIN_TELEMETRY_TOKEN` in approved clients.
Never put this value in a spec, checked-in file or public client bundle. Public
anonymous ingestion is not supported. Rotate the token when client access ends.
Clients require HTTPS (or explicit loopback HTTP), reject URL credentials, and do not follow redirects. Client consent and redaction still apply. Use edge rate limits and storage quotas
as additional protection against a compromised authorized client.

Bodies must be JSON and are limited to 64 KiB of actual bytes, including when
Content-Length is missing. Origin checks reject a cross-origin browser request
unless it is explicitly allowed; CORS is not used as an authorization control.

## Optional hardening

- `ALLOWED_ORIGINS`: comma-separated list of `Origin` headers permitted.
  Without this, CORS is closed and only same-origin or no-origin clients can
  POST. ODIN Sentinel clients send no `Origin` header (Node fetch), so
  leaving this unset is the secure default.
- `PROTOCOL_VERSION_ALLOWLIST`: comma-separated list of versions you accept
  (e.g. `0.3.0,0.4.0`). Reports from other versions are rejected with 403.

## Data retention

There's no built-in retention policy. If you want one:

```sql
DELETE FROM session_reports WHERE received_at < (strftime('%s','now','-90 days') * 1000);
```

Run via `wrangler d1 execute ... --command "..."` or schedule it.

## What this Worker does NOT do

- It does not record IP addresses, user agents, or request headers.
- It does not retain raw transcripts, code, file paths, or repo identity
  because the Worker stores only allowlisted counts and class labels.
- It does not phone home to npm, GitHub, or any third party.
- It does not push back to clients.

Telemetry is opt-in at every layer: install of the npm package does
nothing; the user must deploy this Worker themselves; the client must
set `ODIN_TELEMETRY_ENDPOINT`; and EXEC PM must explicitly call
`odin.submit_session_report` with user-approved content at session close.

## Security audit exceptions

`pnpm-workspace.yaml` ignores two esbuild advisories that are
unreachable in this workspace (esbuild arrives only as wrangler's
bundled build tool, pinned exactly by wrangler upstream):

- `GHSA-gv7w-rqvm-qjhr` (high) — missing binary integrity verification
  when esbuild is installed through **Deno**. This workspace runs
  wrangler on Node only.
- `GHSA-g7r4-m6w7-qqqr` (low) — arbitrary file read in the esbuild
  **dev server on Windows**. The dev server is never started here;
  `wrangler dev` is local-only development on macOS/Linux.

Remove both entries when wrangler ships esbuild >= 0.28.1
(check with `pnpm view wrangler@latest dependencies.esbuild`).
