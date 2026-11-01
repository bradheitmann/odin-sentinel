import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @ts-ignore - audit script is an ESM .mjs module without declaration files.
const audit = await import("../../scripts/audit/public-surface.mjs");
const isPublicAuditFile = audit.isPublicAuditFile as (file: string) => boolean;
const auditPublicSurface = audit.auditPublicSurface as (fileTextByPath: Record<string, string>) => string[];

// SLICE public-roots-charter. Guarantee G3 (no private paths, markers or
// secrets on the public surface) covered charter/ only through a manual grep in
// charter/DONE/slice-zero.md, because PUBLIC_ROOTS in the audit did not list
// charter/ (obligation O1). charter/ is committed to this public repository, so
// it is public surface like docs/ and protocol/. This test pins the inclusion
// and the named finding for a planted home path; it does not weaken the audit
// with an exemption.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function charterFiles(): string[] {
  return walk(join(repoRoot, "charter"))
    .map((abs) => abs.slice(repoRoot.length).replace(/^\/+/, ""))
    .sort();
}

describe("charter/ is public audit surface", () => {
  it("treats every charter/ file as an audited file", () => {
    const files = charterFiles();
    expect(files.length).toBeGreaterThan(0);
    // The contract files this slice exists for, named explicitly.
    expect(files).toContain("charter/STATE.md");
    expect(files).toContain("charter/DONE/public-roots-charter.md");
    for (const file of files) {
      expect(isPublicAuditFile(file), file).toBe(true);
    }
  });

  it("still refuses paths outside the public roots", () => {
    expect(isPublicAuditFile("tests/audit/public-surface-roots.test.ts")).toBe(false);
    expect(isPublicAuditFile("src/protocol/service.ts")).toBe(false);
  });

  it("reports a planted home path under charter/ as a named finding", () => {
    const planted = join("/", "Users", "somebuilder", "scratch", "notes.md");
    const findings = auditPublicSurface({
      "charter/planted-home-path.md": `Scratch notes at ${planted} before publishing.`
    });
    expect(findings).toEqual(["charter/planted-home-path.md: macOS home path"]);
  });

  it("reports a planted private marker under charter/ as a named finding", () => {
    const marker = ["open", "protocols"].join("_");
    const findings = auditPublicSurface({
      "charter/DONE/planted-marker.md": `Sourced from ${marker} on the private side.`
    });
    expect(findings).toEqual(["charter/DONE/planted-marker.md: private project or account marker"]);
  });

  it("finds nothing in the real charter/ files", () => {
    for (const file of charterFiles()) {
      const text = readFileSync(join(repoRoot, file), "utf8");
      expect(auditPublicSurface({ [file]: text }), file).toEqual([]);
    }
  });

  it("the real gate reports a count that includes the charter/ files", () => {
    const output = execFileSync(process.execPath, ["scripts/audit/public-surface.mjs"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    const match = /Public surface audit PASS: (\d+) files checked/.exec(output);
    expect(match, output).not.toBeNull();
    const checked = Number(match?.[1] ?? "0");
    // Baseline bdc6aab checked 81 files without charter/; charter/ adds one file
    // per committed (or untracked) file, so the count can only grow past it.
    expect(checked).toBeGreaterThanOrEqual(81 + charterFiles().length);
  });
});

// SLICE public-roots-crates (standard gap CS-2 part 1). The Rust crate is
// committed to this public repository, so it is public surface like docs/,
// protocol/ and charter/. Same shape as the charter/ slice: prove inclusion and
// the named findings; no exemption for the crate.

function cratesFiles(): string[] {
  return walk(join(repoRoot, "crates"))
    .map((abs) => abs.slice(repoRoot.length).replace(/^\/+/, ""))
    .sort();
}

describe("crates/ is public audit surface", () => {
  it("treats every crates/ file as an audited file", () => {
    const files = cratesFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("crates/odin-say/README.md");
    expect(files).toContain("crates/odin-say/Cargo.toml");
    expect(files).toContain("crates/odin-say/src/config.rs");
    for (const file of files) {
      expect(isPublicAuditFile(file), file).toBe(true);
    }
  });

  it("reports a planted home path under crates/ as a named finding", () => {
    const planted = join("/", "Users", "somebuilder", "checkout", "log.jsonl");
    const findings = auditPublicSurface({
      "crates/odin-say/PLANTED.md": `Built from ${planted} before publishing.`
    });
    expect(findings).toEqual(["crates/odin-say/PLANTED.md: macOS home path"]);
  });

  it("reports a tilde home path under crates/ as a named finding", () => {
    const findings = auditPublicSurface({
      "crates/odin-say/src/planted.rs": "//! fallback: `~/state/odin/proof.jsonl`"
    });
    expect(findings).toEqual(["crates/odin-say/src/planted.rs: tilde home path"]);
  });

  it("finds nothing in the real crates/ files", () => {
    for (const file of cratesFiles()) {
      const text = readFileSync(join(repoRoot, file), "utf8");
      expect(auditPublicSurface({ [file]: text }), file).toEqual([]);
    }
  });

  it("the real gate reports a count that includes the crates/ files", () => {
    const output = execFileSync(process.execPath, ["scripts/audit/public-surface.mjs"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    const match = /Public surface audit PASS: (\d+) files checked/.exec(output);
    expect(match, output).not.toBeNull();
    const checked = Number(match?.[1] ?? "0");
    // The base checked 125 files without crates/; crates/ adds one file per
    // committed (or untracked) file, so the count can only grow past that.
    expect(checked).toBeGreaterThanOrEqual(125 + cratesFiles().length);
  });
});
