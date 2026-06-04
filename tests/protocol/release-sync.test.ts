import { describe, expect, it } from "vitest";

// @ts-ignore - audit scripts are ESM .mjs modules without declaration files.
const verifyPack = await import("../../scripts/audit/verify-pack.mjs");
// @ts-ignore - audit scripts are ESM .mjs modules without declaration files.
const publicSurface = await import("../../scripts/audit/public-surface.mjs");

const requiredPaths = verifyPack.requiredPackageFiles.map((path: string) => ({ path }));
const expectedRequiredPackageFiles = [
  ".claude-plugin/marketplace.json",
  "dist/src/bin/index.js",
  "dist/src/mcp/server.js",
  "dist/src/protocol/index.js",
  "dist/src/protocol/service.js",
  "dist/src/protocol/repository.js",
  "dist/src/protocol/schemas.js",
  "dist/src/protocol/validators.js",
  "dist/src/protocol/version.js",
  "docs/guides/quick-start.md",
  "docs/guides/quickstart-prompts.md",
  "docs/guides/recommended-starter-team.md",
  "docs/reference/client-compatibility.md",
  "docs/reference/cost-and-privacy.md",
  "docs/reference/distribution.md",
  "docs/reference/public-surface-audit.md",
  "protocol/SCP.md",
  "protocol/roles.yaml",
  "protocol/topology.yaml",
  "protocol/model-profiles.yaml",
  "protocol/closeout.yaml",
  "protocol/delegation.yaml",
  "protocol/receipts/boot-receipt.yaml",
  "protocol/receipts/team-manifest.yaml",
  "protocol/bootstrap-skill.md",
  "protocol/skill-references/boot-receipt-examples.md",
  "protocol/skill-references/canonical-introduction-prompt.md",
  "protocol/skill-references/harness-skill-targets.md",
  "protocol/skill-references/team-bootstrap-runbook.md",
  "plugins/odin-scp/.claude-plugin/plugin.json",
  "plugins/odin-scp/skills/odin-scp/SKILL.md",
  "plugins/odin-scp/skills/odin-scp/CHANGELOG.md",
  "plugins/odin-scp/skills/odin-scp/agents/openai.yaml",
  "plugins/odin-scp/skills/odin-scp/references/boot-receipt-examples.md",
  "plugins/odin-scp/skills/odin-scp/references/canonical-introduction-prompt.md",
  "plugins/odin-scp/skills/odin-scp/references/harness-skill-targets.md",
  "plugins/odin-scp/skills/odin-scp/references/team-bootstrap-runbook.md",
  "plugins/odin-scp/skills/odin-scp/scripts/sync-installations.sh",
  "plugins/odin-scp/README.md",
  "templates/dev-slice-template.md",
  "templates/qa-slice-template.md",
  "templates/pm-role-template.md",
  "templates/team-manifest-template.yaml",
  "scripts/audit/public-surface.mjs",
  "scripts/audit/verify-pack.mjs",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "LICENSE",
  "package.json"
];
const packageJson = {
  name: "@bradheitmann/odin-sentinel",
  version: "0.4.9",
  repository: { type: "git", url: "git+https://github.com/bradheitmann/odin-sentinel.git" },
  homepage: "https://github.com/bradheitmann/odin-sentinel#readme",
  bugs: { url: "https://github.com/bradheitmann/odin-sentinel/issues" },
  license: "MIT",
  engines: { node: ">=22.13.0" },
  files: [".claude-plugin", "dist", "docs", "plugins", "protocol", "templates", "scripts", "AGENTS.md", "CLAUDE.md", "README.md", "LICENSE"],
  dependencies: {
    "@modelcontextprotocol/sdk": "1.29.0",
    yaml: "2.8.4",
    zod: "4.4.3"
  },
  odin: { publicVersion: "0.4.9", minimumCompatibleChildMcpVersion: "0.4.5" }
};

const scpText = "SCP_PUBLIC_VERSION: 0.4.9\nMIN_COMPATIBLE_CHILD_MCP: 0.4.5\n";
const bootstrapText = `${scpText}\nMCP server native skill full prompt fallback CMUX auth/account readiness local inference role compatibility`;

function runWith(overrides: Record<string, unknown> = {}) {
  const publicVersionFiles = {
    "README.md": "0.4.9",
    "docs/guides/quick-start.md": "0.4.9",
    "docs/guides/quickstart-prompts.md": "0.4.9",
    "docs/reference/client-compatibility.md": "Node.js >=22.13.0",
    "docs/reference/distribution.md": "0.4.9",
    "docs/reference/public-surface-audit.md": "0.4.9",
    ".claude-plugin/marketplace.json": JSON.stringify({
      plugins: [
        {
          name: "odin-scp",
          source: "./plugins/odin-scp",
          version: "0.4.9"
        }
      ]
    }),
    "protocol/SCP.md": scpText,
    "protocol/bootstrap-skill.md": bootstrapText,
    "plugins/odin-scp/.claude-plugin/plugin.json": JSON.stringify({
      name: "odin-scp",
      version: "0.4.9",
      mcpServers: {
        "odin-sentinel": {
          command: "pnpm",
          args: ["dlx", "--package", "@bradheitmann/odin-sentinel@0.4.9", "odin-sentinel-mcp"]
        }
      }
    }),
    "plugins/odin-scp/skills/odin-scp/SKILL.md": scpText,
    "plugins/odin-scp/skills/odin-scp/CHANGELOG.md": "safe changelog",
    "plugins/odin-scp/skills/odin-scp/agents/openai.yaml": "safe adapter",
    "plugins/odin-scp/skills/odin-scp/references/boot-receipt-examples.md": "safe boot examples",
    "plugins/odin-scp/skills/odin-scp/references/canonical-introduction-prompt.md": "safe prompt",
    "plugins/odin-scp/skills/odin-scp/references/harness-skill-targets.md": "safe harness targets",
    "plugins/odin-scp/skills/odin-scp/references/team-bootstrap-runbook.md": "safe runbook",
    "plugins/odin-scp/skills/odin-scp/scripts/sync-installations.sh": "safe sync script",
    "plugins/odin-scp/README.md": "MCP tools: 27 `odin.*` tools",
    ...(overrides.publicVersionFiles as Record<string, string> | undefined)
  };
  const rest = { ...overrides };
  delete rest.publicVersionFiles;

  return verifyPack.runVerifyPack({
    pack: { files: requiredPaths, filename: "odin-sentinel-0.4.9.tgz" },
    packageJson,
    publicVersionFiles,
    packFileTextByPath: Object.fromEntries(requiredPaths.map((entry: { path: string }) => [entry.path, "safe packaged text"])),
    costPrivacyText: "Optional telemetry tools are user-invoked and not automatic.",
    ...rest
  });
}

describe("release sync audit helpers", () => {
  it("accepts synchronized public package artifacts without inspecting private skill copies", () => {
    expect(runWith().version).toBe("0.4.9");
  });

  it("keeps the required package file allowlist anchored to an independent fixture", () => {
    expect(verifyPack.requiredPackageFiles).toEqual(expectedRequiredPackageFiles);
  });

  it("rejects private planning and local evidence paths in package contents", () => {
    const files = [...requiredPaths.map((entry: { path: string }) => entry.path), "project/planning/slices/private.md", ".edge-agentic/local/evidence/log.txt"];
    expect(verifyPack.validatePackFileList(files)).toEqual([
      "Package includes private local paths: project/planning/slices/private.md, .edge-agentic/local/evidence/log.txt"
    ]);
  });

  it("rejects private local evidence markers inside packaged file contents", () => {
    expect(verifyPack.validatePackFileContents({
      "dist/src/protocol/service.js": "evidence_path: '.edge-agentic/local/evidence/session'",
      "protocol/bootstrap-skill.md": "raw evidence belongs under .odin/local/audit/session",
      "protocol/SCP.md": "internal package path project/planning/org/private"
    })).toEqual([
      "dist/src/protocol/service.js: local evidence path",
      "protocol/bootstrap-skill.md: local ODIN audit path",
      "protocol/SCP.md: private planning path"
    ]);
  });

  it("rejects stale versions in packaged protocol resources", () => {
    expect(verifyPack.validatePackagedProtocolVersions({
      "protocol/model-profiles.yaml": "version: 0.2.1\nprofiles: {}",
      "protocol/SCP.md": "Version: 0.3.0\nSCP_PUBLIC_VERSION: 0.4.9",
      "protocol/closeout.yaml": "version: 0.4.9\ncloseout: {}"
    }, "0.4.9")).toEqual([
      "protocol/model-profiles.yaml: protocol resource version 0.2.1 must match package version 0.4.9",
      "protocol/SCP.md: protocol resource version 0.3.0 must match package version 0.4.9"
    ]);
  });

  it("rejects repo-internal public protocol drift", () => {
    expect(() => runWith({ publicVersionFiles: { "protocol/bootstrap-skill.md": bootstrapText.replace("SCP_PUBLIC_VERSION: 0.4.9", "SCP_PUBLIC_VERSION: 0.4.8") } })).toThrow(/protocol\/bootstrap-skill\.md missing SCP_PUBLIC_VERSION: 0\.4\.9/);
  });

  it("rejects stale public version references", () => {
    expect(verifyPack.findStaleVersionReferences({ "docs/reference/distribution.md": "server 0.2.1" }, "0.4.9")).toEqual([
      "docs/reference/distribution.md: stale version reference 0.2.1"
    ]);
  });

  it("requires public package metadata for consumers", () => {
    expect(verifyPack.validatePackageMetadata({ version: "0.4.9", files: [] })).toContain("package.json missing repository.url");
  });

  it("rejects floating runtime dependencies", () => {
    expect(verifyPack.validatePackageMetadata({ ...packageJson, dependencies: { zod: "^4.4.3" } })).toContain("package.json runtime dependency zod must be pinned exactly");
  });

  it("rejects Claude plugin manifest and skill drift", () => {
    expect(() => runWith({
      publicVersionFiles: {
        "plugins/odin-scp/.claude-plugin/plugin.json": JSON.stringify({
          version: "0.4.5",
          mcpServers: { "odin-sentinel": { command: "npx", args: ["-y"] } }
        }),
        "plugins/odin-scp/skills/odin-scp/SKILL.md": "SCP_PUBLIC_VERSION: 0.4.5\n",
        "plugins/odin-scp/README.md": "MCP tools: 17 odin tools"
      }
    })).toThrow(/Claude plugin manifest version 0\.4\.5 must match package version 0\.4\.9/);
  });

  it("rejects Claude marketplace manifest drift", () => {
    expect(verifyPack.validateMarketplaceSync({
      marketplaceText: JSON.stringify({
        plugins: [
          {
            name: "sentinel-coordination-protocol",
            source: "./plugins/sentinel-coordination-protocol",
            version: "0.4.8"
          }
        ]
      }),
      currentVersion: "0.4.9"
    })).toEqual([
      "Claude marketplace manifest must advertise odin-scp",
      "Claude marketplace manifest must not advertise the legacy long-name plugin"
    ]);
  });

  it("audits public files while ignoring private local operator spaces", () => {
    const findings = publicSurface.auditPublicSurface({
      "README.md": "safe public text",
      "project/planning/private.md": "/Users/example/private should be ignored here",
      ".edge-agentic/local/evidence/log.txt": "/Users/example/private should be ignored here"
    });
    expect(findings).toEqual([]);
  });

  it("flags private markers in public files", () => {
    expect(publicSurface.auditPublicSurface({ "README.md": "open_protocols private marker" })).toEqual([
      "README.md: private project or account marker"
    ]);
  });
});
