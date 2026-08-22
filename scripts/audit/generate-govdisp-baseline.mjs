import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export const GOVDISP_BASELINE_SCHEMA = "govdisp.baseline-manifest.v1";
export const GOVDISP_BASELINE_ROOTS = ["protocol", "src/protocol", "src/mcp"];
export const GOVDISP_BASELINE_FIXTURE = "tests/fixtures/govdisp/baseline-manifest.json";

function toPosix(filePath) {
  return filePath.split("\\").join("/");
}

export function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walkFiles(path) : [path];
    });
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function generateBaselineManifest(repoRoot = ".") {
  const files = GOVDISP_BASELINE_ROOTS.flatMap((root) => walkFiles(join(repoRoot, root)))
    .map((absPath) => toPosix(relative(repoRoot, absPath)))
    .sort((a, b) => a.localeCompare(b));

  const entries = files.map((filePath) => {
    const absPath = join(repoRoot, filePath);
    const bytes = readFileSync(absPath);
    return {
      path: filePath,
      bytes: bytes.byteLength,
      sha256: sha256Bytes(bytes)
    };
  });

  return {
    schema: GOVDISP_BASELINE_SCHEMA,
    roots: [...GOVDISP_BASELINE_ROOTS],
    file_count: entries.length,
    files: entries
  };
}

export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function writeBaselineManifest(repoRoot = ".", outPath = join(repoRoot, GOVDISP_BASELINE_FIXTURE)) {
  const text = serializeManifest(generateBaselineManifest(repoRoot));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text, "utf8");
  return { outPath, text };
}

export function main() {
  const result = writeBaselineManifest();
  console.log(`Wrote ${result.outPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
