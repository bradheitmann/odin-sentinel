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
  preStaffingCheck: string;
};

export function computeSurfaceLayoutGate(
  fromTeamCount: number,
  toTeamCount: number
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

  return {
    fromTeamCount,
    toTeamCount,
    requiresNewColumn,
    requiresExecColumnSplit,
    requiresMoveOperations,
    preStaffingCheck: [
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
