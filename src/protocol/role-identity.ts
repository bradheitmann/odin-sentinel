/**
 * STORY-GOVTRUTH-R1 — canonical role identity.
 *
 * This module carries TWO distinct operations with deliberately different
 * semantics. They are not interchangeable and must not be folded together:
 *
 * 1. `roleKindOf` — KIND classification. Collapses lane numbers and strips the
 *    team prefix so `B/DEV-1`, `C/DEV`, and `dev_2` all resolve to the single
 *    `DEV_WORKER` profile key. This is the lookup key for role/model profiles
 *    (`getRoleProfile`, `modelProfileKeys`, `roleKind`, `isHighAuthorityRole`).
 *    It answers "what kind of seat is this", never "which seat is this".
 *
 * 2. `canonicalRoleSlot` / `roleSlotsEqual` — SLOT identity. Lane- and
 *    team-preserving. `B/DEV-1` and `B/DEV-2` stay distinct, and `A/EXEC-PM`
 *    and `B/EXEC-PM` stay distinct. Every authority decision uses this and only
 *    this: a kind-based authority match would accept `B/EXEC-PM` as the
 *    executive office.
 *
 * Authority is a data question, not a pattern question. It is decided by exact
 * canonical-slot membership in an explicit ratified set — never by substring
 * (`/EXEC/i` also matches `EXECUTIONER`), never by bare team prefix (`/^A\//i`
 * also matches `A/ANYTHING`). Unparseable, empty, and non-string identities are
 * refused by name, fail-closed; they are never treated as
 * non-matching-but-proceed.
 */

/**
 * Zero-width and format characters. These are invisible in every surface an
 * operator reads, so a slot carrying one would otherwise be a distinct identity
 * that looks identical to a ratified one.
 */
const ZERO_WIDTH_OR_FORMAT = /[\u00AD\u200B-\u200F\u2060-\u2064\u206A-\u206F\uFEFF]/g;

/**
 * HYPHEN-CLASS characters only: U+2010 HYPHEN and U+2011 NON-BREAKING HYPHEN.
 * NFKC maps U+2011 to U+2010 rather than to U+002D and leaves U+2010 alone, so
 * this narrow fold is required to satisfy AC11's U+2011 probe.
 *
 * Deliberately NOT a range over the dash-punctuation block. Every other
 * dash-like character (U+2012 FIGURE DASH, U+2013 EN DASH, U+2014 EM DASH,
 * U+2015 HORIZONTAL BAR, U+2212 MINUS SIGN, U+FE58 SMALL EM DASH (NFKC ->
 * U+2014) survives normalization outside the canonical alphabet and MUST
 * refuse as unparseable, fail-closed. A range here would silently fold
 * `A/EXEC<EN DASH>PM` onto the ratified `A/EXEC-PM` and grant it authority.
 */
const HYPHEN_CLASS = /[\u2010\u2011]/g;

/** A canonical slot component: ASCII alphanumeric runs joined by single hyphens. */
const CANONICAL_COMPONENT = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export type ParsedRoleSlot = {
  /** Team prefix (`A` in `A/EXEC-PM`), or null for an unprefixed slot such as `operator`. */
  team: string | null;
  /** Role component (`EXEC-PM` in `A/EXEC-PM`), canonicalized. */
  role: string;
  /** Full canonical slot identity: `TEAM/ROLE`, or `ROLE` when unprefixed. */
  canonical: string;
};

/**
 * The ratified commit-issuer set (STORY-GOVTRUTH-R1 AC3/AC9): the operator plus
 * the declared Team-A executive-office slots, as FULL slots with the team
 * included. Membership is exact after canonicalization. Anything absent from
 * this list is not an authority, including strings that look like one.
 */
export const RATIFIED_COMMIT_ISSUER_SLOTS = [
  "operator",
  "A/EXEC-PM",
  "A/EXEC-ODIN",
  "A/EXEC-ASST",
  "A/EXEC-RSCH",
  "A/EXEC-QA"
] as const;

/**
 * The roster-mutation authorizer set. Deliberately the same ratified slots as
 * the commit-issuer set and resolved through the same primitive (AC4), so the
 * commit gate and the roster gate can no longer disagree about the same actor.
 */
export const ROSTER_MUTATION_AUTHORITY_SLOTS = RATIFIED_COMMIT_ISSUER_SLOTS;

/**
 * Parse an arbitrary value into a canonical role slot, or null when it is not a
 * usable slot identity. Null covers non-strings, null/undefined, empty and
 * whitespace-only strings, multi-slash forms, empty components, and anything
 * carrying characters outside the canonical ASCII alphabet after normalization
 * — which is what makes a Cyrillic homoglyph (U+0410) refuse rather than
 * silently match its Latin twin.
 *
 * Canonicalization order: NFKC, strip zero-width/format characters, fold the
 * hyphen class (U+2010/U+2011) to ASCII hyphen, fold Unicode whitespace,
 * uppercase, then
 * collapse `[\s_-]` runs within each component to a single hyphen. Case,
 * separator form, and surrounding/internal whitespace stop being identity;
 * lane number and team prefix remain identity.
 */
export function parseRoleSlot(value: unknown): ParsedRoleSlot | null {
  if (typeof value !== "string") return null;

  const folded = value
    .normalize("NFKC")
    .replace(ZERO_WIDTH_OR_FORMAT, "")
    .replace(HYPHEN_CLASS, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  if (folded === "") return null;

  const parts = folded.split("/");
  if (parts.length > 2) return null;

  const components = parts.map((part) => part.trim().replace(/[\s_-]+/g, "-"));
  if (components.some((component) => !CANONICAL_COMPONENT.test(component))) return null;

  const team = components.length === 2 ? components[0] : null;
  const role = components.length === 2 ? components[1] : components[0];
  return { team, role, canonical: team === null ? role : `${team}/${role}` };
}

/** Canonical slot identity string, or null when the value is not a usable slot. */
export function canonicalRoleSlot(value: unknown): string | null {
  return parseRoleSlot(value)?.canonical ?? null;
}

/**
 * True only when both values are usable slots AND denote the same slot. Two
 * unparseable values are never "equal" — an unreadable identity must not
 * satisfy a self-authorization check by accident.
 */
export function roleSlotsEqual(left: unknown, right: unknown): boolean {
  const a = canonicalRoleSlot(left);
  const b = canonicalRoleSlot(right);
  return a !== null && b !== null && a === b;
}

/** Short, control-character-free rendering of a rejected identity for refusal messages. */
export function describeRoleSlotInput(value: unknown): string {
  if (value === undefined) return "<missing>";
  if (value === null) return "<null>";
  if (typeof value !== "string") return `<non-string ${typeof value}>`;
  if (value.trim() === "") return "<empty>";
  const sanitized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return sanitized.length > 60 ? `"${sanitized.slice(0, 57)}..."` : `"${sanitized}"`;
}

const RATIFIED_COMMIT_ISSUERS = new Set(
  RATIFIED_COMMIT_ISSUER_SLOTS.map((slot) => canonicalRoleSlot(slot) as string)
);
const ROSTER_MUTATION_AUTHORITIES = new Set(
  ROSTER_MUTATION_AUTHORITY_SLOTS.map((slot) => canonicalRoleSlot(slot) as string)
);

/**
 * True only for an exact canonical-slot member of the ratified commit-issuer
 * set. `operator` is a member; `A/EXEC-PM-TRAINEE`, `B/EXEC-PM`, `EXECUTIONER`,
 * `NOT_EXEC`, `A/`, `A/ANYTHING`, and `A/OPERATOR` are not.
 */
export function hasExecutiveAuthority(value: unknown): boolean {
  const canonical = canonicalRoleSlot(value);
  return canonical !== null && RATIFIED_COMMIT_ISSUERS.has(canonical);
}

/** True only for an exact canonical-slot member of the roster-mutation authorizer set. */
export function hasRosterMutationAuthority(value: unknown): boolean {
  const canonical = canonicalRoleSlot(value);
  return canonical !== null && ROSTER_MUTATION_AUTHORITIES.has(canonical);
}

/**
 * KIND classification — NOT an identity. Collapses the team prefix and lane
 * number so every seat of a kind shares one profile key. These are the
 * long-standing `normalizeRoleName` semantics, rehomed unchanged; do not route
 * authority decisions through this function.
 */
export function roleKindOf(role: string): string {
  const visibleSlot = role.includes("/") ? role.split("/").at(-1) ?? role : role;
  const normalized = visibleSlot.toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized === "ODIN") return "TEAM_ODIN";
  // Bare team-prefixed PM slots (C/PM, D/PM) are TEAM PM seats; the exec form is
  // always spelled EXEC-PM and never reduces to bare "PM".
  if (normalized === "PM") return "TEAM_PM";
  // Worker slots resolve with or without a lane number: B/QA and B/QA-1 are the
  // same profile. Un-numbered slots are common in the field (single-lane pods).
  if (/^DEV(_\d+)?$/.test(normalized)) return "DEV_WORKER";
  if (/^QA(_\d+)?$/.test(normalized)) return "QA_WORKER";
  if (/^SHADOW(_\d+)?$/.test(normalized)) return "SHADOW_REVIEWER";
  return normalized;
}

/**
 * Kind-level high-authority test used for readiness/assurance decisions (not an
 * authority grant). Rehomed onto `roleKindOf` with its semantics unchanged.
 */
export function isHighAuthorityRole(role: string | undefined): boolean {
  if (!role) return false;
  const n = roleKindOf(role);
  return n === "EXEC_PM" || n === "TEAM_PM" || n === "EXEC_ODIN" || n === "TEAM_ODIN";
}
