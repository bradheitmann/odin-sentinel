import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../../src/mcp/server.js";
import { validateCmuxDeliveryProof } from "../../src/protocol/index.js";
import { CMUX_DELIVERY_VERDICTS } from "../../src/protocol/service.js";

// SLICE delivery-verdicts. Field origin 2026-10-31: a real sender log held
// 2,451 CMUX delivery records, 1,485 of them pre-send refusals (busy pane,
// permission prompt, stranded input). The legacy validator called every
// refusal "invalid" and read PANE_STILL_THINKING as "delivered, still
// processing" — the same state name used by field senders for "not sent
// because the pane was busy". The slice keeps every legacy verdict and adds an
// optional record_kind plus an additive `delivery` field.

type FieldSample = {
  timestamp: string;
  subcommand: string;
  target_surface_locator: string;
  submitted: boolean;
  verification_method: string;
  observed_processing_state: string;
  sender_role: string;
  note: string;
};

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/delivery-verdicts/reveng-ops.jsonl", import.meta.url)
);

const FIELD_SAMPLES: FieldSample[] = readFileSync(FIXTURE_PATH, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as FieldSample);

/** A refusal is the same field record, typed as a pre-send non-delivery. */
function asSendRefusal(sample: FieldSample, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...sample, record_kind: "send_refusal", submitted: false, ...overrides };
}

const WARNING_NOT_SUBMITTED =
  "CMUX text was not submitted with Enter; this is INPUT_BAR_ONLY, not delivery. Send Enter and re-read the target surface.";
const WARNING_INPUT_BAR_ONLY =
  "INPUT_BAR_ONLY: text is visible in the target input bar but not processed; not a valid delivery until submitted and confirmed.";

const LEGACY_VERDICTS = [
  {
    note: "echoed (DELIVERED_ACKED)",
    valid: true,
    invalid: [],
    warnings: []
  },
  {
    note: "processing (DELIVERED_NO_ACK)",
    valid: true,
    invalid: [],
    warnings: ["Delivered, but no acknowledgement observed yet; revisit on the next poll."]
  },
  {
    note: "after-2-enters (INPUT_BAR_ONLY, submitted true)",
    valid: false,
    invalid: ["observed_processing_state"],
    warnings: [WARNING_INPUT_BAR_ONLY]
  },
  {
    note: "pre-send (PANE_BLOCKED_ON_PERMISSION, submitted false)",
    valid: false,
    invalid: ["submitted"],
    warnings: [
      WARNING_NOT_SUBMITTED,
      "Target pane received the message but is blocked on a permission/approval prompt; classify and resolve before treating it as actioned."
    ]
  },
  {
    note: "pre-send (PANE_STILL_THINKING, submitted false)",
    valid: false,
    invalid: ["submitted"],
    warnings: [WARNING_NOT_SUBMITTED, "Delivered; target is still processing. Revisit to confirm completion."]
  },
  {
    note: "send-failed (INPUT_BAR_ONLY, submitted false)",
    valid: false,
    invalid: ["submitted", "observed_processing_state"],
    warnings: [WARNING_NOT_SUBMITTED, WARNING_INPUT_BAR_ONLY]
  },
  {
    note: "stale-text-stuck (INPUT_BAR_ONLY, submitted false)",
    valid: false,
    invalid: ["submitted", "observed_processing_state"],
    warnings: [WARNING_NOT_SUBMITTED, WARNING_INPUT_BAR_ONLY]
  }
] as const;

/** The five refusals in the field log: 2 busy/blocked + 3 INPUT_BAR_ONLY. */
const REFUSAL_INDEXES = [2, 3, 4, 5, 6] as const;

describe("legacy verdicts are unchanged for proofs without record_kind", () => {
  it("reproduces the frozen verdict for every sample in the field log", () => {
    expect(FIELD_SAMPLES).toHaveLength(LEGACY_VERDICTS.length);
    FIELD_SAMPLES.forEach((sample, index) => {
      const expected = LEGACY_VERDICTS[index];
      const result = validateCmuxDeliveryProof({ ...sample });
      expect(result.valid, `${expected.note}: valid`).toBe(expected.valid);
      expect(result.missing, `${expected.note}: missing`).toEqual([]);
      expect(result.invalid, `${expected.note}: invalid`).toEqual([...expected.invalid]);
      expect(result.warnings, `${expected.note}: warnings`).toEqual([...expected.warnings]);
    });
  });

  it("keeps an explicit record_kind \"delivery\" on the legacy path", () => {
    const delivered = { ...FIELD_SAMPLES[0], record_kind: "delivery" };
    const result = validateCmuxDeliveryProof(delivered);
    expect(result.valid).toBe(true);
    expect(result.delivery).toBe("delivered");
    expect(result.non_delivery_reason).toBeUndefined();
  });

  it("keeps the legacy 'not submitted' rejection byte-identical", () => {
    const result = validateCmuxDeliveryProof({ ...FIELD_SAMPLES[4] });
    expect(result.invalid).toEqual(["submitted"]);
    expect(result.warnings).toEqual([
      WARNING_NOT_SUBMITTED,
      "Delivered; target is still processing. Revisit to confirm completion."
    ]);
    expect(result.delivery).toBe("not_proven");
  });
});

describe("send_refusal is a typed non-delivery record", () => {
  it("accepts all five field refusals with delivery not_delivered and the state as non_delivery_reason", () => {
    expect(REFUSAL_INDEXES).toHaveLength(5);
    for (const index of REFUSAL_INDEXES) {
      const sample = FIELD_SAMPLES[index];
      const result = validateCmuxDeliveryProof(asSendRefusal(sample));
      expect(result.valid, sample.note).toBe(true);
      expect(result.delivery, sample.note).toBe("not_delivered");
      expect(result.non_delivery_reason, sample.note).toBe(sample.observed_processing_state);
      expect(result.invalid, sample.note).toEqual([]);
      expect(result.missing, sample.note).toEqual([]);
    }
  });

  it("does not mistake a pre-send PANE_STILL_THINKING refusal for a delivery", () => {
    const refusal = asSendRefusal(FIELD_SAMPLES[4]);
    const result = validateCmuxDeliveryProof(refusal);
    expect(result.valid).toBe(true);
    expect(result.delivery).toBe("not_delivered");
    expect(result.non_delivery_reason).toBe("PANE_STILL_THINKING");
    expect(result.warnings.join("\n")).not.toContain("Delivered; target is still processing");
  });
});

describe("a send_refusal cannot claim a delivery", () => {
  it("rejects submitted=true on a refusal record, by name", () => {
    const result = validateCmuxDeliveryProof(asSendRefusal(FIELD_SAMPLES[4], { submitted: true }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("submitted");
    expect(result.warnings.join("\n")).toContain("SEND_REFUSAL_CANNOT_CLAIM_DELIVERY");
    expect(result.delivery).toBe("not_proven");
  });

  it("rejects a DELIVERED_ACKED state on a refusal record, by name", () => {
    const result = validateCmuxDeliveryProof(
      asSendRefusal(FIELD_SAMPLES[0], { observed_processing_state: "DELIVERED_ACKED" })
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("observed_processing_state");
    expect(result.warnings.join("\n")).toContain("SEND_REFUSAL_CANNOT_CLAIM_DELIVERY");
    expect(result.delivery).toBe("not_proven");
  });

  it("rejects a DELIVERED_NO_ACK state on a refusal record, by name", () => {
    const result = validateCmuxDeliveryProof(
      asSendRefusal(FIELD_SAMPLES[1], { observed_processing_state: "DELIVERED_NO_ACK" })
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("observed_processing_state");
    expect(result.warnings.join("\n")).toContain("SEND_REFUSAL_CANNOT_CLAIM_DELIVERY");
    expect(result.delivery).toBe("not_proven");
  });

  it("refuses an unknown record_kind value", () => {
    const result = validateCmuxDeliveryProof({ ...FIELD_SAMPLES[0], record_kind: "send_intent" });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("record_kind");
    expect(result.warnings.join("\n")).toContain("record_kind must be one of");
    expect(result.delivery).toBe("not_proven");
  });
});

describe("the delivery field is additive and total", () => {
  it("maps DELIVERED_ACKED to delivered and DELIVERED_NO_ACK to delivered_no_ack", () => {
    expect(validateCmuxDeliveryProof({ ...FIELD_SAMPLES[0] }).delivery).toBe("delivered");
    expect(validateCmuxDeliveryProof({ ...FIELD_SAMPLES[1] }).delivery).toBe("delivered_no_ack");
  });

  it("maps a submitted pre-send PANE_STILL_THINKING delivery record to delivered_no_ack", () => {
    // Same state name, post-send kind: the record claims Enter plus an observed
    // still-processing pane, so it is delivered-but-not-acknowledged.
    const result = validateCmuxDeliveryProof({ ...FIELD_SAMPLES[4], submitted: true });
    expect(result.valid).toBe(true);
    expect(result.delivery).toBe("delivered_no_ack");
  });

  it("maps an invalid delivery record to not_proven", () => {
    expect(validateCmuxDeliveryProof({ ...FIELD_SAMPLES[4] }).delivery).toBe("not_proven");
    const multiline = validateCmuxDeliveryProof({
      ...FIELD_SAMPLES[0],
      target_submit_profile: "single_line_flatten",
      payload_preview: "line one\nline two"
    });
    expect(multiline.valid).toBe(false);
    expect(multiline.delivery).toBe("not_proven");
  });

  it("maps a dry-run plan check to not_proven", () => {
    const result = validateCmuxDeliveryProof({
      target_surface_locator: "surface:1000010150",
      sender_role: "EXEC PM",
      timestamp: "2026-10-31T00:00:00Z",
      dry_run: true
    });
    expect(result.valid).toBe(true);
    expect(result.delivery).toBe("not_proven");
  });

  it("keeps every legacy key and adds only delivery", () => {
    const result = validateCmuxDeliveryProof({ ...FIELD_SAMPLES[0] });
    for (const key of ["valid", "missing", "invalid", "warnings"]) {
      expect(result, key).toHaveProperty(key);
    }
    expect(CMUX_DELIVERY_VERDICTS).toContain(result.delivery);
    expect(result.delivery).toBe("delivered");
  });
});

describe("delivery survives the MCP boundary", () => {
  async function connectClient() {
    const server = createServer();
    const client = new Client({ name: "odin-delivery-verdicts-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
  }

  function parseTextResult(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
    const content = result.content as Array<{ type: string; text?: string }>;
    const first = content[0];
    if (!first || first.type !== "text") throw new Error("Expected text tool result");
    return JSON.parse(first.text ?? "") as Record<string, unknown>;
  }

  it("round-trips delivered, refusal and invalid verdicts through odin.validate_cmux_delivery_proof", async () => {
    const { client, server } = await connectClient();
    try {
      const delivered = parseTextResult(
        await client.callTool({
          name: "odin.validate_cmux_delivery_proof",
          arguments: { proof: { ...FIELD_SAMPLES[0] } }
        })
      );
      expect(delivered.delivery).toBe("delivered");

      const refusal = parseTextResult(
        await client.callTool({
          name: "odin.validate_cmux_delivery_proof",
          arguments: { proof: asSendRefusal(FIELD_SAMPLES[5]) }
        })
      );
      expect(refusal.valid).toBe(true);
      expect(refusal.delivery).toBe("not_delivered");
      expect(refusal.non_delivery_reason).toBe("INPUT_BAR_ONLY");

      const invalid = parseTextResult(
        await client.callTool({
          name: "odin.validate_cmux_delivery_proof",
          arguments: { proof: { ...FIELD_SAMPLES[3] } }
        })
      );
      expect(invalid.valid).toBe(false);
      expect(invalid.delivery).toBe("not_proven");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
