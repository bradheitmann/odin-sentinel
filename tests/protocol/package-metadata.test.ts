import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createServer } from "../../src/mcp/server.js";

// @ts-ignore - audit script is an ESM .mjs module without declaration files.
const verifyPack = await import("../../scripts/audit/verify-pack.mjs");

async function liveSurfaceCounts() {
  const server = createServer();
  const client = new Client({ name: "pkg-metadata-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    const resources = await client.listResources();
    return { tools: tools.tools.length, resources: resources.resources.length };
  } finally {
    await client.close();
    await server.close();
  }
}

function repoText(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function firstNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

describe("public package metadata matches the live MCP surface", () => {
  it("every public tool/resource-count surface equals the live registration", async () => {
    const { tools, resources } = await liveSurfaceCounts();
    expect(tools).toBeGreaterThan(0);
    expect(resources).toBeGreaterThan(0);

    const pkg = JSON.parse(repoText("package.json")) as { description: string };
    expect(firstNumber(pkg.description, /(\d+)\s+tools/)).toBe(tools);
    expect(firstNumber(pkg.description, /(\d+)\s+resources/)).toBe(resources);

    const readme = repoText("README.md");
    expect(firstNumber(readme, /(\d+)\s+tools,/)).toBe(tools);
    expect(firstNumber(readme, /Provided MCP Tools \((\d+)\)/)).toBe(tools);
    expect(firstNumber(readme, /Provided MCP Resources \((\d+)\)/)).toBe(resources);
    // The enumerated tool list must be complete, not just the headline count.
    expect((readme.match(/^- `odin\.[a-z_]+`/gm) ?? []).length).toBe(tools);

    const audit = repoText("docs/reference/public-surface-audit.md");
    expect(firstNumber(audit, /MCP tools:\s*(\d+)/)).toBe(tools);
    expect(firstNumber(audit, /MCP resources:\s*(\d+)/)).toBe(resources);

    const pluginReadme = repoText("plugins/odin-scp/README.md");
    expect(firstNumber(pluginReadme, /(\d+)\s+`?odin\.\*`?\s+tools/)).toBe(tools);
  });

  it("verify-pack cross-checks the plugin README against package.json instead of a hard-coded count", () => {
    expect(verifyPack.extractToolCount("27 `odin.*` tools")).toBe(27);
    expect(verifyPack.extractToolCount("Portable ...: 27 tools, 13 resources")).toBe(27);
    expect(verifyPack.extractToolCount("no count here")).toBeNull();

    // The audit must no longer hard-code the obsolete count anywhere in its source.
    expect(/23\s+`?odin\.\*`?\s+tools/.test(repoText("scripts/audit/verify-pack.mjs"))).toBe(false);

    const validManifest = JSON.stringify({
      name: "odin-scp",
      version: "0.4.9",
      mcpServers: { "odin-sentinel": { command: "pnpm", args: ["dlx", "--package", "@bradheitmann/odin-sentinel@0.4.9", "odin-sentinel-mcp"] } }
    });
    const skill = "SCP_PUBLIC_VERSION: 0.4.9\nMIN_COMPATIBLE_CHILD_MCP: 0.4.5\n";

    const mismatch = verifyPack.validatePluginSync({
      pluginManifestText: validManifest,
      pluginSkillText: skill,
      pluginReadmeText: "MCP tools: 99 `odin.*` tools",
      currentVersion: "0.4.9",
      expectedToolCount: 27
    });
    expect(mismatch.some((e: string) => /advertises 99 odin\.\* tools but package\.json describes 27/.test(e))).toBe(true);

    const matched = verifyPack.validatePluginSync({
      pluginManifestText: validManifest,
      pluginSkillText: skill,
      pluginReadmeText: "MCP tools: 27 `odin.*` tools",
      currentVersion: "0.4.9",
      expectedToolCount: 27
    });
    expect(matched.length).toBe(0);

    const missingCount = verifyPack.validatePluginSync({
      pluginManifestText: validManifest,
      pluginSkillText: skill,
      pluginReadmeText: "no tool count advertised",
      currentVersion: "0.4.9",
      expectedToolCount: 27
    });
    expect(missingCount.some((e: string) => /must advertise its odin\.\* tool count/.test(e))).toBe(true);
  });
});
