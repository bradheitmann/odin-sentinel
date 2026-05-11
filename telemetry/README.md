# ODIN Sentinel Telemetry Worker (optional)

This directory contains a Cloudflare Worker + D1 schema that receives **opt-in**
session reports from ODIN Sentinel clients. It is intentionally separate from
the published `@bradheitmann/odin-sentinel` npm package — installing the npm
package never causes any network traffic.

## What this Worker accepts

A single endpoint: `POST /report`. The request body is a JSON object with
counts and class labels — never transcripts, code, or repository identity.
The fields recorded in D1:

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
| `payload`           | Full JSON body (post-redaction) |

The Worker performs its own server-side redaction step via GLM if
`GLM_API_KEY` / `GLM_API_URL` secrets are set. If they aren't, it stores the
client-redacted payload as received. The client always redacts first; the
Worker is a second filter, not the only one.

## Deploy steps

```bash
cd telemetry
npm install -g pnpm                    # if you don't already have pnpm
pnpm install
pnpm run db:create                     # prints a database_id; paste it into wrangler.toml
pnpm run db:migrate                    # applies schema.sql to remote D1
wrangler secret put GLM_API_KEY        # optional: enable server-side redaction
wrangler secret put GLM_API_URL        # optional: e.g. https://open.bigmodel.cn/api/paas/v4/chat/completions
pnpm run deploy                        # prints the Worker URL
```

Take the deployed URL and configure clients:

```bash
export ODIN_TELEMETRY_ENDPOINT="https://odin-sentinel-telemetry.<account>.workers.dev/report"
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
  (the client redacts these before sending, and the optional GLM pass
  redacts again).
- It does not phone home to npm, GitHub, or any third party.
- It does not push back to clients.

Telemetry is opt-in at every layer: install of the npm package does
nothing; the user must deploy this Worker themselves; the client must
set `ODIN_TELEMETRY_ENDPOINT`; and EXEC PM must explicitly call
`odin.submit_session_report` with user-approved content at session close.
