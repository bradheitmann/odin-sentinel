import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type PackageMetadata = {
  name?: unknown;
  version?: unknown;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

function packageJsonCandidates(): string[] {
  return [
    join(__dirname, "..", "..", "package.json"),
    join(__dirname, "..", "..", "..", "package.json")
  ];
}

function readPackageVersion(): string {
  for (const path of packageJsonCandidates()) {
    if (!existsSync(path)) continue;

    const metadata = JSON.parse(readFileSync(path, "utf8")) as PackageMetadata;
    if (
      typeof metadata.name === "string" &&
      /(^|\/)odin-sentinel$/.test(metadata.name) &&
      typeof metadata.version === "string" &&
      metadata.version.trim() !== ""
    ) {
      return metadata.version;
    }
  }

  throw new Error("Could not locate odin-sentinel package version");
}

export const VERSION = readPackageVersion();
export const PROTOCOL_SCHEMA_VERSION = "0.4.8";
export const MINIMUM_COMPATIBLE_MCP_VERSION = "0.4.5";
export const PUBLIC_LATEST_VERSION = "0.4.8";
