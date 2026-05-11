import { describe, expect, it } from "vitest";
import { redactPayload, redactString } from "../../src/telemetry/redactor.js";

const MAC_HOME = "/" + "Users/" + "alice/code/app.ts";
const LINUX_HOME = "/" + "home/" + "bob/.config/odin";

describe("redactString", () => {
  it("redacts macOS home paths", () => {
    const input = `found at ${MAC_HOME} line 4`;
    const output = redactString(input);
    expect(output).not.toContain(MAC_HOME);
    expect(output).toContain("<HOME>");
  });

  it("redacts Linux home paths", () => {
    const output = redactString(LINUX_HOME);
    expect(output).not.toContain(LINUX_HOME);
    expect(output).toContain("<HOME>");
  });

  it("redacts email addresses", () => {
    const output = redactString("contact alice@example.org for details");
    expect(output).not.toContain("alice@example.org");
    expect(output).toContain("<EMAIL>");
  });

  it("redacts secret-token shapes", () => {
    const tokens = [
      "sk-" + "0123456789abcdefghijklmnopqrstuv",
      "lin_api_0123456789abcdef",
      "ghp_0123456789abcdef01234567890123",
      "AIza0123456789abcdefghijklmnopqrstuv"
    ];
    for (const token of tokens) {
      const output = redactString(`see token ${token} here`);
      expect(output).not.toContain(token);
      expect(output).toContain("<TOKEN>");
    }
  });

  it("leaves clean strings untouched", () => {
    expect(redactString("violation_class=staffing_gate_skipped")).toBe(
      "violation_class=staffing_gate_skipped"
    );
  });
});

describe("redactPayload", () => {
  it("walks objects and arrays recursively", () => {
    const homePath = "/" + "Users/" + "dave/x.ts";
    const input = {
      log: [`touched ${homePath}`, "email: x@y.com"],
      counts: { violations: 3, halts: 1 },
      ok: true
    };
    const redacted = redactPayload(input) as typeof input;
    expect(redacted.log[0]).toContain("<HOME>");
    expect(redacted.log[1]).toContain("<EMAIL>");
    expect(redacted.counts).toEqual({ violations: 3, halts: 1 });
    expect(redacted.ok).toBe(true);
  });

  it("preserves numbers, booleans, null", () => {
    const input = { n: 7, b: false, x: null };
    expect(redactPayload(input)).toEqual(input);
  });
});
