import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// Boundary proofs for the optional telemetry worker (telemetry/src/index.ts), kept in the root
// strict-TypeScript suite. The worker is loaded through a computed specifier so the root
// typecheck does not pull in its Cloudflare Workers types; the slice of the API used here is
// declared locally.

interface WorkerModule {
  default: { fetch(request: Request, env: Record<string, unknown>): Promise<Response> };
}

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const workerUrl = pathToFileURL(join(repoRoot, "telemetry", "src", "index.ts")).href;
const worker = ((await import(workerUrl)) as WorkerModule).default;

// synthetic sample built at runtime so tracked bytes carry no detector-shaped literal; value is not real
const ingestToken = ["synthetic", "worker", "ingest", "value", "for", "boundary", "tests"].join("-");

function report(body: Record<string, unknown>): Request {
  return new Request("https://telemetry.example.invalid/report", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: ["Bearer", ingestToken].join(" ") },
    body: JSON.stringify(body)
  });
}

function db(run: () => Promise<void>): Record<string, unknown> {
  return { prepare: () => ({ bind: () => ({ run }) }) };
}

describe("telemetry worker boundary (quality-fix-1)", () => {
  it("F-37: a D1 write failure returns the JSON storage_error envelope without echoing the error", async () => {
    const env = {
      INGEST_TOKEN: ingestToken,
      DB: db(async () => {
        throw new Error("D1 internal detail");
      })
    };
    const response = await worker.fetch(report({ version: "test" }), env);
    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: false, error: "storage_error" });
    expect(JSON.stringify(body)).not.toContain("D1 internal detail");
  });

  it("F-38: an over-long version is rejected before truncation can match the allowlist", async () => {
    let inserts = 0;
    const allowed = "v".repeat(32);
    const env = {
      INGEST_TOKEN: ingestToken,
      PROTOCOL_VERSION_ALLOWLIST: allowed,
      DB: db(async () => {
        inserts += 1;
      })
    };
    const overLong = await worker.fetch(report({ version: `${allowed}${"x".repeat(13)}` }), env);
    expect(overLong.status).toBe(400);
    expect(await overLong.json()).toEqual({ ok: false, error: "invalid_version" });
    expect(inserts).toBe(0);

    const exact = await worker.fetch(report({ version: allowed }), env);
    expect(exact.status).toBe(200);
    expect(inserts).toBe(1);
  });
});
