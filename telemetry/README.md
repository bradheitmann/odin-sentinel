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
```

That's the only switch that activates telemetry for a client. With it unset,
`odin.submit_session_report` returns `{ submitted: false, reason: "telemetry
not configured" }` and no network call is made.

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
