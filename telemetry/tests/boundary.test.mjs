import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";

const token = "synthetic-worker-token-with-at-least-32-characters";
const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
const request = (body = '{"version":"test"}', extra = {}) => new Request("https://telemetry.example.invalid/report", { method: "POST", headers: { ...headers, ...extra }, body });
const fixture = () => {
  let inserts = 0;
  return {
    get inserts() { return inserts; },
    env: { INGEST_TOKEN: token, DB: { prepare() { return { bind() { return { async run() { inserts++; } }; } }; } } }
  };
};

test("rejects missing deployment credentials and unauthenticated submissions", async () => {
  const f = fixture();
  assert.equal((await worker.fetch(request(), { ...f.env, INGEST_TOKEN: undefined })).status, 503);
  assert.equal((await worker.fetch(request(undefined, { authorization: "" }), f.env)).status, 401);
  assert.equal(f.inserts, 0);
});
test("rejects hostile browser origins even with a valid ingestion token", async () => {
  const f = fixture();
  assert.equal((await worker.fetch(request(undefined, { origin: "https://untrusted.invalid" }), f.env)).status, 403);
  assert.equal(f.inserts, 0);
});
test("counts actual streamed bytes when Content-Length is absent", async () => {
  const f = fixture();
  const r = request(JSON.stringify({ version: "test", violationClasses: ["x".repeat(70000)] }));
  assert.equal(r.headers.has("content-length"), false);
  assert.equal((await worker.fetch(r, f.env)).status, 413);
  assert.equal(f.inserts, 0);
});
test("rejects text/plain and stores an authenticated bounded JSON report", async () => {
  const f = fixture();
  assert.equal((await worker.fetch(request(undefined, { "content-type": "text/plain" }), f.env)).status, 415);
  assert.equal((await worker.fetch(request(), f.env)).status, 200);
  assert.equal(f.inserts, 1);
});
test("permits only same-origin or explicitly allowed browser origins", async () => {
  const f = fixture();
  assert.equal((await worker.fetch(request(undefined, { origin: "https://telemetry.example.invalid" }), f.env)).status, 200);
  assert.equal((await worker.fetch(request(undefined, { origin: "https://allowed.invalid" }), { ...f.env, ALLOWED_ORIGINS: "https://allowed.invalid" })).status, 200);
  assert.equal(f.inserts, 2);
});
