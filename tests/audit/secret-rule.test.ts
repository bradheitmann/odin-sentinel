import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SLICE secret-scan-narrow. The "secret-looking unquoted assignment" rule lives in two audit
// scripts and must stay identical in both. It is narrowed so that a plain dotted identifier
// path with no digits (`current.record.token`) is member-access code, not a literal secret
// (EXEC-PM ruling 2026-11-01: false positive on property-access code). Every other value the
// rule matched before must still match — these fixtures are FAKE values with no real
// provider's token shape, so no external secret scanner is tripped.

// @ts-ignore - audit scripts are ESM .mjs modules without declaration files.
const publicSurface = await import("../../scripts/audit/public-surface.mjs");
// @ts-ignore - audit scripts are ESM .mjs modules without declaration files.
const verifyPack = await import("../../scripts/audit/verify-pack.mjs");

const RULE: RegExp = publicSurface.SECRET_UNQUOTED_ASSIGNMENT_RULE as RegExp;
const VERIFY_PACK_RULE: RegExp = verifyPack.SECRET_UNQUOTED_ASSIGNMENT_RULE as RegExp;

function flagged(rule: RegExp, text: string): boolean {
  rule.lastIndex = 0;
  return rule.test(text);
}

/**
 * Fake unquoted secret shapes (value-only: no real provider prefix, no real credential).
 * Each must be flagged by BOTH copies of the rule.
 */
const FAKE_SECRET_LINES: ReadonlyArray<{ label: string; line: string }> = [
  { label: "long alphanumeric", line: "token = qz7w8e9r0t1y2u3i4o5p6a7s8" },
  { label: "40-hex", line: "secret: 3f786850e387550fdab836ed7e6dc881de23001b" },
  { label: "64-hex", line: "apiKey: 9c1185a5c5e9fc54612808977ee8f548b2258d31f6b0c3a1d9a4d4e4c7b8a9f0" },
  { label: "base64 with +/=", line: "api_key = Zm9vYmFyYmF6cXV4KysvPQ==" },
  { label: "three-part dot with digits", line: "token: a1b2.c3d4.e5f6g7h8i9" },
  { label: "value with hyphens", line: "secret: my-super-secret-value-123" },
  { label: "value with underscores", line: "token: abc_def_ghi_jkl_mno" },
  { label: "password: value", line: "password: correcthorsebatterystaple" },
  { label: "API_KEY=value", line: "API_KEY=qzxwvutsrqponmlkjihgfedcba" },
  { label: "apiToken = value", line: "apiToken = abcdefghijklmnopqrst" },
  { label: "token= mixed base64url", line: "token=QWxhZGRpbjpvcGVuIHNlc2FtZQ" },
  { label: "capitalised key", line: "Password: YWJjZGVmZ2hpamtsbW5vcA" }
];

/** Dotted identifier paths with no digit: member access, never a secret. */
const EXEMPT_LINES: ReadonlyArray<string> = [
  "const currentToken = current.record.token;",
  "token = this.options.apiKey;",
  "secret: config.auth.secret",
  "apiKey: request.headers.authorization",
  "this.lease.token = state.record.token"
];

describe("the narrowed secret rule stays identical in both audit scripts", () => {
  it("verify-pack and public-surface carry the same rule", () => {
    expect(RULE).toBeInstanceOf(RegExp);
    expect(VERIFY_PACK_RULE).toBeInstanceOf(RegExp);
    expect(VERIFY_PACK_RULE.source).toBe(RULE.source);
    expect(VERIFY_PACK_RULE.flags).toBe(RULE.flags);
  });

  it("both scripts actually USE the shared constant for the unquoted-assignment rule", () => {
    // Guards against a script keeping the exported constant but wiring a different regex into
    // its rule list (which would silently re-widen or remove the check).
    for (const file of ["public-surface.mjs", "verify-pack.mjs"]) {
      const source = readFileSync(new URL(`../../scripts/audit/${file}`, import.meta.url), "utf8");
      expect(source, file).toMatch(
        /\{ name: "secret-looking unquoted assignment", pattern: SECRET_UNQUOTED_ASSIGNMENT_RULE \}/
      );
      expect(source, file).not.toMatch(/name: "secret-looking unquoted assignment", pattern: \//);
    }
  });
});

describe("fake secrets still trip the rule in both scripts", () => {
  it("flags every fake unquoted secret shape", () => {
    expect(FAKE_SECRET_LINES.length).toBeGreaterThanOrEqual(10);
    for (const { label, line } of FAKE_SECRET_LINES) {
      expect(flagged(RULE, line), `public-surface rule missed ${label}: ${line}`).toBe(true);
      expect(flagged(VERIFY_PACK_RULE, line), `verify-pack rule missed ${label}: ${line}`).toBe(true);
    }
  });

  it("keeps key-name matching inside longer identifiers", () => {
    expect(flagged(RULE, "apiToken = abcdefghijklmnopqrst")).toBe(true);
    expect(flagged(RULE, "mySecret: qzxwvutsrqponmlkjihgfe")).toBe(true);
  });
});

describe("the exemption is exactly a dotted identifier path with no digit", () => {
  it("does not flag dotted identifier paths without digits", () => {
    for (const line of EXEMPT_LINES) {
      expect(flagged(RULE, line), `public-surface rule flagged code: ${line}`).toBe(false);
      expect(flagged(VERIFY_PACK_RULE, line), `verify-pack rule flagged code: ${line}`).toBe(false);
    }
  });

  it("still flags a dotted value that contains a digit", () => {
    const line = "token: a1b2.c3d4.e5f6g7h8i9";
    expect(flagged(RULE, line)).toBe(true);
    expect(flagged(VERIFY_PACK_RULE, line)).toBe(true);
  });

  it("still flags a dotted path that is followed by more value characters", () => {
    const line = "token = current.record.token+suffix1234567";
    expect(flagged(RULE, line)).toBe(true);
    expect(flagged(VERIFY_PACK_RULE, line)).toBe(true);
  });

  it("no longer flags the slot-lease regression line", () => {
    const regression = "  const currentToken = current.record.token;";
    expect(flagged(RULE, regression)).toBe(false);
    expect(flagged(VERIFY_PACK_RULE, regression)).toBe(false);
  });
});
