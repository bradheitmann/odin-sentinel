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
      "sk-proj-" + "0123456789abcdefghijklmnopqrstuv_0123456789",
      "lin_api_0123456789abcdef",
      "ghp_0123456789abcdef01234567890123",
      "AIza0123456789abcdefghijklmnopqrstuv",
      "github_pat_" + "0123456789abcdef_0123456789abcdef",
      "dp.st." + "0123456789abcdef0123456789abcdef"
    ];
    for (const token of tokens) {
      const output = redactString(`see token ${token} here`);
      expect(output).not.toContain(token);
      expect(output).toContain("<TOKEN>");
    }
  });

  it("redacts bearer and OAuth-style credentials", () => {
    const bearer = "Bearer " + "abcDEF0123456789xyz";
    const oauth = "oauth_token=" + "oauth-0123456789abcdef";
    const output = redactString(`${bearer}\n${oauth}`);
    expect(output).not.toContain("abcDEF0123456789xyz");
    expect(output).not.toContain("oauth-0123456789abcdef");
    expect(output).toContain("Bearer <TOKEN>");
    expect(output).toContain("oauth_token=<SECRET>");
  });

  it("masks full environment dump lines", () => {
    const output = redactString("PATH=/usr/bin\nOPENAI_API_KEY=sk-0123456789abcdefghijklmnopqrstuv\nNODE_ENV=test");
    expect(output).toContain("PATH=<ENV_VALUE>");
    expect(output).toContain("OPENAI_API_KEY=<ENV_VALUE>");
    expect(output).toContain("NODE_ENV=<ENV_VALUE>");
    expect(output).not.toContain("/usr/bin");
  });

  it("redacts Doppler-style and provider config-like text", () => {
    const input = [
      "DOPPLER_TOKEN='" + "dp.st.0123456789abcdef0123456789abcdef" + "'",
      '{"provider":"openai","apiKey":"' + "sk-0123456789abcdefghijklmnopqrstuv" + '","model":"gpt-test"}'
    ].join("\n");
    const output = redactString(input);
    expect(output).toContain("DOPPLER_TOKEN=<ENV_VALUE>");
    expect(output).toContain('"provider":"openai"');
    expect(output).toContain('"apiKey":"<SECRET>"');
    expect(output).toContain('"model":"gpt-test"');
  });

  it("leaves clean diagnostic classifications untouched", () => {
    expect(redactString("violation_class=staffing_gate_skipped blocker=stale_mcp_version")).toBe(
      "violation_class=staffing_gate_skipped blocker=stale_mcp_version"
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

  it("masks sensitive object fields while preserving non-secret diagnostic fields", () => {
    const input = {
      provider: "OpenHands",
      blockerClassification: ["auth_blocker", "stale_mcp_version"],
      version: "0.2.1",
      apiKey: "sk-" + "0123456789abcdefghijklmnopqrstuv",
      nested: {
        oauthToken: "oauth-0123456789abcdef",
        status: true
      }
    };
    const redacted = redactPayload(input) as typeof input;
    expect(redacted.provider).toBe("OpenHands");
    expect(redacted.blockerClassification).toEqual(["auth_blocker", "stale_mcp_version"]);
    expect(redacted.version).toBe("0.2.1");
    expect(redacted.apiKey).toBe("<SECRET>");
    expect(redacted.nested.oauthToken).toBe("<SECRET>");
    expect(redacted.nested.status).toBe(true);
  });

  it("preserves numbers, booleans, null", () => {
    const input = { n: 7, b: false, x: null };
    expect(redactPayload(input)).toEqual(input);
  });
});
