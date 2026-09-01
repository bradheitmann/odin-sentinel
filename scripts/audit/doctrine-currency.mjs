/**
 * Doctrine-currency parity gate (STORY-GOVEDGE-S6, HALF B).
 *
 * SEMANTIC parity, never co-modification: this gate's verdict is a function of
 * the CONTENT of the declared source roots and the CONTENT of the published
 * doctrine corpus, and of nothing else. It reads no modification time, no
 * commit range, and no file digest, so touching a file changes nothing and a
 * blank line changes the verdict for no identifier.
 *
 * WHAT IS CHECKED (direction is ONE-WAY):
 *   Every governance-visible named identifier that source declares must be
 *   documented somewhere in the published doctrine corpus, on a word boundary,
 *   in a location that means something — or recorded in the reviewed
 *   exceptions manifest. Doctrine that says MORE than source names is never a
 *   failure.
 *
 * SOURCE ROOTS (a): src/protocol and src/mcp. A missing or unreadable root is
 * a gate FAILURE, never an empty token set.
 *
 * GOVERNANCE-VISIBLE (b): an identifier inside a string literal that reaches
 * an operator-facing channel — the message of a `throw new Error(...)`, an
 * entry pushed onto a collector array (`<name>.push(...)`), or the value of an
 * exported `*_RULE` / `*_MESSAGE` constant — with the shape of a machine
 * name: SCREAMING_SNAKE with two or more segments anywhere in the message, or
 * lower_snake occupying the leading `identifier:` position of the message (or
 * the whole value of a `*_RULE` constant). Template `${...}` interpolation
 * spans are dropped before scanning: referenced constant NAMES are code, not
 * message content.
 *
 * DOCTRINE CORPUS (c): the three doctrine copies (the skill, its byte mirror,
 * and the protocol summary) plus every file under protocol/resources,
 * protocol/receipts, and protocol/role-cards. Documentation is checked where
 * it MEANS something. For Markdown files, YAML frontmatter, fenced code
 * blocks, and HTML comments are stripped before matching: a reader of the
 * rendered doctrine never sees a comment, and a code fence or frontmatter key
 * is not narration. (The amendment region MARKERS are HTML comments and are
 * deliberately invisible to this check; the region BODY between them is
 * ordinary prose and is what counts.) Then, for Markdown and YAML alike, the
 * text is split into blocks (paragraphs, list items, mapping runs) and only
 * blocks carrying at least PROSE_WORD_MINIMUM ordinary prose words are
 * eligible: a bare glossary entry, token list, or identifier-only line has no
 * prose mass and does NOT count as documentation, while any block that
 * actually explains the identifier passes on its own words — no fixed
 * surrounding phrase is required or checked. The two whole-file skill mirrors
 * are additionally checked per identifier: a documented identifier present in
 * one mirror and absent from the other is a MIRROR_DESYNC failure. Two
 * structural rules run on the RAW trio texts: every `SCP-AMENDMENT` mirrored
 * region must be PRESENT in all three doctrine copies with a byte-identical
 * body (DOCTRINE_REGION_MISSING / DOCTRINE_REGION_DESYNC — deleting a region
 * from the summary copy fails the GATE, not only the test suite), and no
 * doctrine path may be a symbolic link (DOCTRINE_PATH_SYMLINK — a symlinked
 * doctrine file can pass content checks while vanishing from the packed
 * tarball).
 *
 * DELIBERATELY EXCLUDED token classes (d), with reasons. The boundary is the
 * CHANNEL, not a claim about reach: this gate scans exactly three delivery
 * channels — thrown Error messages, collector-ARRAY `.push(...)` literals,
 * and exported `*_RULE` / `*_MESSAGE` constant values. Identifiers that reach
 * operators through OTHER channels are known to exist and are out of this
 * gate's declared scope, not asserted to be invisible:
 *   - Identifiers delivered via `Set.add(...)` classification sets or returned
 *     decision/verdict strings (known examples: NOT_INSTALLED_OR_UNPROVEN,
 *     MODEL_REASONING_ONLY, ESCALATE_OPERATOR). These DO reach operators;
 *     covering their channels is a declared follow-on extension, and widening
 *     must never come at the cost of the seed-pinned core below. String field
 *     values inside an object literal PUSHED onto a collector array ARE in
 *     scope — they ride the declared push channel (e.g. OVERSIZED_SLICE,
 *     QA_WINDOW_TOO_SMALL, SPEC_DEFECT, SURFACE_TO_PM in sentinel signals).
 *   - Single-segment ALL-CAPS words (PASS, FROZEN, BOTH): prose emphasis and
 *     bare states share this shape; multi-segment machine names do not.
 *   - Internal enum members, switch discriminants, TypeScript type names, and
 *     object/schema field names, considered as NAMES in code rather than as
 *     message content: implementation vocabulary, not operator contract.
 *   - Everything under tests/**, scripts/**, and src/harness-pacing/seeds/**:
 *     not part of the enforced protocol surface the doctrine narrates.
 *   - Bare lower_snake literals without the leading `identifier:` colon
 *     (e.g. field names pushed onto `invalid`): they name fields, not rules.
 *
 * ANTI-VACUITY: the extracted set is asserted against EXPECTED_SEED_IDENTIFIERS
 * below. An empty extraction, or an extraction that loses any seed, FAILS.
 *
 * ESCAPE HATCH: scripts/audit/doctrine-currency-exceptions.json. Exact
 * identifiers only (wildcards, globs, regexes, prefixes refused); each entry
 * carries identifier + owner + rationale + recorded date, all non-empty after
 * trim; duplicates refused; an entry naming an identifier source no longer
 * declares is STALE and fails; a missing, unreadable, or malformed manifest
 * FAILS rather than yielding an empty list. There is NO environment variable,
 * flag, or comment marker that disables this gate or skips an identifier;
 * --repo-root only points the ENTIRE gate at another checkout (test seam for
 * negative controls) — every rule applies there unchanged.
 *
 * OFFLINE: this gate reads only files inside the repository. No network, no
 * registry, no credential, no subprocess.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, "..", "..");

export const SOURCE_ROOTS = ["src/protocol", "src/mcp"];
export const DOCTRINE_TRIO = [
  "plugins/odin-scp/skills/odin-scp/SKILL.md",
  "protocol/bootstrap-skill.md",
  "protocol/SCP.md"
];
export const DOCTRINE_MIRROR_PAIR = [
  "plugins/odin-scp/skills/odin-scp/SKILL.md",
  "protocol/bootstrap-skill.md"
];
export const DOCTRINE_RESOURCE_DIRS = [
  "protocol/resources",
  "protocol/receipts",
  "protocol/role-cards"
];
export const DEFAULT_EXCEPTIONS_MANIFEST = "scripts/audit/doctrine-currency-exceptions.json";

/** Anti-vacuity pin: extraction must contain every seed or the gate FAILS. */
export const EXPECTED_SEED_IDENTIFIERS = [
  "CLOSURE_LANE_COLLAPSE",
  "CLOSURE_SELF_REVIEW",
  "CLOSURE_SELF_ASSERTION",
  "CLOSURE_PARTY_IDENTITY_INVALID",
  "EMITTER_IDENTITY_INVALID",
  "non_canonical_harness_id",
  "unknown_or_non_canonical_harness",
  "max_seconds_gte_base_seconds",
  "non_empty_after_trim",
  "SELF_PROOF_GAP"
];

const SCREAMING_SNAKE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const LEADING_LOWER_SNAKE = /^\s*([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\s*:/;
const EXACT_IDENTIFIER = /^[A-Za-z0-9_]+$/;
export const REQUIRED_EXCEPTION_FIELDS = ["identifier", "owner", "rationale", "recorded"];

function walkFiles(dir) {
  return readdirSync(dir)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walkFiles(path) : [path];
    });
}

/**
 * Extract operator-facing message regions from TypeScript source. A region
 * opens when code enters `throw new Error(`, `<name>.push(`, or an exported
 * `*_RULE` / `*_MESSAGE` const assignment, and closes at the matching paren
 * (or the statement's semicolon for const assignments). Every string-literal
 * segment lexed while a region is open belongs to that region's message;
 * `${...}` interpolation spans are code, not message content, and are dropped.
 */
export function extractMessageRegions(text) {
  const regions = [];
  let code = "";
  let i = 0;
  const n = text.length;
  let state = "code";
  const templateBraceDepths = [];
  let cur = "";
  let parenDepth = 0;
  const contextStack = [];
  let ruleConstActive = false;
  let activeRegion = null;

  const openRegion = (context) => {
    activeRegion = { context, segments: [] };
    regions.push(activeRegion);
  };
  const pushSegment = (value) => {
    if (ruleConstActive || contextStack.length > 0) activeRegion?.segments.push(value);
  };

  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && next === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; cur = ""; i += 1; continue; }
      if (c === '"') { state = "dq"; cur = ""; i += 1; continue; }
      if (c === "`") { state = "tpl"; templateBraceDepths.push(0); cur = ""; i += 1; continue; }
      if (c === "{" && templateBraceDepths.length > 0) {
        templateBraceDepths[templateBraceDepths.length - 1] += 1;
        code += c; i += 1; continue;
      }
      if (c === "}" && templateBraceDepths.length > 0) {
        if (templateBraceDepths[templateBraceDepths.length - 1] === 0) { state = "tpl"; cur = ""; i += 1; continue; }
        templateBraceDepths[templateBraceDepths.length - 1] -= 1;
        code += c; i += 1; continue;
      }
      if (c === "(") {
        const tail = code.replace(/\s+$/, "").slice(-80);
        if (/throw\s+new\s+Error$/.test(tail)) {
          contextStack.push({ depth: parenDepth });
          openRegion("throw");
        } else {
          const push = /([A-Za-z_$][A-Za-z0-9_$]*)\.push$/.exec(tail);
          if (push) {
            contextStack.push({ depth: parenDepth });
            openRegion(`push:${push[1]}`);
          }
        }
        parenDepth += 1; code += c; i += 1; continue;
      }
      if (c === ")") {
        parenDepth -= 1;
        if (contextStack.length > 0 && contextStack[contextStack.length - 1].depth === parenDepth) contextStack.pop();
        code += c; i += 1; continue;
      }
      if (c === "=") {
        const tail = code.replace(/\s+$/, "").slice(-120);
        if (/export\s+const\s+[A-Za-z0-9_]*_(?:RULE|MESSAGE)$/.test(tail)) {
          ruleConstActive = true;
          openRegion("ruleconst");
        }
        code += c; i += 1; continue;
      }
      if (c === ";") { ruleConstActive = false; code += c; i += 1; continue; }
      code += c; i += 1; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; code += c; } i += 1; continue; }
    if (state === "block") { if (c === "*" && next === "/") { state = "code"; i += 2; } else i += 1; continue; }
    if (state === "sq" || state === "dq") {
      const quote = state === "sq" ? "'" : '"';
      if (c === "\\") { cur += text[i + 1] ?? ""; i += 2; continue; }
      if (c === quote) { pushSegment(cur); state = "code"; i += 1; continue; }
      cur += c; i += 1; continue;
    }
    // state === "tpl"
    if (c === "\\") { cur += text[i + 1] ?? ""; i += 2; continue; }
    if (c === "$" && next === "{") { pushSegment(cur); cur = ""; state = "code"; i += 2; continue; }
    if (c === "`") { pushSegment(cur); templateBraceDepths.pop(); state = "code"; i += 1; continue; }
    cur += c; i += 1;
  }
  return regions;
}

/** Governance-visible tokens in one source file's text. */
export function extractTokensFromSource(text) {
  const tokens = new Set();
  for (const region of extractMessageRegions(text)) {
    if (region.segments.length === 0) continue;
    // Segments are joined with a newline ("\n", written escaped here), never
    // the empty string: an empty-string join glues one literal's trailing
    // identifier to the next literal's first character (an object-literal push
    // like `signals.push({ sentinel: "OVERSIZED_SLICE", classification:
    // "the ..." })` produced "OVERSIZED_SLICEthe"), destroying the word
    // boundary and silently narrowing the governed set by field order.
    const message = region.segments.join("\n");
    const ruleValue = region.segments.length === 1 ? region.segments[0] : null;
    if (region.context === "ruleconst" && ruleValue !== null && /^[a-z0-9_]+$/.test(ruleValue) && ruleValue.includes("_")) {
      tokens.add(ruleValue);
    }
    for (const match of message.matchAll(SCREAMING_SNAKE)) tokens.add(match[0]);
    const leading = LEADING_LOWER_SNAKE.exec(region.segments[0]);
    if (leading) tokens.add(leading[1]);
  }
  return tokens;
}

/** Full extraction over the declared source roots. Fails closed on a missing root. */
export function extractGovernanceVisibleTokens(repoRoot = PACKAGE_ROOT) {
  const errors = [];
  const tokens = new Set();
  for (const root of SOURCE_ROOTS) {
    const dir = join(repoRoot, root);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      errors.push(`SOURCE_ROOT_MISSING: declared source root "${root}" is missing or unreadable — a missing root is a gate failure, never zero tokens`);
      continue;
    }
    for (const file of walkFiles(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".d.ts")) continue;
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        errors.push(`SOURCE_ROOT_MISSING: source file "${file}" is unreadable`);
        continue;
      }
      for (const token of extractTokensFromSource(text)) tokens.add(token);
    }
  }
  return { tokens, errors };
}

/**
 * Minimum ordinary prose words a block must carry for an identifier occurrence
 * inside it to count as documentation. A bare glossary entry or token list has
 * zero prose mass; a sentence that actually explains an identifier clears this
 * floor on its own words. The measure is mechanical and phrase-free: no fixed
 * wording is required, only that the identifier is embedded in real narration.
 */
export const PROSE_WORD_MINIMUM = 5;

const MACHINE_NAME_ANYCASE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g;

/** Ordinary prose words in a block: lowercase-bearing words of two or more
 * letters, after backticks are dropped and machine-shaped names removed. */
export function proseWordCount(block) {
  const withoutTicks = block.replace(/`/g, " ");
  const withoutMachineNames = withoutTicks.replace(MACHINE_NAME_ANYCASE, " ");
  const words = withoutMachineNames.match(/\b[A-Za-z]{2,}\b/g) ?? [];
  return words.filter((word) => /[a-z]/.test(word)).length;
}

/** Split text into blocks: blank lines end a block, and every list-item or
 * top-level YAML sequence marker starts one, so a glossary line is judged on
 * its own prose rather than riding a neighbouring paragraph's. */
export function splitBlocks(text) {
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length > 0) blocks.push(current.join("\n"));
    current = [];
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (/^\s*(?:[-*+]|\d+\.)\s/.test(line)) flush();
    current.push(line);
  }
  flush();
  return blocks;
}

/**
 * Reduce a doctrine file to the text where documentation MEANS something.
 * Markdown: YAML frontmatter, fenced code blocks, and HTML comments are
 * removed (readers of rendered doctrine never see them; the amendment region
 * markers are comments and intentionally vanish here while the region body
 * remains). Then, for Markdown and YAML alike, only blocks carrying at least
 * PROSE_WORD_MINIMUM ordinary prose words survive — a bare list entry, token
 * list, or identifier-only line is not documentation.
 */
export function meaningfulDoctrineText(filePath, text) {
  let out = text;
  if (filePath.endsWith(".md")) {
    if (out.startsWith("---\n")) {
      const end = out.indexOf("\n---", 4);
      if (end !== -1) out = out.slice(end + 4);
    }
    out = out.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, "");
    out = out.replace(/<!--[\s\S]*?-->/g, " ");
  }
  return splitBlocks(out)
    .filter((block) => proseWordCount(block) >= PROSE_WORD_MINIMUM)
    .join("\n\n");
}

export function wordBoundaryPattern(token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
}

const AMENDMENT_REGION_PATTERN = /<!-- BEGIN SCP-AMENDMENT ([A-Z0-9-]+) -->([\s\S]*?)<!-- END SCP-AMENDMENT \1 -->/g;

/** All SCP-AMENDMENT mirrored regions in a RAW doctrine text: id -> body. */
export function extractAmendmentRegions(text) {
  const regions = new Map();
  const duplicates = [];
  for (const match of text.matchAll(AMENDMENT_REGION_PATTERN)) {
    if (regions.has(match[1])) duplicates.push(match[1]);
    regions.set(match[1], match[2]);
  }
  return { regions, duplicates };
}

/** Load the published doctrine corpus. Fails closed on missing members and
 * on symlinked paths (a symlinked doctrine file passes content checks while
 * silently vanishing from the packed tarball). Returns the RAW trio texts
 * alongside the meaning-filtered texts so the structural region rule can run
 * on unstripped content. */
export function loadDoctrineCorpus(repoRoot = PACKAGE_ROOT) {
  const errors = [];
  const files = [];
  const isSymlink = (path) => {
    try {
      return lstatSync(path).isSymbolicLink();
    } catch {
      return false;
    }
  };
  for (const file of DOCTRINE_TRIO) {
    const path = join(repoRoot, file);
    if (!existsSync(path)) {
      errors.push(`DOCTRINE_CORPUS_MISSING: doctrine copy "${file}" is missing — the corpus cannot shrink silently`);
      continue;
    }
    if (isSymlink(path)) {
      errors.push(`DOCTRINE_PATH_SYMLINK: doctrine copy "${file}" is a symbolic link — a symlinked doctrine file is refused because it can vanish from the packed release while passing content checks`);
      continue;
    }
    files.push(file);
  }
  for (const dir of DOCTRINE_RESOURCE_DIRS) {
    const path = join(repoRoot, dir);
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      errors.push(`DOCTRINE_CORPUS_MISSING: doctrine directory "${dir}" is missing — the corpus cannot shrink silently`);
      continue;
    }
    for (const abs of walkFiles(path)) {
      const file = abs.slice(repoRoot.length + 1).split("\\").join("/");
      if (isSymlink(abs)) {
        errors.push(`DOCTRINE_PATH_SYMLINK: doctrine file "${file}" is a symbolic link — a symlinked doctrine file is refused because it can vanish from the packed release while passing content checks`);
        continue;
      }
      files.push(file);
    }
  }
  const texts = new Map();
  const rawTrio = new Map();
  for (const file of files) {
    try {
      const raw = readFileSync(join(repoRoot, file), "utf8");
      if (DOCTRINE_TRIO.includes(file)) rawTrio.set(file, raw);
      texts.set(file, meaningfulDoctrineText(file, raw));
    } catch {
      errors.push(`DOCTRINE_CORPUS_MISSING: doctrine file "${file}" is unreadable`);
    }
  }
  return { texts, rawTrio, errors };
}

/**
 * Render manifest-sourced text safely: control characters are escaped to their
 * visible \uXXXX form so attacker-controlled manifest bytes can never start a
 * physical output line (e.g. a forged "Doctrine currency PASS" line reached
 * via an embedded newline). Applied to EVERY interpolation of manifest text.
 */
export function sanitizeForDisplay(value) {
  return String(value).replace(
    /[\u0000-\u001f\u007f-\u009f]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

/**
 * Validate the exceptions manifest: BYTE-EXACT identifiers, four fields, no
 * patterns. The identifier is tested exactly as it appears in the manifest —
 * never trimmed or otherwise normalized first. A trailing space is a refusal,
 * not a fold: trim-then-match is the fold-and-accept class this epic exists
 * to kill.
 */
export function validateExceptionsManifest(manifest) {
  const errors = [];
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { errors: ["EXCEPTIONS_MANIFEST_MALFORMED: manifest must be a JSON object"], identifiers: [] };
  }
  if (!Array.isArray(manifest.exceptions)) {
    return { errors: ["EXCEPTIONS_MANIFEST_MALFORMED: manifest must declare an `exceptions` array"], identifiers: [] };
  }
  const seen = new Set();
  const identifiers = [];
  for (const [index, entry] of manifest.exceptions.entries()) {
    const label = `exceptions[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`EXCEPTIONS_MANIFEST_MALFORMED: ${label} must be an object`);
      continue;
    }
    const missing = REQUIRED_EXCEPTION_FIELDS.filter(
      (field) => typeof entry[field] !== "string" || entry[field].trim() === ""
    );
    if (missing.length > 0) {
      errors.push(`EXCEPTION_ENTRY_MALFORMED: ${label} is missing or carries a whitespace-only required field: ${missing.join(", ")}`);
      continue;
    }
    // BYTE-EXACT: the raw manifest value is tested, never a trimmed copy. Any
    // whitespace, control character, or pattern form is a named refusal.
    const identifier = entry.identifier;
    if (!EXACT_IDENTIFIER.test(identifier)) {
      errors.push(`EXCEPTION_WILDCARD_REFUSED: ${label} identifier "${sanitizeForDisplay(identifier)}" is not a byte-exact identifier — wildcards, globs, regular expressions, prefixes, leading/trailing whitespace, control characters, and every other non-exact form are refused, never trim-normalized into acceptance`);
      continue;
    }
    if (seen.has(identifier)) {
      errors.push(`EXCEPTION_DUPLICATE_REFUSED: ${label} duplicates identifier "${identifier}"`);
      continue;
    }
    seen.add(identifier);
    identifiers.push(identifier);
  }
  return { errors, identifiers };
}

/**
 * Full gate evaluation over already-loaded inputs. Pure and content-only.
 */
export function evaluateDoctrineCurrency({ tokens, sourceErrors, corpusTexts, corpusErrors, manifest, trioRawTexts }) {
  const lines = [`Doctrine currency gate: ${SOURCE_ROOTS.join(", ")} -> published doctrine corpus`];
  const errors = [...sourceErrors, ...corpusErrors];

  // Structural mirrored-region rule over the RAW trio: every SCP-AMENDMENT
  // region must be present in all three doctrine copies with a byte-identical
  // body. Deleting a region from any one copy — including the summary copy —
  // fails the GATE itself, not only the mirror test suite.
  if (trioRawTexts instanceof Map && trioRawTexts.size > 0) {
    const perFile = DOCTRINE_TRIO.map((file) => ({ file, ...extractAmendmentRegions(trioRawTexts.get(file) ?? "") }));
    for (const { file, duplicates } of perFile) {
      for (const id of duplicates) {
        errors.push(`DOCTRINE_REGION_DUPLICATE: mirrored region "${id}" appears more than once in ${file}`);
      }
    }
    const allIds = new Set(perFile.flatMap((entry) => [...entry.regions.keys()]));
    for (const id of [...allIds].sort()) {
      const bodies = perFile.map((entry) => entry.regions.get(id));
      for (let index = 0; index < perFile.length; index += 1) {
        if (bodies[index] === undefined) {
          errors.push(`DOCTRINE_REGION_MISSING: mirrored region "${id}" is absent from ${perFile[index].file} — every SCP-AMENDMENT region must be present in all three doctrine copies`);
        }
      }
      const present = bodies.filter((body) => body !== undefined);
      if (present.length > 1 && new Set(present).size > 1) {
        errors.push(`DOCTRINE_REGION_DESYNC: mirrored region "${id}" differs across the doctrine copies — region bodies must be byte-identical`);
      }
    }
  }

  const { errors: manifestErrors, identifiers: excepted } = validateExceptionsManifest(manifest);
  errors.push(...manifestErrors);

  if (tokens.size === 0) {
    errors.push("EXTRACTION_EMPTY: extraction yielded zero governance-visible identifiers — an empty extraction is a gate failure, not a pass");
  }
  for (const seed of EXPECTED_SEED_IDENTIFIERS) {
    if (!tokens.has(seed)) {
      errors.push(`SEED_IDENTIFIER_LOST: expected seed identifier "${seed}" was not extracted — the extractor may not be narrowed to make doctrine pass`);
    }
  }

  if (errors.length > 0) {
    lines.push(`Doctrine currency FAIL (preconditions): ${errors.length} error(s)`);
    for (const error of errors) lines.push(`  - ${error}`);
    return { ok: false, lines, errors, undocumented: [], stale: [] };
  }

  const sorted = [...tokens].sort((a, b) => a.localeCompare(b));
  lines.push(`Extracted governance-visible identifiers: ${sorted.length} (seeds verified: ${EXPECTED_SEED_IDENTIFIERS.length})`);

  const exceptedSet = new Set(excepted);
  const undocumented = [];
  const desynced = [];
  const mirrorTexts = DOCTRINE_MIRROR_PAIR.map((file) => corpusTexts.get(file) ?? "");
  for (const token of sorted) {
    const pattern = wordBoundaryPattern(token);
    const documented = [...corpusTexts.values()].some((text) => pattern.test(text));
    if (documented) {
      const inMirror = mirrorTexts.map((text) => pattern.test(text));
      if (inMirror[0] !== inMirror[1]) {
        desynced.push(token);
      }
      continue;
    }
    if (!exceptedSet.has(token)) undocumented.push(token);
  }

  for (const token of desynced) {
    errors.push(`MIRROR_DESYNC: identifier "${token}" is documented in one skill mirror copy and absent from the other — the two whole-file mirrors must document the same identifiers`);
  }

  const stale = excepted.filter((identifier) => !tokens.has(identifier));
  for (const identifier of stale) {
    errors.push(`EXCEPTION_STALE: exceptions entry "${identifier}" names an identifier source no longer declares — remove it; the list must not silently accumulate`);
  }

  for (const token of undocumented) {
    errors.push(`UNDOCUMENTED_IDENTIFIER: "${token}" is declared by source, reaches an operator-facing channel, and is documented nowhere in the published doctrine corpus (and is not a recorded exception)`);
  }

  const acceptedLive = excepted.filter((identifier) => tokens.has(identifier));
  lines.push(`Documented: ${sorted.length - undocumented.length - acceptedLive.length} | recorded exceptions in force: ${acceptedLive.length} | undocumented: ${undocumented.length}`);

  if (errors.length > 0) {
    lines.push(`Doctrine currency FAIL: ${errors.length} error(s)`);
    for (const error of errors) lines.push(`  - ${error}`);
    return { ok: false, lines, errors, undocumented, stale };
  }

  lines.push("Doctrine currency PASS: every governance-visible identifier is documented or recorded as a reviewed exception");
  return { ok: true, lines, errors: [], undocumented: [], stale: [] };
}

export function runDoctrineCurrency(repoRoot = PACKAGE_ROOT) {
  const { tokens, errors: sourceErrors } = extractGovernanceVisibleTokens(repoRoot);
  const { texts: corpusTexts, rawTrio, errors: corpusErrors } = loadDoctrineCorpus(repoRoot);
  const manifestPath = join(repoRoot, DEFAULT_EXCEPTIONS_MANIFEST);
  let manifest = null;
  let manifestReadError = null;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    manifestReadError = `EXCEPTIONS_MANIFEST_MALFORMED: ${DEFAULT_EXCEPTIONS_MANIFEST} is missing, unreadable, or not valid JSON (${sanitizeForDisplay(error?.message ?? error)}) — a missing manifest is a gate failure, never an empty exception list`;
  }
  const result = evaluateDoctrineCurrency({
    tokens,
    sourceErrors: manifestReadError ? [...sourceErrors, manifestReadError] : sourceErrors,
    corpusTexts,
    corpusErrors,
    manifest,
    trioRawTexts: rawTrio
  });
  return result;
}

export function parseArgs(argv = []) {
  const options = { repoRoot: PACKAGE_ROOT, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--repo-root") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.trim() === "") throw new Error("--repo-root requires a value");
      options.repoRoot = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg} (this gate has no disable flag by design)`);
    }
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("Usage: node scripts/audit/doctrine-currency.mjs [--repo-root <dir>]");
    console.log("Semantic doctrine/source parity gate. --repo-root points the ENTIRE gate");
    console.log("at another checkout (negative-control seam); no flag disables any rule.");
    return;
  }
  const result = runDoctrineCurrency(options.repoRoot);
  for (const line of result.lines) console.log(line);
  if (!result.ok) throw new Error(`Doctrine currency gate failed:\n${result.errors.join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
