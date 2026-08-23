import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { EVIDENCE_CLASSES } from "../../src/protocol/schemas.js";
import { createServer } from "../../src/mcp/server.js";

// SLICE-AMEND-EVCLASS-DEV-002 / STORY-AMEND-002 — evidence-class enforcement
// proven at the TOOL SURFACE (odin.validate_closure_independence over a real
// MCP client/server pair), not via source import. The source-scoped coverage
// lives in tests/protocol/evidence-class.test.ts; this file exists because the
// story holdout exercises the built server: a missing evidence_class or
// missing source_binding on a verdict-class payload is a HARD rejection
// (invalid + named reason), while non-verdict payloads stay valid.

async function connectClient() {
  const server = createServer();
  const client = new Client({
    name: "odin-sentinel-surface-test",
    version: "1.0.0"
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

type ToolJson = { valid: boolean; missing: string[]; invalid: string[]; warnings: string[] };

async function callClosureTool(packet: Record<string, unknown>): Promise<ToolJson> {
  const { client, server } = await connectClient();
  try {
    const result = await client.callTool({
      name: "odin.validate_closure_independence",
      arguments: { packet }
    });
    const content = result.content as Array<{ type: string; text?: string }>;
    const first = content[0];
    if (!first || first.type !== "text") {
      throw new Error("Expected text tool result");
    }
    return JSON.parse(first.text ?? "") as ToolJson;
  } finally {
    await client.close();
    await server.close();
  }
}

function closureClaim(verdicts: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    task_ref: "SLICE-AMEND-EVCLASS-DEV-002",
    implementer_lane: "C/DEV-1",
    closing_authority: "C/TEAM-PM",
    verdicts
  };
}

// An otherwise closure-eligible independent pair, declared as verdict-class
// artifacts, so the evidence-class gate is the ONLY thing under test.
function classifiedPair(extra: Record<string, unknown> = {}): Array<Record<string, unknown>> {
  return [
    {
      artifact_class: "qa_verdict",
      verdict_kind: "SLICE_QA_PASS",
      result: "PASS",
      emitted_by: "C/QA-1",
      ...extra
    },
    {
      artifact_class: "qa_verdict",
      verdict_kind: "HOLDOUT_ACCEPTED",
      result: "PASS",
      emitted_by: "C/HLDT-1",
      ...extra
    }
  ];
}

describe("tool surface: odin.validate_closure_independence evidence-class hard gate", () => {
  it("rejects a verdict-class payload missing evidence_class, naming field and artifact class", async () => {
    const result = await callClosureTool(
      closureClaim(
        classifiedPair({
          source_binding: ".edge-agentic/local/evidence/SLICE-AMEND-EVCLASS-DEV-002/verify.log"
        })
      )
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("verdicts");
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("EVIDENCE_CLASS_REQUIRED");
    expect(warnings).toContain('"evidence_class"');
    expect(warnings).toContain("qa_verdict");
  });

  it("rejects a verdict-class payload missing source_binding, naming field and artifact class", async () => {
    const result = await callClosureTool(closureClaim(classifiedPair({ evidence_class: "observed" })));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("verdicts");
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("SOURCE_BINDING_REQUIRED");
    expect(warnings).toContain('"source_binding"');
    expect(warnings).toContain("qa_verdict");
  });

  it("accepts every canonical evidence_class value with source_binding at the tool surface", async () => {
    expect([...EVIDENCE_CLASSES]).toHaveLength(7);
    for (const evidenceClass of EVIDENCE_CLASSES) {
      const result = await callClosureTool(
        closureClaim(
          classifiedPair({
            evidence_class: evidenceClass,
            source_binding: ".edge-agentic/local/evidence/SLICE-AMEND-EVCLASS-DEV-002/verify.log"
          })
        )
      );
      expect(result.valid).toBe(true);
    }
  });

  it("rejects an illegal evidence_class value by name at the tool surface", async () => {
    const result = await callClosureTool(
      closureClaim(
        classifiedPair({
          evidence_class: "trusted_me",
          source_binding: "chat message"
        })
      )
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("verdicts");
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("EVIDENCE_CLASS_INVALID");
    expect(warnings).toContain('"trusted_me"');
  });

  it("leaves legacy non-verdict payloads valid without the fields (backward compatible)", async () => {
    const result = await callClosureTool(
      closureClaim(
        classifiedPair({ artifact_class: "boot_receipt" }).map((verdict) => {
          // A pre-RET-005 non-verdict artifact carries no evidence fields at all.
          return { artifact_class: "boot_receipt", verdict_kind: verdict.verdict_kind, result: verdict.result, emitted_by: verdict.emitted_by };
        })
      )
    );
    expect(result.valid).toBe(true);
    expect(result.invalid).not.toContain("verdicts");
    const warnings = result.warnings.join("\n");
    expect(warnings).not.toContain("EVIDENCE_CLASS_REQUIRED");
    expect(warnings).not.toContain("SOURCE_BINDING_REQUIRED");
  });
});
