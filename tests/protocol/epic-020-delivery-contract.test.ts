import { mkdtempSync, chmodSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateCmuxDeliveryProof } from "../../src/protocol/index.js";

// EPIC-020 — harness-aware delivery. Field origin 2026-06-27: embedded newlines
// sent to GLM-5.2/Pi submit one line per prompt ("machine-gunning") even with
// Enter sent; the trigger is the newline itself, not multiple send calls.

function baseProof(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    target_surface_locator: "cmux workspace:9 surface:143",
    submitted: true,
    verification_method: "read-screen",
    observed_processing_state: "DELIVERED_ACKED",
    timestamp: "2026-07-06T20:00:00Z",
    sender_role: "A/EXEC-PM",
    ...overrides
  };
}

describe("validateCmuxDeliveryProof — send != submit (existing contract preserved)", () => {
  it("accepts a submitted + confirmed proof", () => {
    expect(validateCmuxDeliveryProof(baseProof()).valid).toBe(true);
  });

  it("still fails a sent-but-not-submitted proof", () => {
    const result = validateCmuxDeliveryProof(baseProof({ submitted: false }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("submitted");
  });

  it("still fails INPUT_BAR_ONLY", () => {
    const result = validateCmuxDeliveryProof(baseProof({ observed_processing_state: "INPUT_BAR_ONLY" }));
    expect(result.valid).toBe(false);
  });
});

describe("MULTILINE_TO_SINGLE_SUBMIT_HARNESS — the machine-gunning verdict", () => {
  it("fails a multi-line payload to a single-submit harness EVEN WITH Enter sent", () => {
    const result = validateCmuxDeliveryProof(
      baseProof({
        target_submit_profile: "single_line_flatten",
        payload_preview: "line one\nline two\nline three"
      })
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("payload_contains_newline");
    expect(result.warnings.join(" ")).toMatch(/MULTILINE_TO_SINGLE_SUBMIT_HARNESS/);
    expect(result.warnings.join(" ")).toMatch(/embedded newlines/);
  });

  it("accepts the same payload once the canonical helper flattened it", () => {
    const result = validateCmuxDeliveryProof(
      baseProof({
        target_submit_profile: "single_line_flatten",
        payload_contains_newline: true,
        newlines_flattened: true
      })
    );
    expect(result.valid).toBe(true);
  });

  it("accepts a genuinely single-line payload to a single-submit harness", () => {
    const result = validateCmuxDeliveryProof(
      baseProof({
        target_submit_profile: "single_line_flatten",
        payload_preview: "BOOT ;; role=C/PM ;; branch=main ;; ack with receipt"
      })
    );
    expect(result.valid).toBe(true);
  });

  it("does not flag multi-line payloads to multi-line-capable harnesses", () => {
    const result = validateCmuxDeliveryProof(
      baseProof({
        target_submit_profile: "double_enter",
        payload_preview: "line one\nline two"
      })
    );
    expect(result.valid).toBe(true);
  });

  it("detects carriage returns as embedded newlines too", () => {
    const result = validateCmuxDeliveryProof(
      baseProof({ target_submit_profile: "single_line_flatten", payload_preview: "a\rb" })
    );
    expect(result.valid).toBe(false);
  });
});

describe("pre-dispatch dry-run", () => {
  it("validates format compatibility BEFORE the send (no submitted/state required)", () => {
    const result = validateCmuxDeliveryProof({
      dry_run: true,
      target_surface_locator: "cmux workspace:9 surface:143",
      sender_role: "A/EXEC-PM",
      timestamp: "2026-07-06T20:00:00Z",
      target_submit_profile: "single_line_flatten",
      payload_preview: "single line only ;; ready"
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/dry_run/);
  });

  it("fails a dry-run whose payload would machine-gun the target", () => {
    const result = validateCmuxDeliveryProof({
      dry_run: true,
      target_surface_locator: "cmux workspace:9 surface:143",
      sender_role: "A/EXEC-PM",
      timestamp: "2026-07-06T20:00:00Z",
      target_submit_profile: "single_line_flatten",
      payload_preview: "boot contract:\n- step 1\n- step 2"
    });
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/MULTILINE_TO_SINGLE_SUBMIT_HARNESS/);
  });
});

describe("per-harness format matrix (seeds)", () => {
  const seed = (name: string) =>
    JSON.parse(readFileSync(new URL(`../../src/harness-pacing/seeds/${name}.json`, import.meta.url), "utf8"));

  it("pi is single_line_flatten with ' ;; ' separators and multi_line_ok=false", () => {
    const pi = seed("pi");
    expect(pi.message_format.submit_profile).toBe("single_line_flatten");
    expect(pi.message_format.newline_policy).toBe("flatten_to_space");
    expect(pi.message_format.multi_line_ok).toBe(false);
    expect(pi.message_format.field_separator).toBe(" ;; ");
  });

  it("glm-droid is double_enter with second-Enter-on-busy", () => {
    const droid = seed("glm-droid");
    expect(droid.message_format.submit_profile).toBe("double_enter");
    expect(droid.message_format.second_enter_on_busy).toBe(true);
    expect(droid.message_format.multi_line_ok).toBe(true);
  });

  it("opencode is single_enter_verify and forbids a blind second Enter", () => {
    const oc = seed("opencode");
    expect(oc.message_format.submit_profile).toBe("single_enter_verify");
    expect(oc.message_format.newline_policy).toBe("preserve");
    expect(oc.message_format.multi_line_ok).toBe(true);
    // The blind-second-Enter hazard MUST be documented on the profile.
    expect(oc.message_format.notes).toMatch(/blind second Enter/i);
    expect(oc.message_format.notes).toMatch(/interrupts reply generation/i);
    expect(oc.message_format.notes).toMatch(/re-Enter once only/i);
    expect(oc.recommended.submit_profile).toBe("single_enter_verify");
  });

  it("legacy seeds without format-era event fields still parse (additive schema)", () => {
    for (const name of ["cmux", "crush", "glm-droid"]) {
      const s = seed(name);
      expect(s.harness_id).toBe(name);
      expect(Array.isArray(s.events)).toBe(true);
    }
  });
});

describe("canonical governed send helper (cmux-send-governed.sh)", () => {
  const helperPath = fileURLToPath(new URL("../../scripts/protocol/cmux-send-governed.sh", import.meta.url));

  function flattenOnly(profile: string, input: string) {
    return spawnSync("sh", [helperPath, "--flatten-only", "--profile", profile], { input, encoding: "utf8" });
  }

  it("flattens newlines/CR/tabs to single spaces for a single_line_flatten target", () => {
    const res = flattenOnly("single_line_flatten", "line one\nline two\nline three");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("line one line two line three");
  });

  it("collapses carriage returns and tabs too", () => {
    const res = flattenOnly("single_line_flatten", "a\r\n\tb");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("a b");
  });

  it("leaves a genuinely single-line payload unchanged", () => {
    const res = flattenOnly("single_line_flatten", "BOOT ;; role=C/PM ;; branch=main");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("BOOT ;; role=C/PM ;; branch=main");
  });

  it("does NOT flatten multi-line payloads for multi-line-capable profiles", () => {
    const res = flattenOnly("double_enter", "line one\nline two");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("line one\nline two");
  });

  it("rejects an unknown submit_profile (fails closed)", () => {
    const res = flattenOnly("bogus", "x");
    expect(res.status).not.toBe(0);
  });

  // --- D1/D2: live cmux CLI contract (dry-run, non-sending) ---
  function dryRun(args: string[]) {
    return spawnSync("sh", [helperPath, "--dry-run", ...args], { encoding: "utf8" });
  }
  function sendKeys(res: { stdout: string }) {
    return res.stdout.split("\n").filter((l) => l.includes("cmux send-key"));
  }

  it("D1: send uses --workspace/--surface + positional text (never --target/--message)", () => {
    const res = dryRun(["--workspace", "6", "--surface", "108", "--profile", "single_line_flatten", "BOOT ;; ack"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/cmux send --workspace '6' --surface '108' 'BOOT ;; ack'/);
    expect(res.stdout).not.toMatch(/--target|--message/);
  });

  it("D2: send-key emits the lowercase `enter` token per the live cmux CLI", () => {
    const res = dryRun(["--workspace", "6", "--surface", "108", "--profile", "single_line_flatten", "msg"]);
    expect(res.status).toBe(0);
    const keys = sendKeys(res);
    expect(keys).toHaveLength(1);
    // Live CLI form is lowercase `enter` (stale docs/adapters spell it `Enter`).
    // Payload/locator tokens are single-quoted in the dry-run render (D4).
    expect(keys[0]).toMatch(/--surface '108' enter$/);
    expect(keys[0]).not.toMatch(/Enter$/);
  });

  it("D3: single_enter_verify without --verify sends exactly ONE enter (no blind second)", () => {
    const res = dryRun(["--workspace", "6", "--surface", "108", "--profile", "single_enter_verify", "hello"]);
    expect(res.status).toBe(0);
    expect(sendKeys(res)).toHaveLength(1);
  });

  it("D3: single_enter_verify with --verify re-Enters ONCE when the input bar still shows the message head", () => {
    const res = dryRun([
      "--workspace", "6", "--surface", "108", "--profile", "single_enter_verify",
      "--verify", "--verify-cmd", "printf '%s' 'hello there'", "hello"
    ]);
    expect(res.status).toBe(0);
    expect(sendKeys(res)).toHaveLength(2);
  });

  it("D3: single_enter_verify with --verify does NOT re-Enter when the input bar no longer shows the head", () => {
    const res = dryRun([
      "--workspace", "6", "--surface", "108", "--profile", "single_enter_verify",
      "--verify", "--verify-cmd", "printf '%s' 'totally unrelated'", "hello"
    ]);
    expect(res.status).toBe(0);
    expect(sendKeys(res)).toHaveLength(1);
  });

  // --- D4: command-injection hardening (non-sending: dry-run render + stubbed cmux) ---
  // The helper must NEVER construct a shell command string from arbitrary payload/
  // workspace/surface values. Dry-run renders a shell-safe display (single-quoted);
  // live execution is direct cmux argv (verified via a stubbed cmux on PATH).
  const METACHAR_PAYLOADS = [
    { name: "command substitution $(...)", text: "run $(echo INJECTED_OUTPUT) end" },
    { name: "backtick substitution", text: "run `echo INJECTED_OUTPUT` end" },
    { name: "double quotes", text: 'say "hello world"' },
    { name: "single quote / apostrophe", text: "it's a test" },
    { name: "semicolons", text: "a; b; c" },
    { name: "pipe and ampersand", text: "a | b && c" },
    { name: "markdown fence", text: "```sh\necho hi\n```" },
    { name: "shell snippet", text: "for i in 1 2 3; do echo $i; done" }
  ];

  describe.each(METACHAR_PAYLOADS)("D4 dry-run render is literal for $name", ({ text }) => {
    it("renders a shell-safe send command that round-trips to the exact payload bytes", () => {
      const res = dryRun(["--workspace", "6", "--surface", "108", "--profile", "single_enter_verify", text]);
      expect(res.status).toBe(0);
      // Round-trip proof: the dry-run render is valid sh. Parse its send command
      // back through a shell and confirm the positional payload arg reconstructs
      // the ORIGINAL bytes. If the helper had interpolated the raw payload into
      // sh -c, this would either error or yield the EVALUATED form (e.g.
      // `$(echo X)` collapses to `X`; an apostrophe would break parsing). The
      // render may span physical lines for multi-line payloads, so slice from the
      // send command up to the first send-key line.
      const out = res.stdout;
      const sendStart = out.indexOf("cmux send ");
      expect(sendStart).toBeGreaterThanOrEqual(0);
      const keyIdx = out.indexOf("\ncmux send-key", sendStart);
      const sendRegion = (keyIdx === -1 ? out.slice(sendStart) : out.slice(sendStart, keyIdx)).replace(/^cmux send /, "").trim();
      const rt = spawnSync("sh", ["-c", `set -- ${sendRegion}; shift 4; printf '%s' "$1"`], { encoding: "utf8" });
      expect(rt.status).toBe(0);
      expect(rt.stdout).toBe(text);
    });
  });

  it("D4: workspace/surface tokens are single-quoted in dry-run render (locator injection blocked)", () => {
    const res = dryRun(["--workspace", "6; echo PWN", "--surface", "108", "--profile", "single_line_flatten", "msg"]);
    expect(res.status).toBe(0);
    // The workspace value '6; echo PWN' must be rendered as one quoted token, not
    // split/evaluated. If it were interpolated into sh -c, `echo PWN` would run.
    expect(res.stdout).toMatch(/--workspace '6; echo PWN'/);
    expect(res.stdout).not.toMatch(/^PWN$/m);
    expect(res.stdout).not.toMatch(/echo PWN[^']/);
  });

  it("D4 live path delivers payload as ONE literal argv element (stubbed cmux, non-sending)", () => {
    // Build a temp PATH containing a stubbed `cmux` that records each argv element
    // to a log file. The helper's live path must invoke it directly with the payload
    // as a single positional arg, never via sh -c interpolation. We stub ONLY send/
    // send-key/read-screen (read-only recorders); no real cmux, no role-slot probe.
    const tmpDir = mkdtempSync(join(realpathSync(tmpdir()), "scpd4-"));
    const logPath = join(tmpDir, "argv.log");
    const stub = join(tmpDir, "cmux");
    // One template literal so ${logPath} interpolates ONCE into a shell var; the
    // stub records each argv element as a literal (no payload text reaches $1
    // of a real shell — it is captured as data by the recorder).
    writeFileSync(stub, `#!/bin/sh
LOG="${logPath}"
printf 'CMD\\t%s\\n' "$1" >> "$LOG"
shift
for a in "$@"; do printf 'ARG\\t[%s]\\n' "$a" >> "$LOG"; done
exit 0
`);
    chmodSync(stub, 0o755);

    const payload = "run $(echo INJECTED_OUTPUT) `echo X`; '" + 'q' + "'";
    const res = spawnSync("sh", [
      helperPath, "--workspace", "6", "--surface", "108", "--profile", "single_enter_verify", payload
    ], { encoding: "utf8", env: { ...process.env, PATH: `${tmpDir}${delimiter}${process.env.PATH}` } });

    expect(res.status).toBe(0);
    const log = readFileSync(logPath, "utf8");
    // The payload arrived as ONE literal argv element — the `$(...)` and
    // backtick structures are intact, NOT evaluated. (If `sh -c` had built the
    // command, `$(echo INJECTED_OUTPUT)` would have COLLAPSED to just
    // `INJECTED_OUTPUT` with the `$(echo ` and `)` consumed; direct argv keeps
    // the whole string literal.)
    expect(log).toContain(`ARG\t[${payload}]`);
    // send-key also recorded with lowercase enter and literal locator tokens.
    const sendKeys_ = log.split("\n").filter((l) => l.startsWith("CMD\tsend-key"));
    expect(sendKeys_.length).toBe(1);
  });

  it("D4: helper passes shellcheck (no shell-injection anti-patterns) — DoD gate", () => {
    // A clean shellcheck is the deterministic gate that the helper contains no
    // unquoted expansions feeding sh -c. Runs shellcheck (POSIX sh). If shellcheck
    // is unavailable in the environment, this test still asserts the helper source
    // contains NO `sh -c` call (the minimum structural invariant).
    const res = spawnSync("shellcheck", ["-s", "sh", helperPath], { encoding: "utf8" });
    if (res.status === null && /ENOENT/.test(String(res.error))) {
      // shellcheck not installed: assert the structural invariant instead.
      const src = readFileSync(helperPath, "utf8");
      // The live path must not invoke sh -c on a constructed command string.
      // (should_reenter's caller-supplied --verify-cmd reader is the only allowed
      //  sh -c, and it receives NO payload text; it is a caller-owned reader.)
      expect(src).not.toMatch(/emit_cmux[\s\S]*sh -c/);
      return;
    }
    expect(res.status).toBe(0);
    expect(res.stderr + res.stdout).toBe("");
  });

  it("double_enter sends two enter keys", () => {
    const res = dryRun(["--workspace", "6", "--surface", "108", "--profile", "double_enter", "msg"]);
    expect(res.status).toBe(0);
    expect(sendKeys(res)).toHaveLength(2);
  });

  it("hardening: REFUSES when --workspace is absent (no focus-dependent default)", () => {
    const res = dryRun(["--surface", "108", "--profile", "single_enter_verify", "msg"]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/--workspace is required/);
  });

  it("hardening: accepts a UUID surface via --target <ws>:<uuid>", () => {
    const res = dryRun(["--target", "6:ADA6C600-1ECF-4270-8E79-D54CC422DF2D", "--profile", "single_enter_verify", "msg"]);
    expect(res.status).toBe(0);
    // D4: locator tokens are single-quoted in the dry-run render.
    expect(res.stdout).toMatch(/--surface 'ADA6C600-1ECF-4270-8E79-D54CC422DF2D' /);
  });

  it("--verify applies only to single_enter_verify (refused otherwise)", () => {
    const res = dryRun(["--workspace", "6", "--surface", "108", "--profile", "double_enter", "--verify", "msg"]);
    expect(res.status).not.toBe(0);
  });
});
