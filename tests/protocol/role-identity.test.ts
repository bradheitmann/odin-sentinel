import { describe, expect, it } from "vitest";
import {
  canonicalRoleSlot,
  hasExecutiveAuthority,
  hasRosterMutationAuthority,
  isHighAuthorityRole,
  parseRoleSlot,
  roleKindOf,
  roleSlotsEqual,
  validateAuthorityAction,
  validateCommitGate,
  validateSuccessorContract
} from "../../src/protocol/index.js";

// STORY-GOVTRUTH-R1 AC9: the ratified issuer set is pinned as a LITERAL here so
// verification never shares a mutable source with the implementation. If the
// implementation's set drifts, these literals — not the implementation — decide.
const RATIFIED_ISSUERS = [
  "operator",
  "A/EXEC-PM",
  "A/EXEC-ODIN",
  "A/EXEC-ASST",
  "A/EXEC-RSCH",
  "A/EXEC-QA"
];

// Non-ASCII probe inputs, built from escapes so the fixtures stay readable and
// survive any editor that would otherwise normalize them away.
const NBSP = "\u00A0";
const ZWSP = "\u200B";
const NB_HYPHEN = "\u2011";
const CYRILLIC_A = "\u0410";

describe("parseRoleSlot / canonicalRoleSlot \u2014 slot identity (AC1)", () => {
  it.each([
    ["B/DEV-1", "B/DEV-1"],
    ["b/dev_1", "B/DEV-1"],
    ["B / DEV - 1", "B/DEV-1"],
    ["  b/DEV--1  ", "B/DEV-1"],
    ["b/dev 1", "B/DEV-1"],
    ["operator", "OPERATOR"],
    ["OPERATOR", "OPERATOR"],
    ["a/exec-pm", "A/EXEC-PM"],
    ["A/EXEC_PM", "A/EXEC-PM"],
    ["A/EXEC-PM ", "A/EXEC-PM"]
  ])("canonicalizes %j to %j", (input, expected) => {
    expect(canonicalRoleSlot(input)).toBe(expected);
  });

  it.each([
    ["B/DEV-1", "B/DEV-2"],
    ["A/EXEC-PM", "B/EXEC-PM"],
    ["A/EXEC-PM", "A/EXEC-PM-TRAINEE"],
    ["operator", "A/OPERATOR"],
    ["operator", "operator-impostor"],
    ["B/QA-1", "B/QA-11"]
  ])("keeps %j and %j distinct", (left, right) => {
    expect(canonicalRoleSlot(left)).not.toBe(canonicalRoleSlot(right));
    expect(roleSlotsEqual(left, right)).toBe(false);
  });

  it("splits the slot into its team and role components", () => {
    expect(parseRoleSlot("b/dev_1")).toEqual({ team: "B", role: "DEV-1", canonical: "B/DEV-1" });
    expect(parseRoleSlot("operator")).toEqual({ team: null, role: "OPERATOR", canonical: "OPERATOR" });
  });

  it.each([
    ["", "empty string"],
    ["   ", "whitespace only"],
    [`${NBSP}${ZWSP} `, "invisible characters only"],
    ["A/", "empty role component"],
    ["/DEV-1", "empty team component"],
    ["A/B/C", "multi-slash form"],
    ["-A/DEV", "leading separator"],
    ["A/DEV-", "trailing separator"],
    ["A/DEV!", "punctuation outside the canonical alphabet"],
    [null, "null"],
    [undefined, "undefined"],
    [42, "non-string number"],
    [{ role: "A/EXEC-PM" }, "non-string object"],
    [["A/EXEC-PM"], "non-string array"]
  ])("refuses %j (%s) as unparseable", (input, _label: string) => {
    expect(canonicalRoleSlot(input)).toBeNull();
    expect(parseRoleSlot(input)).toBeNull();
  });

  it("never reports two unparseable identities as equal", () => {
    expect(roleSlotsEqual("", "")).toBe(false);
    expect(roleSlotsEqual(null, null)).toBe(false);
    expect(roleSlotsEqual("A/", "A/")).toBe(false);
  });
});

describe("canonicalization is Unicode-hostile (AC11)", () => {
  it.each([
    [`B/QA${NB_HYPHEN}1`, "U+2011 non-breaking hyphen"],
    [`B/QA-1${NBSP}`, "trailing NBSP"],
    [`B/QA-1${ZWSP}`, "trailing zero-width space"],
    [`B/${ZWSP}QA-1`, "interior zero-width space"],
    ["\uFF22/\uFF31\uFF21-\uFF11", "fullwidth forms folded by NFKC"]
  ])("folds %j (%s) onto B/QA-1", (input) => {
    expect(canonicalRoleSlot(input)).toBe("B/QA-1");
    expect(roleSlotsEqual(input, "B/QA-1")).toBe(true);
  });

  // REMEDIATION 1 (holdout FAIL on candidate fae24f3a): the fold was a RANGE over
  // the dash-punctuation block, so `A/EXEC<EN DASH>PM` folded onto the ratified
  // `A/EXEC-PM` and was granted executive authority. Only the hyphen class
  // (U+2010, U+2011) may fold; every other dash-like character must refuse.
  const NON_FOLDING_DASHES: Array<[string, string]> = [
    ["\u2012", "U+2012 FIGURE DASH"],
    ["\u2013", "U+2013 EN DASH"],
    ["\u2014", "U+2014 EM DASH"],
    ["\u2015", "U+2015 HORIZONTAL BAR"],
    ["\u2212", "U+2212 MINUS SIGN"],
    ["\uFE58", "U+FE58 SMALL EM DASH (NFKC -> U+2014)"]
  ];

  it.each(NON_FOLDING_DASHES)(
    "refuses %j (%s) as unparseable instead of folding it to a hyphen",
    (dash, _label: string) => {
      const respelled = `A/EXEC${dash}PM`;
      expect(respelled).not.toBe("A/EXEC-PM");
      expect(canonicalRoleSlot(respelled)).toBeNull();
      expect(parseRoleSlot(respelled)).toBeNull();
    }
  );

  it.each(NON_FOLDING_DASHES)(
    "denies executive and roster authority to an %j-respelled ratified slot (%s)",
    (dash, _label: string) => {
      const respelled = `A/EXEC${dash}PM`;
      expect(hasExecutiveAuthority(respelled)).toBe(false);
      expect(hasRosterMutationAuthority(respelled)).toBe(false);
    }
  );

  it.each(NON_FOLDING_DASHES)(
    "keeps a %j-respelled slot (%s) unequal to the ratified slot, so it cannot satisfy self-issue",
    (dash, _label: string) => {
      const respelled = `A/EXEC${dash}PM`;
      // Symmetry: unequal in both directions, and never equal to itself either,
      // so an unparseable form can never satisfy a self-authorization check.
      expect(roleSlotsEqual(respelled, "A/EXEC-PM")).toBe(false);
      expect(roleSlotsEqual("A/EXEC-PM", respelled)).toBe(false);
      expect(roleSlotsEqual(respelled, respelled)).toBe(false);
    }
  );

  it.each(NON_FOLDING_DASHES)(
    "rejects a %j-respelled issuer (%s) at the commit gate",
    (dash, _label: string) => {
      const result = validateCommitGate(
        gate({ commit_authorization: { token: "t", issued_by: `A/EXEC${dash}PM`, verified_ground_truth: true } })
      );
      expect(result.valid).toBe(false);
      expect(result.invalid).toContain("commit_authorization");
      expect(result.warnings.join(" ")).toMatch(/EXEC-layer/);
    }
  );

  it.each(NON_FOLDING_DASHES)(
    "rejects a %j-respelled authorizer (%s) at the roster gate",
    (dash, _label: string) => {
      const result = validateAuthorityAction({
        actor: "B/DEV-1",
        action_type: "RESTAFF",
        target_slot: "B/DEV-2",
        authorized_by: `A/EXEC${dash}PM`
      });
      expect(result.valid).toBe(false);
      expect(result.invalid).toContain("authorized_by");
    }
  );

  it("still folds ONLY the hyphen class, keeping the AC11 probe green", () => {
    expect(canonicalRoleSlot("B/QA\u20101")).toBe("B/QA-1");
    expect(canonicalRoleSlot("B/QA\u20111")).toBe("B/QA-1");
    expect(hasExecutiveAuthority("A/EXEC\u2010PM")).toBe(true);
    expect(hasExecutiveAuthority("A/EXEC\u2011PM")).toBe(true);
  });

  // U+FF0D and U+FE63 both carry an NFKC compatibility decomposition to U+002D,
  // so normalization itself — not the hyphen fold — produces an ASCII hyphen.
  // Their acceptance is a property of NFKC, which the contract mandates.
  it.each([
    ["\uFF0D", "U+FF0D FULLWIDTH HYPHEN-MINUS"],
    ["\uFE63", "U+FE63 SMALL HYPHEN-MINUS"]
  ])("accepts %j (%s), which NFKC itself decomposes to U+002D", (dash, _label: string) => {
    expect(dash.normalize("NFKC")).toBe("-");
    expect(canonicalRoleSlot(`A/EXEC${dash}PM`)).toBe("A/EXEC-PM");
  });

  it("refuses a Cyrillic homoglyph rather than silently matching the Latin slot", () => {
    const homoglyph = `${CYRILLIC_A}/EXEC-PM`;
    expect(homoglyph).not.toBe("A/EXEC-PM");
    expect(canonicalRoleSlot(homoglyph)).toBeNull();
    expect(roleSlotsEqual(homoglyph, "A/EXEC-PM")).toBe(false);
    expect(hasExecutiveAuthority(homoglyph)).toBe(false);
  });
});

describe("hasExecutiveAuthority \u2014 exact ratified-set membership (AC2/AC3)", () => {
  it.each(RATIFIED_ISSUERS)("accepts the ratified issuer %j", (slot) => {
    expect(hasExecutiveAuthority(slot)).toBe(true);
  });

  it.each(RATIFIED_ISSUERS)("accepts %j through case and separator aliases", (slot) => {
    expect(hasExecutiveAuthority(slot.toLowerCase())).toBe(true);
    expect(hasExecutiveAuthority(slot.replace(/-/g, "_"))).toBe(true);
    expect(hasExecutiveAuthority(` ${slot} `)).toBe(true);
  });

  it.each([
    "A/EXEC-PM-TRAINEE",
    "B/EXEC-DEV",
    "NOT_EXEC",
    "EXECUTIONER",
    "A/DEV",
    "A/",
    "A/ANYTHING",
    "operator-impostor",
    "B/EXEC-PM",
    "b/exec_pm",
    "A/OPERATOR",
    "EXEC",
    "A/EXEC",
    "C/TEAM-PM",
    "B/QA-1",
    "",
    "   "
  ])("rejects %j", (slot) => {
    expect(hasExecutiveAuthority(slot)).toBe(false);
  });

  it("rejects non-string and absent identities", () => {
    for (const value of [null, undefined, 0, 1, true, {}, [], ["operator"]]) {
      expect(hasExecutiveAuthority(value)).toBe(false);
    }
  });

  it("classifies the roster-mutation set identically, so the gates cannot disagree (AC4)", () => {
    const probes = [...RATIFIED_ISSUERS, "A/EXEC-PM-TRAINEE", "B/EXEC-PM", "EXECUTIONER", "A/ANYTHING", "C/TEAM-PM", "", null];
    for (const probe of probes) {
      expect(hasRosterMutationAuthority(probe)).toBe(hasExecutiveAuthority(probe));
    }
  });
});

describe("roleKindOf \u2014 kind classification stays distinct from slot identity", () => {
  it.each([
    ["B/DEV-1", "DEV_WORKER"],
    ["B/DEV-2", "DEV_WORKER"],
    ["C/DEV", "DEV_WORKER"],
    ["dev_1", "DEV_WORKER"],
    ["B/QA-1", "QA_WORKER"],
    ["B/QA", "QA_WORKER"],
    ["B/SHADOW-2", "SHADOW_REVIEWER"],
    ["C/PM", "TEAM_PM"],
    ["D/ODIN", "TEAM_ODIN"],
    ["A/EXEC-PM", "EXEC_PM"],
    ["B/EXEC-PM", "EXEC_PM"],
    ["A/EXEC-ODIN", "EXEC_ODIN"]
  ])("maps %j to the kind %j", (input, expected) => {
    expect(roleKindOf(input)).toBe(expected);
  });

  it("collapses lanes and teams that slot identity deliberately keeps apart", () => {
    expect(roleKindOf("B/DEV-1")).toBe(roleKindOf("B/DEV-2"));
    expect(canonicalRoleSlot("B/DEV-1")).not.toBe(canonicalRoleSlot("B/DEV-2"));
  });

  it("would grant authority to B/EXEC-PM if authority used kinds \u2014 so authority does not", () => {
    expect(roleKindOf("B/EXEC-PM")).toBe(roleKindOf("A/EXEC-PM"));
    expect(hasExecutiveAuthority("B/EXEC-PM")).toBe(false);
    expect(hasExecutiveAuthority("A/EXEC-PM")).toBe(true);
  });

  it("preserves isHighAuthorityRole kind semantics", () => {
    expect(isHighAuthorityRole("A/EXEC-PM")).toBe(true);
    expect(isHighAuthorityRole("C/PM")).toBe(true);
    expect(isHighAuthorityRole("D/ODIN")).toBe(true);
    expect(isHighAuthorityRole("B/DEV-1")).toBe(false);
    expect(isHighAuthorityRole(undefined)).toBe(false);
    expect(isHighAuthorityRole("")).toBe(false);
  });
});

// --- Gate-level migration ---------------------------------------------------

function gate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_ref: "GOVTRUTH-R1",
    pod_pm_lane: "B/TEAM-PM",
    implementer_lane: "B/DEV-1",
    staged_ready: true,
    commit_authorization: {
      token: "COMMIT-AUTHORIZED-1f2e",
      issued_by: "A/EXEC-ODIN",
      verified_ground_truth: true
    },
    committed: true,
    exec_reverified: true,
    ...overrides
  };
}

function authorization(issuedBy: unknown): Record<string, unknown> {
  return { token: "t", issued_by: issuedBy, verified_ground_truth: true };
}

describe("validateCommitGate \u2014 ratified issuer set at the gate (AC3/AC10)", () => {
  it.each(RATIFIED_ISSUERS)("accepts a commit authorized by %j", (issuer) => {
    const result = validateCommitGate(gate({ commit_authorization: authorization(issuer) }));
    expect(result.valid).toBe(true);
  });

  it("accepts the operator's own seat, which the substring gate used to refuse", () => {
    expect(validateCommitGate(gate({ commit_authorization: authorization("operator") })).valid).toBe(true);
  });

  it.each([
    "A/EXEC-PM-TRAINEE",
    "B/EXEC-DEV",
    "NOT_EXEC",
    "EXECUTIONER",
    "A/DEV",
    "A/ANYTHING",
    "operator-impostor",
    "B/EXEC-PM",
    "b/exec_pm",
    "A/OPERATOR"
  ])("rejects an issuer of %j by name", (issuer) => {
    const result = validateCommitGate(gate({ commit_authorization: authorization(issuer) }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("commit_authorization");
    expect(result.warnings.join(" ")).toMatch(/EXEC-layer/);
  });

  it.each([
    ["A/", "empty role component"],
    ["", "empty string"],
    ["   ", "whitespace only"],
    [null, "null"],
    [undefined, "absent"],
    [7, "non-string"],
    [{ slot: "A/EXEC-PM" }, "non-string object"]
  ])("refuses an invalid issued_by (%s) rather than skipping the check (AC10)", (issuer, _label: string) => {
    const result = validateCommitGate(gate({ commit_authorization: authorization(issuer) }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("commit_authorization");
    expect(result.warnings.join(" ")).toMatch(/EXEC-layer/);
  });

  it.each([
    ["", "empty string"],
    ["A/", "unparseable"],
    [7, "non-string"]
  ])("refuses an unreadable pod_pm_lane (%s) rather than skipping the self-issue check", (lane, _label: string) => {
    const result = validateCommitGate(gate({ pod_pm_lane: lane }));
    expect(result.valid).toBe(false);
    expect([...result.invalid, ...result.missing]).toContain("pod_pm_lane");
  });

  it.each([
    ["", "empty string"],
    ["A/", "unparseable"],
    [7, "non-string"]
  ])("refuses an unreadable implementer_lane (%s)", (lane, _label: string) => {
    const result = validateCommitGate(gate({ implementer_lane: lane }));
    expect(result.valid).toBe(false);
    expect([...result.invalid, ...result.missing]).toContain("implementer_lane");
  });
});

describe("validateCommitGate \u2014 self-issue after canonicalization (AC8)", () => {
  it.each([
    ["a/exec-pm", "case alias"],
    ["A/EXEC-PM ", "trailing space"],
    [`A/EXEC-PM${NBSP}`, "trailing NBSP"],
    ["A/EXEC_PM", "separator alias"],
    ["  a / exec - pm  ", "spacing and case alias"]
  ])("rejects pod_pm_lane A/EXEC-PM issuing as %j (%s)", (issuer) => {
    const result = validateCommitGate(
      gate({ pod_pm_lane: "A/EXEC-PM", commit_authorization: authorization(issuer) })
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/SELF-ISSUED/);
  });

  it.each([
    ["b/dev-1", "case alias"],
    ["B/DEV-1 ", "trailing space"],
    ["B/DEV_1", "separator alias"]
  ])("rejects the implementer B/DEV-1 issuing as %j (%s)", (issuer) => {
    const result = validateCommitGate(
      gate({ implementer_lane: "B/DEV-1", commit_authorization: authorization(issuer) })
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/implementer cannot issue its own/);
  });

  it("still accepts a genuinely independent EXEC issuer for a distinct lane", () => {
    const result = validateCommitGate(
      gate({ pod_pm_lane: "A/EXEC-PM", commit_authorization: authorization("A/EXEC-ODIN") })
    );
    expect(result.valid).toBe(true);
  });

  it("does not confuse distinct lanes that differ only by lane number", () => {
    const result = validateCommitGate(
      gate({ pod_pm_lane: "B/DEV-1", implementer_lane: "B/DEV-2" })
    );
    expect(result.valid).toBe(true);
  });
});

describe("validateAuthorityAction \u2014 shared primitive at the roster gate (AC2/AC4/AC5/AC10)", () => {
  function action(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { actor: "A/EXEC-PM", action_type: "RESTAFF", target_slot: "B/DEV-1", authorized_by: "operator", ...overrides };
  }

  it.each(RATIFIED_ISSUERS.filter((slot) => slot !== "A/EXEC-PM"))(
    "accepts a roster mutation authorized by the ratified slot %j",
    (authorizer) => {
      expect(validateAuthorityAction(action({ authorized_by: authorizer })).valid).toBe(true);
    }
  );

  it.each([
    "A/ANYTHING",
    "A/DEV",
    "A/EXEC-PM-TRAINEE",
    "B/EXEC-PM",
    "EXECUTIONER",
    "operator-impostor",
    "C/TEAM-PM"
  ])("rejects a roster mutation authorized by %j", (authorizer) => {
    const result = validateAuthorityAction(action({ authorized_by: authorizer }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("authorized_by");
  });

  it.each([
    ["a/exec-odin", "case alias"],
    ["A/EXEC-ODIN ", "trailing space"],
    ["A/EXEC_ODIN", "separator alias"],
    [`A/EXEC-ODIN${ZWSP}`, "zero-width space"]
  ])("rejects A/EXEC-ODIN self-authorizing as %j (%s)", (authorizer) => {
    const result = validateAuthorityAction({
      actor: "A/EXEC-ODIN",
      action_type: "restaff_dead_seat",
      target_slot: "B/QA",
      authorized_by: authorizer
    });
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("authorized_by");
    expect(result.warnings.join(" ")).toMatch(/LOCKED|own initiative/);
  });

  it.each([
    ["", "empty string"],
    ["   ", "whitespace only"],
    ["A/", "unparseable"],
    [null, "null"],
    [7, "non-string"]
  ])("refuses an unreadable authorized_by (%s) rather than proceeding", (authorizer, _label: string) => {
    const result = validateAuthorityAction(action({ authorized_by: authorizer }));
    expect(result.valid).toBe(false);
    expect([...result.invalid, ...result.missing]).toContain("authorized_by");
  });

  it.each([
    ["", "empty string"],
    ["A/", "unparseable"],
    [7, "non-string"]
  ])("refuses an unreadable actor (%s) rather than proceeding on an operator authorization", (actor, _label: string) => {
    const result = validateAuthorityAction(action({ actor, authorized_by: "operator" }));
    expect(result.valid).toBe(false);
    expect([...result.invalid, ...result.missing]).toContain("actor");
  });

  it("agrees with the commit gate about the same actor (AC4)", () => {
    for (const seat of [...RATIFIED_ISSUERS, "A/ANYTHING", "B/EXEC-PM", "EXECUTIONER", "A/EXEC-PM-TRAINEE"]) {
      const commitAccepts = validateCommitGate(gate({ commit_authorization: authorization(seat) })).valid;
      const rosterAccepts = validateAuthorityAction(action({ actor: "B/DEV-1", authorized_by: seat })).valid;
      expect(rosterAccepts).toBe(commitAccepts);
    }
  });
});

describe("validateSuccessorContract \u2014 roster-mutation label on the shared primitive", () => {
  function successor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      successor_seat: "A/EXEC-ODIN",
      locked_roster: ["B/DEV-1"],
      in_flight_worklist: [],
      canonical_hashes: { protocol: "abc" },
      roster_mutation_authority: "operator",
      report_up_chain: true,
      ...overrides
    };
  }

  it.each(["operator", "OPERATOR", "Operator", "TEAM_A_EXEC", "team-a-exec", "TEAM A EXEC"])(
    "accepts the authority label %j",
    (label) => {
      expect(validateSuccessorContract(successor({ roster_mutation_authority: label })).valid).toBe(true);
    }
  );

  it.each(["B/TEAM-PM", "TEAM_B_EXEC", "operator-impostor", "A/EXEC-PM", "", "A/"])(
    "rejects the authority label %j",
    (label) => {
      const result = validateSuccessorContract(successor({ roster_mutation_authority: label }));
      expect(result.valid).toBe(false);
    }
  );
});
