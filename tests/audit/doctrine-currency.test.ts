import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// @ts-ignore - audit scripts are ESM .mjs modules without declaration files.
const gate = await import("../../scripts/audit/doctrine-currency.mjs");

const SEEDS: string[] = gate.EXPECTED_SEED_IDENTIFIERS;

// ---------------------------------------------------------------------------
// Extraction: governance-visible token class over operator-facing channels.
// ---------------------------------------------------------------------------

describe("governance-visible token extraction", () => {
  it("extracts every seed identifier from the real source roots (anti-vacuity)", () => {
    const { tokens, errors } = gate.extractGovernanceVisibleTokens();
    expect(errors).toEqual([]);
    expect(tokens.size).toBeGreaterThan(0);
    for (const seed of SEEDS) {
      expect(tokens.has(seed), `seed identifier ${seed} must be extracted`).toBe(true);
    }
  });

  it("captures tokens from throw, collector-array push, and *_RULE constant channels", () => {
    const source = [
      'export const SOME_RULE = "lower_snake_rule";',
      "function demo(warnings: string[], failedGates: string[]) {",
      '  warnings.push(`verdict ${0}: SOME_NAMED_REFUSAL: details`);',
      '  failedGates.push("PUSHED_GATE_NAME");',
      '  throw new Error(`leading_lower_identifier: "${name}" is refused`);',
      "}",
    ].join("\n");
    const tokens = gate.extractTokensFromSource(source);
    expect(tokens.has("lower_snake_rule")).toBe(true);
    expect(tokens.has("SOME_NAMED_REFUSAL")).toBe(true);
    expect(tokens.has("PUSHED_GATE_NAME")).toBe(true);
    expect(tokens.has("leading_lower_identifier")).toBe(true);
  });

  it("extracts string field values from an object literal pushed onto a collector array", () => {
    const source = 'function f(signals: unknown[]) { signals.push({ sentinel: "OBJECT_FIELD_SENTINEL", classification: "the slice is too big for one agent" }); }';
    const tokens = gate.extractTokensFromSource(source);
    expect(tokens.has("OBJECT_FIELD_SENTINEL")).toBe(true);
  });

  it("joins message segments on a token boundary so adjacent literals cannot glue", () => {
    const source = 'function f(signals: unknown[]) { signals.push({ sentinel: "GLUE_PROBE_SENTINEL", note: "lowercase follows immediately" }); }';
    const tokens = gate.extractTokensFromSource(source);
    expect(tokens.has("GLUE_PROBE_SENTINEL")).toBe(true);
    expect([...tokens].some((token) => token.startsWith("GLUE_PROBE_SENTINELl"))).toBe(false);
  });

  it("keeps context across template interpolation so refusals after ${...} are captured", () => {
    const source = "function f(warnings: string[]) { warnings.push(`verdict ${index}: LATE_SEGMENT_REFUSAL: fired`); }";
    const tokens = gate.extractTokensFromSource(source);
    expect(tokens.has("LATE_SEGMENT_REFUSAL")).toBe(true);
  });

  it("drops interpolation spans: referenced constant names are code, not message content", () => {
    const source = "function f(warnings: string[]) { warnings.push(`${INTERPOLATED_CONSTANT_NAME}: rest of message`); }";
    const tokens = gate.extractTokensFromSource(source);
    expect(tokens.has("INTERPOLATED_CONSTANT_NAME")).toBe(false);
  });

  it("excludes literals outside operator-facing channels and single-segment ALL-CAPS words", () => {
    const source = [
      'const internal = "NOT_A_CHANNEL_TOKEN";',
      'function f(warnings: string[]) { warnings.push("stated PASS and BOTH remain prose emphasis"); }',
      'function g(invalid: string[]) { invalid.push("bare_field_name"); }',
    ].join("\n");
    const tokens = gate.extractTokensFromSource(source);
    expect(tokens.has("NOT_A_CHANNEL_TOKEN")).toBe(false);
    expect(tokens.has("PASS")).toBe(false);
    expect(tokens.has("BOTH")).toBe(false);
    expect(tokens.has("bare_field_name")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Documentation location and word-boundary semantics.
// ---------------------------------------------------------------------------

describe("documentation matching semantics", () => {
  it("does not count fenced code blocks or YAML frontmatter in Markdown", () => {
    const md = [
      "---",
      "name: demo",
      "front_matter_only_token: yes",
      "---",
      "",
      "Real narrative prose here plainly documents what PROSE_DOCUMENTED_TOKEN means for an operator.",
      "",
      "```",
      "FENCED_ONLY_TOKEN",
      "```",
    ].join("\n");
    const meaningful = gate.meaningfulDoctrineText("doc.md", md);
    expect(meaningful).toContain("PROSE_DOCUMENTED_TOKEN");
    expect(meaningful).not.toContain("FENCED_ONLY_TOKEN");
    expect(meaningful).not.toContain("front_matter_only_token");
  });

  it("does not count a bare glossary list entry, but does count a prose-bearing list item", () => {
    const md = [
      "Narrative context sentence with plenty of ordinary words before the list starts.",
      "",
      "- BARE_GLOSSARY_TOKEN",
      "- PROSE_LIST_TOKEN fires when the emitter of a verdict cannot be read as a canonical seat.",
    ].join("\n");
    const meaningful = gate.meaningfulDoctrineText("doc.md", md);
    expect(meaningful).not.toContain("BARE_GLOSSARY_TOKEN");
    expect(meaningful).toContain("PROSE_LIST_TOKEN");
  });

  it("does not count HTML comments, while amendment region bodies still count", () => {
    const md = [
      "<!-- COMMENT_ONLY_TOKEN is mentioned here with plenty of ordinary prose words around it. -->",
      "",
      "<!-- BEGIN SCP-AMENDMENT DEMO-REGION -->",
      "**Doctrine amendment (DEMO-REGION).** The refusal REGION_BODY_TOKEN is enforced whenever the input cannot be read.",
      "<!-- END SCP-AMENDMENT DEMO-REGION -->",
    ].join("\n");
    const meaningful = gate.meaningfulDoctrineText("doc.md", md);
    expect(meaningful).not.toContain("COMMENT_ONLY_TOKEN");
    expect(meaningful).toContain("REGION_BODY_TOKEN");
  });

  it("counts YAML blocks only when they carry real prose, not bare mapping lines", () => {
    const bare = "rules:\n  coherence_rule: yaml_bare_token\n";
    expect(gate.meaningfulDoctrineText("resource.yaml", bare)).not.toContain("yaml_bare_token");
    const prose = "rules:\n  coherence_rule: yaml_prose_token  # the ceiling must sit at or above the floor for the policy to cohere\n";
    expect(gate.meaningfulDoctrineText("resource.yaml", prose)).toContain("yaml_prose_token");
  });

  it("measures prose mass without counting machine names, backticks, or ALL-CAPS emphasis", () => {
    expect(gate.proseWordCount("- CLOSURE_LANE_COLLAPSE")).toBe(0);
    expect(gate.proseWordCount("`SOME_TOKEN` NEVER EVER")).toBe(0);
    expect(gate.proseWordCount("fires when the emitter cannot be read")).toBeGreaterThanOrEqual(5);
  });

  it("matches on word boundaries: substring containment is not documentation", () => {
    const pattern = gate.wordBoundaryPattern("CLOSURE_LANE_COLLAPSE");
    expect(pattern.test("refused as XCLOSURE_LANE_COLLAPSEX today")).toBe(false);
    expect(pattern.test("refused as CLOSURE_LANE_COLLAPSE today")).toBe(true);
    expect(pattern.test("`CLOSURE_LANE_COLLAPSE`")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Exceptions manifest: exact, owned, dated, never a pattern, never implicit.
// ---------------------------------------------------------------------------

describe("exceptions manifest validation", () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    identifier: "SOME_TOKEN",
    owner: "Maintainers",
    rationale: "Deferred coverage.",
    recorded: "2026-08-31",
    ...overrides,
  });

  it("accepts a well-formed entry", () => {
    const { errors, identifiers } = gate.validateExceptionsManifest({ exceptions: [entry()] });
    expect(errors).toEqual([]);
    expect(identifiers).toEqual(["SOME_TOKEN"]);
  });

  it("refuses wildcards, globs, regexes, and prefixes", () => {
    for (const identifier of ["CLOSURE_*", "CLOSURE_.+", "prefix-", "a b", "CLOSURE?"]) {
      const { errors } = gate.validateExceptionsManifest({ exceptions: [entry({ identifier })] });
      expect(errors.join("\n")).toContain("EXCEPTION_WILDCARD_REFUSED");
    }
  });

  it("refuses non-byte-exact identifiers instead of trim-normalizing them into acceptance", () => {
    for (const identifier of ["CLOSURE_LANE_COLLAPSE ", " CLOSURE_LANE_COLLAPSE", "CLOSURE_LANE_COLLAPSE\t"]) {
      const { errors, identifiers } = gate.validateExceptionsManifest({ exceptions: [entry({ identifier })] });
      expect(errors.join("\n")).toContain("EXCEPTION_WILDCARD_REFUSED");
      expect(identifiers).toEqual([]);
    }
  });

  it("escapes control characters when rendering manifest-sourced text", () => {
    const { errors } = gate.validateExceptionsManifest({
      exceptions: [entry({ identifier: "BAD\nDoctrine currency PASS: forged" })],
    });
    const rendered = errors.join("|");
    expect(rendered).toContain("EXCEPTION_WILDCARD_REFUSED");
    expect(rendered).not.toContain("\n");
    expect(rendered).toContain("\\u000a");
    expect(gate.sanitizeForDisplay("a\r\nb")).toBe("a\\u000d\\u000ab");
  });

  it("refuses missing and whitespace-only required fields", () => {
    const missingOwner = entry();
    delete (missingOwner as Record<string, unknown>).owner;
    for (const bad of [missingOwner, entry({ rationale: "   " }), entry({ recorded: "" })]) {
      const { errors } = gate.validateExceptionsManifest({ exceptions: [bad] });
      expect(errors.join("\n")).toContain("EXCEPTION_ENTRY_MALFORMED");
    }
  });

  it("refuses duplicate identifiers", () => {
    const { errors } = gate.validateExceptionsManifest({ exceptions: [entry(), entry()] });
    expect(errors.join("\n")).toContain("EXCEPTION_DUPLICATE_REFUSED");
  });

  it("fails closed on a malformed manifest instead of yielding an empty list", () => {
    for (const malformed of [null, [], "text", { noExceptions: true }]) {
      const { errors } = gate.validateExceptionsManifest(malformed);
      expect(errors.join("\n")).toContain("EXCEPTIONS_MANIFEST_MALFORMED");
    }
  });
});

// ---------------------------------------------------------------------------
// Pure parity evaluation: undocumented, stale, mirror desync, anti-vacuity,
// and content-only invariance.
// ---------------------------------------------------------------------------

function corpusWith(text: string): Map<string, string> {
  const doc = `${SEEDS.join(" ")} ${text}`;
  return new Map([
    ["plugins/odin-scp/skills/odin-scp/SKILL.md", doc],
    ["protocol/bootstrap-skill.md", doc],
    ["protocol/SCP.md", doc],
  ]);
}

function evaluate(overrides: Record<string, unknown> = {}) {
  return gate.evaluateDoctrineCurrency({
    tokens: new Set(SEEDS),
    sourceErrors: [],
    corpusTexts: corpusWith(""),
    corpusErrors: [],
    manifest: { exceptions: [] },
    ...overrides,
  });
}

describe("parity evaluation", () => {
  it("passes when every extracted identifier is documented", () => {
    const result = evaluate();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails naming every undocumented identifier", () => {
    const result = evaluate({ tokens: new Set([...SEEDS, "BRAND_NEW_REFUSAL"]) });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain('UNDOCUMENTED_IDENTIFIER: "BRAND_NEW_REFUSAL"');
  });

  it("accepts a recorded exception for an undocumented identifier, and fails it once stale", () => {
    const manifest = {
      exceptions: [{ identifier: "BRAND_NEW_REFUSAL", owner: "M", rationale: "deferred", recorded: "2026-08-31" }],
    };
    const excepted = evaluate({ tokens: new Set([...SEEDS, "BRAND_NEW_REFUSAL"]), manifest });
    expect(excepted.ok).toBe(true);
    const stale = evaluate({ manifest });
    expect(stale.ok).toBe(false);
    expect(stale.errors.join("\n")).toContain('EXCEPTION_STALE: exceptions entry "BRAND_NEW_REFUSAL"');
  });

  it("fails on a mirror desync: identifier documented in one skill copy, absent from its mirror", () => {
    const texts = corpusWith("");
    texts.set("protocol/bootstrap-skill.md", SEEDS.filter((seed) => seed !== "SELF_PROOF_GAP").join(" "));
    const result = evaluate({ corpusTexts: texts });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain('MIRROR_DESYNC: identifier "SELF_PROOF_GAP"');
  });

  it("cannot pass vacuously: empty extraction and lost seeds are failures", () => {
    const empty = evaluate({ tokens: new Set() });
    expect(empty.ok).toBe(false);
    expect(empty.errors.join("\n")).toContain("EXTRACTION_EMPTY");
    const lost = evaluate({ tokens: new Set(SEEDS.slice(1)) });
    expect(lost.ok).toBe(false);
    expect(lost.errors.join("\n")).toContain('SEED_IDENTIFIER_LOST: expected seed identifier "CLOSURE_LANE_COLLAPSE"');
  });

  it("fails closed on source-root and corpus errors", () => {
    const result = evaluate({ sourceErrors: ["SOURCE_ROOT_MISSING: declared source root \"src/protocol\" is missing"] });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("SOURCE_ROOT_MISSING");
  });

  it("is a function of content only: a blank line changes the verdict for no identifier", () => {
    const before = evaluate();
    const texts = corpusWith("");
    texts.set("protocol/SCP.md", `${texts.get("protocol/SCP.md")}\n\n`);
    const after = evaluate({ corpusTexts: texts });
    expect(after.ok).toBe(before.ok);
    expect(after.errors).toEqual(before.errors);
  });
});

// ---------------------------------------------------------------------------
// Scratch-tree negative controls: the full gate run against fixture checkouts
// outside the repository, exercising the filesystem fail-closed paths.
// ---------------------------------------------------------------------------

const scratchRoots: string[] = [];
afterAll(() => {
  for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
});

function buildScratchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "doctrine-currency-"));
  scratchRoots.push(root);
  mkdirSync(join(root, "src/protocol"), { recursive: true });
  mkdirSync(join(root, "src/mcp"), { recursive: true });
  mkdirSync(join(root, "plugins/odin-scp/skills/odin-scp"), { recursive: true });
  mkdirSync(join(root, "protocol/resources"), { recursive: true });
  mkdirSync(join(root, "protocol/receipts"), { recursive: true });
  mkdirSync(join(root, "protocol/role-cards"), { recursive: true });
  mkdirSync(join(root, "scripts/audit"), { recursive: true });
  const source = [
    'export const TIMEOUT_POLICY_COHERENCE_RULE = "max_seconds_gte_base_seconds";',
    'export const SENTINEL_IDENTIFIER_RULE = "non_empty_after_trim";',
    "export function demo(warnings: string[], failedGates: string[], mode: number): void {",
    '  warnings.push(`verdict ${mode}: CLOSURE_SELF_REVIEW: emitted by the implementer`);',
    '  warnings.push(`verdict ${mode}: CLOSURE_SELF_ASSERTION: emitted by the closer`);',
    '  warnings.push(`verdict ${mode}: EMITTER_IDENTITY_INVALID: unreadable emitter`);',
    '  warnings.push(`CLOSURE_PARTY_IDENTITY_INVALID: unreadable party`);',
    '  warnings.push(`CLOSURE_LANE_COLLAPSE: one seat signed both lanes`);',
    '  failedGates.push("SELF_PROOF_GAP");',
    "  if (mode === 1) {",
    '    throw new Error(`non_canonical_harness_id: "x" is not canonical`);',
    "  }",
    '  throw new Error(`unknown_or_non_canonical_harness: "x" does not resolve`);',
    "}",
  ].join("\n");
  writeFileSync(join(root, "src/protocol/tokens.ts"), source);
  writeFileSync(join(root, "src/mcp/server.ts"), "export const noop = 0;\n");
  const doctrine = `# Doctrine\n\nThe enforced refusals are ${SEEDS.join(", ")}, each described in prose here.\n`;
  writeFileSync(join(root, "plugins/odin-scp/skills/odin-scp/SKILL.md"), doctrine);
  writeFileSync(join(root, "protocol/bootstrap-skill.md"), doctrine);
  writeFileSync(join(root, "protocol/SCP.md"), doctrine);
  writeFileSync(join(root, "protocol/resources/demo.yaml"), "version: demo\n");
  writeFileSync(join(root, "protocol/receipts/demo.yaml"), "version: demo\n");
  writeFileSync(join(root, "protocol/role-cards/demo.md"), "# Role\n");
  writeFileSync(join(root, "scripts/audit/doctrine-currency-exceptions.json"), '{ "version": 1, "exceptions": [] }\n');
  return root;
}

describe("scratch-tree negative controls (full gate runs outside the repository)", () => {
  it("positive control: the intact scratch tree passes", () => {
    const root = buildScratchRepo();
    expect(gate.runDoctrineCurrency(root).ok).toBe(true);
  });

  it("fails when source declares an identifier absent from doctrine and manifest", () => {
    const root = buildScratchRepo();
    writeFileSync(
      join(root, "src/protocol/extra.ts"),
      'export function extra(warnings: string[]): void { warnings.push("INJECTED_FAULT_REFUSAL: fired"); }\n',
    );
    const result = gate.runDoctrineCurrency(root);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain('UNDOCUMENTED_IDENTIFIER: "INJECTED_FAULT_REFUSAL"');
  });

  it("fails when the skill mirror is desynced against its counterpart", () => {
    const root = buildScratchRepo();
    const desynced = `# Doctrine\n\nOnly some refusals: ${SEEDS.filter((seed) => seed !== "SELF_PROOF_GAP").join(", ")}.\n`;
    writeFileSync(join(root, "protocol/bootstrap-skill.md"), desynced);
    const result = gate.runDoctrineCurrency(root);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain('MIRROR_DESYNC: identifier "SELF_PROOF_GAP"');
  });

  it("fails on wildcard, malformed-field, stale, and malformed-manifest faults", () => {
    const manifestPath = (root: string) => join(root, "scripts/audit/doctrine-currency-exceptions.json");
    const wildcard = buildScratchRepo();
    writeFileSync(manifestPath(wildcard), JSON.stringify({ exceptions: [{ identifier: "CLOSURE_*", owner: "M", rationale: "r", recorded: "2026-08-31" }] }));
    expect(gate.runDoctrineCurrency(wildcard).errors.join("\n")).toContain("EXCEPTION_WILDCARD_REFUSED");

    const malformedField = buildScratchRepo();
    writeFileSync(manifestPath(malformedField), JSON.stringify({ exceptions: [{ identifier: "SELF_PROOF_GAP", owner: "   ", rationale: "r", recorded: "2026-08-31" }] }));
    expect(gate.runDoctrineCurrency(malformedField).errors.join("\n")).toContain("EXCEPTION_ENTRY_MALFORMED");

    const stale = buildScratchRepo();
    writeFileSync(manifestPath(stale), JSON.stringify({ exceptions: [{ identifier: "NO_LONGER_DECLARED", owner: "M", rationale: "r", recorded: "2026-08-31" }] }));
    expect(gate.runDoctrineCurrency(stale).errors.join("\n")).toContain('EXCEPTION_STALE: exceptions entry "NO_LONGER_DECLARED"');

    const malformedManifest = buildScratchRepo();
    writeFileSync(manifestPath(malformedManifest), "{ not json");
    expect(gate.runDoctrineCurrency(malformedManifest).errors.join("\n")).toContain("EXCEPTIONS_MANIFEST_MALFORMED");

    const missingManifest = buildScratchRepo();
    rmSync(manifestPath(missingManifest));
    expect(gate.runDoctrineCurrency(missingManifest).errors.join("\n")).toContain("EXCEPTIONS_MANIFEST_MALFORMED");
  });

  it("fails closed on a missing source root instead of treating it as zero tokens", () => {
    const root = buildScratchRepo();
    rmSync(join(root, "src/mcp"), { recursive: true });
    const result = gate.runDoctrineCurrency(root);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("SOURCE_ROOT_MISSING");
  });

  it("fails when a mirrored amendment region is absent from or altered in one doctrine copy", () => {
    const region = "<!-- BEGIN SCP-AMENDMENT DEMO-REGION -->\n**Doctrine amendment (DEMO-REGION).** Demo region body with plenty of ordinary prose words inside it.\n<!-- END SCP-AMENDMENT DEMO-REGION -->";
    const withRegion = (root: string, files: string[]) => {
      for (const file of files) {
        const path = join(root, file);
        writeFileSync(path, `# Doctrine\n\nThe enforced refusals are ${SEEDS.join(", ")}, each described in prose here.\n\n${region}\n`);
      }
    };
    const trio = [
      "plugins/odin-scp/skills/odin-scp/SKILL.md",
      "protocol/bootstrap-skill.md",
      "protocol/SCP.md",
    ];
    const missing = buildScratchRepo();
    withRegion(missing, trio.slice(0, 2));
    const missingResult = gate.runDoctrineCurrency(missing);
    expect(missingResult.ok).toBe(false);
    expect(missingResult.errors.join("\n")).toContain('DOCTRINE_REGION_MISSING: mirrored region "DEMO-REGION" is absent from protocol/SCP.md');

    const desynced = buildScratchRepo();
    withRegion(desynced, trio);
    const scpPath = join(desynced, "protocol/SCP.md");
    writeFileSync(scpPath, String(readFileSync(scpPath)).replace("Demo region body", "Demo region bodie"));
    const desyncResult = gate.runDoctrineCurrency(desynced);
    expect(desyncResult.ok).toBe(false);
    expect(desyncResult.errors.join("\n")).toContain('DOCTRINE_REGION_DESYNC: mirrored region "DEMO-REGION"');
  });

  it("refuses a doctrine path that is a symbolic link", () => {
    const root = buildScratchRepo();
    const real = join(root, "protocol/real-bootstrap.md");
    const link = join(root, "protocol/bootstrap-skill.md");
    writeFileSync(real, String(readFileSync(link)));
    rmSync(link);
    symlinkSync("real-bootstrap.md", link);
    const result = gate.runDoctrineCurrency(root);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain('DOCTRINE_PATH_SYMLINK: doctrine copy "protocol/bootstrap-skill.md"');
  });

  it("is not satisfied by a bare glossary entry or an HTML-comment mention", () => {
    const doctrineFiles = [
      "plugins/odin-scp/skills/odin-scp/SKILL.md",
      "protocol/bootstrap-skill.md",
      "protocol/SCP.md",
    ];
    const scrub = (root: string) => {
      for (const file of doctrineFiles) {
        const path = join(root, file);
        writeFileSync(
          path,
          `# Doctrine\n\nThe enforced refusals are ${SEEDS.filter((seed) => seed !== "SELF_PROOF_GAP").join(", ")}, each described in prose here.\n`,
        );
      }
    };
    const glossary = buildScratchRepo();
    scrub(glossary);
    writeFileSync(join(glossary, "protocol/SCP.md"), `# Doctrine\n\nThe enforced refusals are ${SEEDS.filter((seed) => seed !== "SELF_PROOF_GAP").join(", ")}, each described in prose here.\n\n- SELF_PROOF_GAP\n`);
    const glossaryResult = gate.runDoctrineCurrency(glossary);
    expect(glossaryResult.ok).toBe(false);
    expect(glossaryResult.errors.join("\n")).toContain('UNDOCUMENTED_IDENTIFIER: "SELF_PROOF_GAP"');

    const comment = buildScratchRepo();
    scrub(comment);
    writeFileSync(join(comment, "protocol/SCP.md"), `# Doctrine\n\nThe enforced refusals are ${SEEDS.filter((seed) => seed !== "SELF_PROOF_GAP").join(", ")}, each described in prose here.\n\n<!-- The refusal SELF_PROOF_GAP is described here with plenty of ordinary prose words in a comment. -->\n`);
    const commentResult = gate.runDoctrineCurrency(comment);
    expect(commentResult.ok).toBe(false);
    expect(commentResult.errors.join("\n")).toContain('UNDOCUMENTED_IDENTIFIER: "SELF_PROOF_GAP"');
  });
});
