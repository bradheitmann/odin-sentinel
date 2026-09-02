import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalRoleComponent,
  validateFallbackContract,
  validateAuthorityAction,
  validateCommitGate,
  validateSuccessorContract
} from "../../src/protocol/index.js";

// Keep this vocabulary independent of the implementation's matcher.
const RECOGNIZED_ACTION_TYPES = [
  "RESTAFF",
  "RESTAFF_DEAD_SEAT",
  "RESTAFF_ON_OWN_INITIATIVE",
  "SELF_RESTAFF",
  "SPAWN",
  "SPAWN_SIBLING",
  "CHANGE_MODEL",
  "CHANGE_HARNESS",
  "ROSTER_MUTATION",
  "RENAME_SLOT",
  "CLOSE_SLOT",
  "LATERAL_ROSTER_NEGOTIATION"
] as const;

const ROSTER_MUTATION_TYPES = RECOGNIZED_ACTION_TYPES.filter(
  (actionType) => actionType !== "LATERAL_ROSTER_NEGOTIATION"
);
const ZWSP = "\u200B";
const SOFT_HYPHEN = "\u00AD";
const BOM = "\uFEFF";

function action(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actor: "B/DEV-1",
    action_type: "RESTAFF",
    target_slot: "B/DEV-2",
    authorized_by: "A/EXEC-PM",
    ...overrides
  };
}

function resultFor(actionType: unknown, authorizedBy: unknown = "A/EXEC-PM") {
  return validateAuthorityAction(action({ action_type: actionType, authorized_by: authorizedBy }));
}

function actionTypeSpellings(actionType: string): Array<[string, string]> {
  return [
    [actionType, "underscore"],
    [actionType.toUpperCase(), "uppercase"],
    [actionType.toLowerCase(), "lowercase"],
    [actionType.replaceAll("_", "-"), "hyphen"],
    [actionType.replaceAll("_", " "), "space"]
  ];
}

describe("validateAuthorityAction action-type canonicalization", () => {
  it("pins the twelve recognized action types as independent literals", () => {
    expect(RECOGNIZED_ACTION_TYPES).toEqual([
      "RESTAFF",
      "RESTAFF_DEAD_SEAT",
      "RESTAFF_ON_OWN_INITIATIVE",
      "SELF_RESTAFF",
      "SPAWN",
      "SPAWN_SIBLING",
      "CHANGE_MODEL",
      "CHANGE_HARNESS",
      "ROSTER_MUTATION",
      "RENAME_SLOT",
      "CLOSE_SLOT",
      "LATERAL_ROSTER_NEGOTIATION"
    ]);
  });

  it.each(
    ROSTER_MUTATION_TYPES.flatMap((actionType) =>
      actionTypeSpellings(actionType).map(([spelling, form]) => [actionType, spelling, form] as const)
    )
  )("keeps %s governed for its %s spelling (%s)", (_canonical, spelling) => {
    const result = resultFor(spelling, "A/EXEC-PM");
    expect(result.valid).toBe(true);
    expect(result.invalid).not.toContain("action_type");
  });

  it.each(ROSTER_MUTATION_TYPES)(
    "refuses a non-authority authorizer for canonical %s",
    (actionType) => {
      const result = resultFor(actionType, "B/DEV-2");
      expect(result.valid).toBe(false);
      expect(result.invalid).toContain("authorized_by");
      expect(result.invalid).not.toContain("action_type");
    }
  );

  it.each(
    ROSTER_MUTATION_TYPES.flatMap((actionType) =>
      actionTypeSpellings(actionType).map(([spelling, form]) => [actionType, spelling, form] as const)
    )
  )("refuses a non-authority authorizer for %s's %s spelling (%s)", (_canonical, spelling) => {
    const result = resultFor(spelling, "B/DEV-2");
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("authorized_by");
    expect(result.invalid).not.toContain("action_type");
  });

  it.each([
    ["RESTAFF ", "plain trailing space"],
    [`RESTAFF${ZWSP}`, "trailing zero-width space"],
    [`${ZWSP}RESTAFF`, "leading zero-width space"],
    [`RESTAFF${SOFT_HYPHEN}`, "trailing soft hyphen"],
    [`REST${SOFT_HYPHEN}AFF`, "infixed soft hyphen"],
    [`RESTAFF${BOM}`, "trailing BOM"],
    ["ＲＥＳＴＡＦＦ", "fullwidth letters"],
    [`SPAWN${ZWSP}`, "SPAWN trailing zero-width space"],
    [`CHANGE_MODEL${ZWSP}`, "CHANGE_MODEL trailing zero-width space"],
    ["CHANGE‑MODEL", "U+2011 non-breaking hyphen"],
    ["CLOSE‐SLOT", "U+2010 hyphen"]
  ] as const)(
    "runs the authority path for foldable exploit %s (%s)",
    (actionType, _label) => {
      const result = resultFor(actionType, "A/ANYTHING");
      expect(result.valid).toBe(false);
      expect(result.invalid).toContain("authorized_by");
      expect(result.invalid).not.toContain("action_type");
    }
  );

  it.each([
    "RESTAFFX",
    "RE_STAFF",
    "PROMOTE",
    "restaff dead",
    "ROSTER",
    "SPAWN_SIBLINGS"
  ])("refuses unrecognized action type %j by name", (actionType) => {
    const result = resultFor(actionType);
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("action_type");
    expect(result.warnings.join(" ")).toContain(`unrecognized action_type "${actionType}"`);
    expect(result.warnings.join(" ")).toContain("refused rather than treated as ungoverned");
  });

  it.each([
    ["CHANGE–MODEL", "U+2013 EN DASH"],
    ["CHANGE—MODEL", "U+2014 EM DASH"],
    ["CHANGE−MODEL", "U+2212 MINUS SIGN"],
    ["\u0420\u0415\u0421\u0422\u0410FF", "Cyrillic homoglyph"]
  ] as const)("refuses non-foldable Unicode %s (%s) by name", (actionType, _label) => {
    const result = resultFor(actionType);
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("action_type");
    expect(result.warnings.join(" ")).toContain(`unrecognized action_type "${actionType}"`);
  });

  it.each([
    ["CHANGE－MODEL", "U+FF0D FULLWIDTH HYPHEN-MINUS"],
    ["CHANGE﹣MODEL", "U+FE63 SMALL HYPHEN-MINUS"]
  ] as const)("keeps NFKC-legal separator %s (%s) governed", (actionType, _label) => {
    const result = resultFor(actionType);
    expect(result.valid).toBe(true);
    expect(result.invalid).toEqual([]);
  });

  it.each([
    ["", "empty string"],
    ["   ", "whitespace-only string"],
    [null, "null"],
    [42, "non-string"],
    [undefined, "absent value"]
  ] as const)("refuses degenerate action_type %s (%s) by name", (actionType, _label) => {
    const packet = action({ action_type: actionType });
    if (actionType === undefined) delete packet.action_type;
    const result = validateAuthorityAction(packet);
    expect(result.valid).toBe(false);
    expect([...result.missing, ...result.invalid]).toContain("action_type");
    expect(result.invalid).toContain("action_type");
  });

  it.each([
    "LATERAL_ROSTER_NEGOTIATION",
    "LATERAL_ROSTER_NEGOTIATION ",
    `LATERAL_ROSTER_NEGOTIATION${ZWSP}`,
    "LATERAL-ROSTER-NEGOTIATION",
    "LATERAL ROSTER NEGOTIATION"
  ])("keeps lateral negotiation governed as a report-up breach for %j", (actionType) => {
    const result = resultFor(actionType);
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("action_type");
    expect(result.warnings.join(" ")).toContain("report UP");
  });
});

describe("shared canonical component fold preserves fallback semantics", () => {
  function fallback(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      role_slot: "B/TEAM-PM",
      fallback_rungs: [
        { harness: "droid", model: "pinned-model-x", flags: ["--auto", "high"], reasoning: "high" }
      ],
      substitution_triggers: ["AGENT_DEATH", "USAGE_CAP_EXHAUSTION", "SILENT_SESSION_DROP"],
      post_relaunch_model_verify: true,
      ...overrides
    };
  }

  it.each([
    ["AGENT_DEATH", "canonical"],
    ["agent-death", "hyphen"],
    ["agent death", "space"],
    ["AGENT‑DEATH", "U+2011"],
    [`AGENT_DEATH${ZWSP}`, "zero-width suffix"]
  ] as const)("folds %s (%s) through the shared component helper", (trigger, _label) => {
    expect(canonicalRoleComponent(trigger)).toBe("AGENT-DEATH");
    expect(validateFallbackContract(fallback({ substitution_triggers: [trigger] })).valid).toBe(true);
  });

  it("keeps billing errors as field-specific operator-side refusals", () => {
    const result = validateFallbackContract(
      fallback({ substitution_triggers: ["provider billing error"] })
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("substitution_triggers");
    expect(result.warnings.join(" ")).toMatch(/operator-side.*HOLD the seat/i);
  });

  it("keeps unknown fallback triggers as warnings rather than authority errors", () => {
    const result = validateFallbackContract(fallback({ substitution_triggers: ["UNRELATED_EVENT"] }));
    expect(result.valid).toBe(true);
    expect(result.invalid).not.toContain("substitution_triggers");
    expect(result.warnings.join(" ")).toContain("not in the canonical set");
  });
});

describe("validateAuthorityAction label-versus-seat boundary", () => {
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

  it.each(["operator", "TEAM-A-EXEC", "TEAM_A_EXEC", "team a exec"])(
    "accepts successor roster-mutation authority label %j",
    (label) => {
      expect(validateSuccessorContract(successor({ roster_mutation_authority: label })).valid).toBe(true);
    }
  );

  it("refuses a seat in the successor label field", () => {
    const result = validateSuccessorContract(successor({ roster_mutation_authority: "A/EXEC-PM" }));
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("roster_mutation_authority");
  });

  it("accepts an individual seat in authorized_by", () => {
    const result = resultFor("RESTAFF", "A/EXEC-PM");
    expect(result.valid).toBe(true);
  });

  it("refuses the successor authority class label in authorized_by", () => {
    const result = resultFor("RESTAFF", "TEAM-A-EXEC");
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("authorized_by");
  });

  it("documents the label and seat channels at both validation sites", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/protocol/service.ts", import.meta.url)),
      "utf8"
    );
    expect(source).toContain("Label-vs-seat distinction:");
    expect(source).toContain("authorized_by names the individual SEAT");
  });
});

describe("identity comparison call convention", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../src/protocol/service.ts", import.meta.url)),
    "utf8"
  );

  it("uses roleSlotsEqual on source fields for all self-issue checks", () => {
    expect(source).toContain("roleSlotsEqual(auth.issued_by, record.pod_pm_lane)");
    expect(source).toContain("roleSlotsEqual(auth.issued_by, record.implementer_lane)");
    expect(source).toContain("roleSlotsEqual(action.authorized_by, action.actor)");
    expect(source).not.toMatch(/issuedBy\s*===\s*podPm/);
    expect(source).not.toMatch(/issuedBy\s*===\s*implementer/);
    expect(source).not.toMatch(/authorizedSlot\s*===\s*actorSlot/);
  });

  it("preserves alias-spelled self-authorization refusal", () => {
    const result = validateAuthorityAction(
      action({
        actor: "B/DEV-1",
        action_type: "restaff",
        authorized_by: "b/dev_1"
      })
    );
    expect(result.valid).toBe(false);
    expect(result.invalid).toContain("authorized_by");
    expect(result.warnings.join(" ")).toMatch(/never re-staffs itself/);
  });

  it("preserves alias-spelled commit self-issue refusal", () => {
    const result = validateCommitGate({
      task_ref: "GOVTRUTH-R1",
      pod_pm_lane: "A/EXEC-PM",
      implementer_lane: "B/DEV-1",
      staged_ready: true,
      commit_authorization: {
        token: "t",
        issued_by: "a/exec_pm",
        verified_ground_truth: true
      }
    });
    expect(result.valid).toBe(false);
    expect(result.warnings.join(" ")).toContain("SELF-ISSUED");
  });
});
