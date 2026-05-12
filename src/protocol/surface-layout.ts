const MAX_TEAMS = 26;
const MAX_SURFACES_PER_COLUMN = 2;

export type SurfaceLayoutSurface = {
  rowIndex: number;
  team: string;
  isExec: boolean;
};

export type SurfaceLayoutColumn = {
  columnIndex: number;
  surfaces: SurfaceLayoutSurface[];
};

export type SurfaceLayout = {
  teamCount: number;
  totalColumns: number;
  maxSurfacesPerColumn: number;
  isBalanced: boolean;
  execColumnIndex: number;
  execColumnIsTall: boolean;
  columns: SurfaceLayoutColumn[];
};

function teamLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function buildEmpty(): SurfaceLayout {
  return {
    teamCount: 0,
    totalColumns: 0,
    maxSurfacesPerColumn: MAX_SURFACES_PER_COLUMN,
    isBalanced: true,
    execColumnIndex: 0,
    execColumnIsTall: false,
    columns: []
  };
}

export function computeSurfaceLayout(teamCount: number): SurfaceLayout {
  if (!Number.isInteger(teamCount) || teamCount < 0) {
    throw new Error(`Invalid teamCount: ${teamCount} (must be a non-negative integer)`);
  }
  if (teamCount > MAX_TEAMS) {
    throw new Error(`teamCount ${teamCount} exceeds MAX_TEAMS=${MAX_TEAMS}`);
  }

  if (teamCount === 0) return buildEmpty();

  const columns: SurfaceLayoutColumn[] = [];

  if (teamCount === 1) {
    columns.push({
      columnIndex: 0,
      surfaces: [{ rowIndex: 0, team: "A", isExec: true }]
    });
    return {
      teamCount: 1,
      totalColumns: 1,
      maxSurfacesPerColumn: MAX_SURFACES_PER_COLUMN,
      isBalanced: true,
      execColumnIndex: 0,
      execColumnIsTall: false,
      columns
    };
  }

  if (teamCount === 2) {
    columns.push({
      columnIndex: 0,
      surfaces: [{ rowIndex: 0, team: "A", isExec: true }]
    });
    columns.push({
      columnIndex: 1,
      surfaces: [{ rowIndex: 0, team: "B", isExec: false }]
    });
    return {
      teamCount: 2,
      totalColumns: 2,
      maxSurfacesPerColumn: MAX_SURFACES_PER_COLUMN,
      isBalanced: true,
      execColumnIndex: 0,
      execColumnIsTall: false,
      columns
    };
  }

  const execIsAlone = teamCount % 2 === 1;
  const nonExecColumnCount = execIsAlone ? (teamCount - 1) / 2 : teamCount / 2 - 1;

  const execColumnSurfaces: SurfaceLayoutSurface[] = [{ rowIndex: 0, team: "A", isExec: true }];
  if (!execIsAlone) {
    execColumnSurfaces.push({
      rowIndex: 1,
      team: teamLetter(teamCount - 1),
      isExec: false
    });
  }
  columns.push({ columnIndex: 0, surfaces: execColumnSurfaces });

  for (let k = 1; k <= nonExecColumnCount; k++) {
    const topLetterIndex = 2 * k - 1;
    const bottomLetterIndex = 2 * k;
    columns.push({
      columnIndex: k,
      surfaces: [
        { rowIndex: 0, team: teamLetter(topLetterIndex), isExec: false },
        { rowIndex: 1, team: teamLetter(bottomLetterIndex), isExec: false }
      ]
    });
  }

  return {
    teamCount,
    totalColumns: columns.length,
    maxSurfacesPerColumn: MAX_SURFACES_PER_COLUMN,
    isBalanced: !execIsAlone,
    execColumnIndex: 0,
    execColumnIsTall: execIsAlone,
    columns
  };
}

export function renderSurfaceLayoutAscii(layout: SurfaceLayout): string {
  if (layout.totalColumns === 0) return "[]";
  return layout.columns
    .map((column) => {
      const teams = column.surfaces.map((surface) => surface.team).join("/");
      return `[${teams}]`;
    })
    .join(" ");
}

export type SurfaceLayoutGate = {
  fromTeamCount: number;
  toTeamCount: number;
  requiresNewColumn: boolean;
  requiresExecColumnSplit: boolean;
  requiresMoveOperations: boolean;
  status: "PASS" | "DEGRADED_OPERATOR_LAYOUT" | "NOT_GOVERNED_NO_CMUX" | "SPLIT_WORKSPACE_BLOCKED";
  warnings: string[];
  preStaffingCheck: string;
};

export type SurfaceLayoutGateOptions = {
  cmuxAvailable?: boolean;
  layoutMode?: "human_cmux_quad" | "tab_only" | "legacy_columns";
  degradedModeApproved?: boolean;
  execPmWorkspaceMode?: "SAME_WORKSPACE" | "SPLIT_WORKSPACE";
  splitWorkspaceRoutingProof?: string;
};

export function computeSurfaceLayoutGate(
  fromTeamCount: number,
  toTeamCount: number,
  options: SurfaceLayoutGateOptions = {}
): SurfaceLayoutGate {
  if (toTeamCount <= fromTeamCount) {
    throw new Error(
      `Gate requires toTeamCount > fromTeamCount (got ${fromTeamCount} -> ${toTeamCount})`
    );
  }
  const before = computeSurfaceLayout(fromTeamCount);
  const after = computeSurfaceLayout(toTeamCount);

  const requiresNewColumn = after.totalColumns > before.totalColumns;
  const requiresExecColumnSplit =
    before.columns[0]?.surfaces.length === 1 && after.columns[0]?.surfaces.length === 2;

  const beforeNonExec = before.columns.slice(1).flatMap((column) => column.surfaces.map((s) => s.team));
  const afterNonExec = after.columns.slice(1).flatMap((column) => column.surfaces.map((s) => s.team));
  const requiresMoveOperations =
    beforeNonExec.length > 0 && !afterNonExec.join(",").startsWith(beforeNonExec.join(","));
  const warnings: string[] = [];
  let status: SurfaceLayoutGate["status"] = "PASS";

  if (options.cmuxAvailable === false) {
    status = "NOT_GOVERNED_NO_CMUX";
    warnings.push("CMUX is unavailable; governed team launch must be blocked or downgraded to non-governed documentation/validation mode.");
  } else if (options.layoutMode === "tab_only" && options.degradedModeApproved !== true) {
    status = "DEGRADED_OPERATOR_LAYOUT";
    warnings.push("Tab-only layout is not acceptable for governed team mode unless degraded mode is explicitly approved.");
  } else if (
    options.execPmWorkspaceMode === "SPLIT_WORKSPACE" &&
    (!options.splitWorkspaceRoutingProof || options.splitWorkspaceRoutingProof.trim() === "")
  ) {
    status = "SPLIT_WORKSPACE_BLOCKED";
    warnings.push("A/EXEC-PM must remain in the governed workspace unless SPLIT_WORKSPACE routing proof is recorded.");
  }

  return {
    fromTeamCount,
    toTeamCount,
    requiresNewColumn,
    requiresExecColumnSplit,
    requiresMoveOperations,
    status,
    warnings,
    preStaffingCheck: [
      "Layout profile: human_cmux_quad is the canonical governed bootstrap profile.",
      "CMUX vocabulary: workspace -> pane -> surface.",
      "EXEC PM must complete surface layout before dispatching any new spawn:",
      `1. Compute target layout for teamCount=${toTeamCount}.`,
      `2. ${
        requiresNewColumn
          ? "Add a new rightmost column via `cmux new-split right`."
          : "No new column required."
      }`,
      `3. ${
        requiresExecColumnSplit
          ? "Split A's column via `cmux new-split down --pane <A>`."
          : requiresMoveOperations
            ? "Rearrange existing non-exec surfaces to match the target layout (move-surface operations may be required)."
            : "No internal rearrangement required."
      }`,
      "4. Confirm the new surface exists and is empty via `cmux list-pane-surfaces`.",
      "5. Only then dispatch the spawn to the new surface."
    ].join("\n")
  };
}

export type HumanCmuxRoleSlot = {
  roleSlot: string;
  workspace: string;
  pane: string;
  surface: string;
  emptyBeforeLaunch: boolean;
};

export type HumanCmuxRegion = {
  quadrant: "A" | "B" | "C" | "D";
  label: string;
  purpose: string;
  roles: string[];
  locatorPrefix: string;
};

export type HumanCmuxQuadLayout = {
  profile: "human_cmux_quad";
  workspace: {
    id: string;
    name: string;
    cmuxRequired: true;
    execPmSameWorkspaceRequired: true;
  };
  regions: HumanCmuxRegion[];
  roleSlots: HumanCmuxRoleSlot[];
  blockedSlots: string[];
  degradedModeWarnings: string[];
  humanSummary: string;
  machineInstructions: string[];
};

function developmentPodRoles(team: string): string[] {
  return [`${team}/TEAM-PM`, `${team}/ODIN`, `${team}/DEV-1`, `${team}/QA-1`, `${team}/SHADOW-1`];
}

export function computeHumanCmuxQuadLayout(teamCount = 3, workspaceName = "ODIN Governed Bootstrap"): HumanCmuxQuadLayout {
  if (!Number.isInteger(teamCount) || teamCount < 1 || teamCount > MAX_TEAMS) {
    throw new Error(`Invalid teamCount: ${teamCount} (must be an integer from 1 to ${MAX_TEAMS})`);
  }

  const execRoles = ["A/EXEC-PM", "A/EXEC-ODIN", "A/EXEC-ASST", "A/EXEC-RSCH", "A/EXEC-QA"];
  const teamLetters = Array.from({ length: teamCount }, (_, index) => teamLetter(index));
  const teamBRoles = teamLetters.includes("B") ? developmentPodRoles("B") : [];
  const teamCRoles = teamLetters.includes("C") ? developmentPodRoles("C") : [];
  const overflowTeams = teamLetters.filter((team) => !["A", "B", "C"].includes(team));
  const overflowRoles = overflowTeams.flatMap(developmentPodRoles);
  const regions: HumanCmuxRegion[] = [
    {
      quadrant: "A",
      label: "Executive Office",
      purpose: "A/EXEC-PM, executive ODIN, assistant, research, and executive QA remain visible.",
      roles: execRoles,
      locatorPrefix: "workspace:governed pane:quad-a"
    },
    {
      quadrant: "B",
      label: "Team B Pod",
      purpose: "Primary development pod with PM, ODIN, DEV, QA, and SHADOW role slots.",
      roles: teamBRoles,
      locatorPrefix: "workspace:governed pane:quad-b"
    },
    {
      quadrant: "C",
      label: "Team C Pod",
      purpose: "Second development pod with the same visible role-slot shape as Team B.",
      roles: teamCRoles,
      locatorPrefix: "workspace:governed pane:quad-c"
    },
    {
      quadrant: "D",
      label: overflowRoles.length > 0 ? "Overflow Pods and Blockers" : "Blockers, Status, Intake",
      purpose: "Operator-visible blocker lane, readiness matrix, intake, and deterministic overflow pods.",
      roles: overflowRoles,
      locatorPrefix: "workspace:governed pane:quad-d"
    }
  ];

  const roleSlots = regions.flatMap((region) =>
    region.roles.map((roleSlot, index) => ({
      roleSlot,
      workspace: "workspace:governed",
      pane: `pane:quad-${region.quadrant.toLowerCase()}`,
      surface: `surface:${region.quadrant.toLowerCase()}-${index + 1}-${roleSlot.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      emptyBeforeLaunch: true
    }))
  );

  return {
    profile: "human_cmux_quad",
    workspace: {
      id: "workspace:governed",
      name: workspaceName,
      cmuxRequired: true,
      execPmSameWorkspaceRequired: true
    },
    regions,
    roleSlots,
    blockedSlots: [],
    degradedModeWarnings: [],
    humanSummary: [
      `${workspaceName}: Quadrant A executive office (${execRoles.join(", ")}).`,
      `Quadrant B Team B pod (${teamBRoles.length} slots).`,
      `Quadrant C Team C pod (${teamCRoles.length} slots).`,
      `Quadrant D blockers/status/intake${overflowTeams.length > 0 ? ` plus overflow teams ${overflowTeams.join(", ")}` : ""}.`,
      "Every role slot is visible and empty before occupant launch."
    ].join(" "),
    machineInstructions: [
      "Create or select one CMUX workspace for governed bootstrap.",
      "Split the workspace into four panes: quad-a, quad-b, quad-c, quad-d.",
      "Create one surface per role slot inside its assigned pane before launching occupants.",
      "Keep A/EXEC-PM in quad-a in the same workspace as all development teams.",
      "Use quad-d for blockers/status/intake and deterministic overflow before adding additional workspaces."
    ]
  };
}
