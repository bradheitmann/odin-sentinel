import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// CI action pinning (standard gap CS-4). The common engineering standard requires
// GitHub Actions and other CI inputs to be pinned to immutable references, so a
// workflow cannot run code that changed after review. Every `uses:` must name a
// full 40-character commit sha; local `./` actions are allowed, and an action
// pinned in more than one workflow must use the same sha everywhere.

const WORKFLOW_DIR = fileURLToPath(new URL("../../.github/workflows", import.meta.url));

const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/;
const USES_LINE = /^(\s*(?:-\s*)?uses:\s*)(\S+)\s*(?:#.*)?$/;

export type Finding = {
  file: string;
  line: number;
  ref: string;
  reason: string;
};

type UseSite = {
  file: string;
  line: number;
  action: string;
  ref: string;
};

function collectUseSites(files: Record<string, string>): { sites: UseSite[]; findings: Finding[] } {
  const sites: UseSite[] = [];
  const findings: Finding[] = [];
  for (const [file, text] of Object.entries(files)) {
    text.split("\n").forEach((line, index) => {
      const match = USES_LINE.exec(line);
      if (match === null) return;
      const ref = match[2];
      const lineNumber = index + 1;
      if (ref.startsWith("./")) {
        // A local action lives in the reviewed repository itself.
        return;
      }
      const at = ref.lastIndexOf("@");
      if (at <= 0 || !PINNED.test(ref)) {
        findings.push({
          file,
          line: lineNumber,
          ref,
          reason: `uses: "${ref}" is not pinned to a 40-hex commit sha`
        });
        return;
      }
      sites.push({ file, line: lineNumber, action: ref.slice(0, at), ref });
    });
  }
  return { sites, findings };
}

export function checkWorkflows(files: Record<string, string>): Finding[] {
  // One rule: every non-local `uses:` is a full 40-hex commit sha. The SAME action may be
  // pinned to different immutable shas in different workflows (the charter job runs a v4
  // checkout while the rest run v6); a tag or branch anywhere is still a finding.
  return collectUseSites(files).findings;
}

function realWorkflows(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(WORKFLOW_DIR).sort()) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    files[name] = readFileSync(join(WORKFLOW_DIR, name), "utf8");
  }
  return files;
}

function refsFor(files: Record<string, string>): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  for (const site of collectUseSites(files).sites) {
    const shas = refs.get(site.action) ?? new Set<string>();
    shas.add(site.ref.slice(site.ref.lastIndexOf("@") + 1));
    refs.set(site.action, shas);
  }
  return refs;
}

describe("CI action pins", () => {
  it("finds uses: lines at all (anti-vacuity)", () => {
    const files = realWorkflows();
    expect(Object.keys(files).sort()).toEqual(["ci.yml", "release.yml"]);
    const refs = refsFor(files);
    expect(refs.size).toBeGreaterThanOrEqual(2);
    expect([...refs.keys()]).toContain("actions/checkout");
    expect([...refs.keys()]).toContain("actions/setup-node");
  });

  it("pins every uses: in every workflow to a 40-hex commit sha", () => {
    expect(checkWorkflows(realWorkflows())).toEqual([]);
  });

  it("accepts more than one immutable sha for the same action", () => {
    const refs = refsFor(realWorkflows());
    // actions/checkout appears with a v6 pin and the charter job's v4 pin; both are 40-hex
    // commits, so both are acceptable.
    const checkout = refs.get("actions/checkout");
    expect(checkout).toBeDefined();
    for (const sha of checkout ?? []) {
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    }
    expect((checkout ?? new Set<string>()).size).toBeGreaterThanOrEqual(2);
  });

  it("reports a tag ref with its file and line", () => {
    const findings = checkWorkflows({
      "release.yml": 'name: Release\njobs:\n  validate:\n    steps:\n      - uses: actions/checkout@v6\n'
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("release.yml");
    expect(findings[0].line).toBe(5);
    expect(findings[0].reason).toContain("actions/checkout@v6");
  });

  it("reports a branch ref and a short sha", () => {
    const findings = checkWorkflows({
      "ci.yml": [
        "steps:",
        "  - uses: actions/checkout@main",
        "  - uses: actions/setup-node@d23441a"
      ].join("\n")
    });
    expect(findings.map((finding) => finding.line)).toEqual([2, 3]);
    expect(findings.every((finding) => finding.file === "ci.yml")).toBe(true);
  });

  it("allows a local action", () => {
    expect(checkWorkflows({ "ci.yml": "steps:\n  - uses: ./.github/actions/verify\n" })).toEqual([]);
  });

  it("still reports a tag on one of two shas for the same action", () => {
    const sha = "a".repeat(40);
    const findings = checkWorkflows({
      "ci.yml": `steps:\n  - uses: actions/checkout@${sha}\n`,
      "release.yml": "steps:\n  - uses: actions/checkout@v4\n"
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("release.yml");
    expect(findings[0].line).toBe(2);
    expect(findings[0].reason).toContain("actions/checkout@v4");
  });
});
