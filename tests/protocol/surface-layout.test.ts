import { describe, expect, it } from "vitest";
import {
  computeSurfaceLayout,
  computeSurfaceLayoutGate,
  renderSurfaceLayoutAscii
} from "../../src/protocol/surface-layout.js";

describe("computeSurfaceLayout", () => {
  it("returns an empty layout for teamCount=0", () => {
    const layout = computeSurfaceLayout(0);
    expect(layout.teamCount).toBe(0);
    expect(layout.totalColumns).toBe(0);
    expect(layout.columns).toEqual([]);
    expect(layout.isBalanced).toBe(true);
    expect(layout.execColumnIsTall).toBe(false);
  });

  it("places only Team A at teamCount=1", () => {
    const layout = computeSurfaceLayout(1);
    expect(layout.totalColumns).toBe(1);
    expect(layout.columns[0].surfaces).toEqual([{ rowIndex: 0, team: "A", isExec: true }]);
    expect(layout.isBalanced).toBe(true);
    expect(layout.execColumnIsTall).toBe(false);
  });

  it("places A and B in separate columns at teamCount=2", () => {
    const layout = computeSurfaceLayout(2);
    expect(layout.totalColumns).toBe(2);
    expect(renderSurfaceLayoutAscii(layout)).toBe("[A] [B]");
    expect(layout.isBalanced).toBe(true);
    expect(layout.execColumnIsTall).toBe(false);
  });

  it("keeps A alone (tall) and stacks B,C in the right column at teamCount=3", () => {
    const layout = computeSurfaceLayout(3);
    expect(renderSurfaceLayoutAscii(layout)).toBe("[A] [B/C]");
    expect(layout.isBalanced).toBe(false);
    expect(layout.execColumnIsTall).toBe(true);
    expect(layout.columns[0].surfaces).toEqual([{ rowIndex: 0, team: "A", isExec: true }]);
    expect(layout.columns[1].surfaces.map((s) => s.team)).toEqual(["B", "C"]);
  });

  it("pairs A with D when teamCount=4 (A's column gets densified)", () => {
    const layout = computeSurfaceLayout(4);
    expect(renderSurfaceLayoutAscii(layout)).toBe("[A/D] [B/C]");
    expect(layout.isBalanced).toBe(true);
    expect(layout.execColumnIsTall).toBe(false);
  });

  it("opens a new column and returns A to the tall position at teamCount=5", () => {
    const layout = computeSurfaceLayout(5);
    expect(renderSurfaceLayoutAscii(layout)).toBe("[A] [B/C] [D/E]");
    expect(layout.isBalanced).toBe(false);
    expect(layout.execColumnIsTall).toBe(true);
  });

  it("balances all columns at teamCount=6 with F joining A", () => {
    const layout = computeSurfaceLayout(6);
    expect(renderSurfaceLayoutAscii(layout)).toBe("[A/F] [B/C] [D/E]");
    expect(layout.isBalanced).toBe(true);
    expect(layout.execColumnIsTall).toBe(false);
  });

  it("returns A to the tall column at teamCount=7", () => {
    const layout = computeSurfaceLayout(7);
    expect(renderSurfaceLayoutAscii(layout)).toBe("[A] [B/C] [D/E] [F/G]");
    expect(layout.execColumnIsTall).toBe(true);
  });

  it("balances all columns at teamCount=8", () => {
    const layout = computeSurfaceLayout(8);
    expect(renderSurfaceLayoutAscii(layout)).toBe("[A/H] [B/C] [D/E] [F/G]");
    expect(layout.isBalanced).toBe(true);
    expect(layout.execColumnIsTall).toBe(false);
  });

  it("scales monotonically: every team appears exactly once for N=1..16", () => {
    for (let n = 1; n <= 16; n++) {
      const layout = computeSurfaceLayout(n);
      const teams = layout.columns.flatMap((column) => column.surfaces.map((s) => s.team));
      expect(teams).toHaveLength(n);
      expect(new Set(teams).size).toBe(n);
      expect(teams).toContain("A");
    }
  });

  it("respects max 2 surfaces per column for N=1..16", () => {
    for (let n = 1; n <= 16; n++) {
      const layout = computeSurfaceLayout(n);
      for (const column of layout.columns) {
        expect(column.surfaces.length).toBeLessThanOrEqual(2);
        expect(column.surfaces.length).toBeGreaterThan(0);
      }
    }
  });

  it("always places A at columnIndex 0 row 0", () => {
    for (let n = 1; n <= 16; n++) {
      const layout = computeSurfaceLayout(n);
      expect(layout.columns[0].columnIndex).toBe(0);
      expect(layout.columns[0].surfaces[0]).toEqual({ rowIndex: 0, team: "A", isExec: true });
    }
  });

  it("only marks the exec column tall when team count is odd and >= 3", () => {
    for (let n = 1; n <= 16; n++) {
      const layout = computeSurfaceLayout(n);
      const expectTall = n >= 3 && n % 2 === 1;
      expect(layout.execColumnIsTall).toBe(expectTall);
    }
  });

  it("supports the maximum of 26 teams", () => {
    const layout = computeSurfaceLayout(26);
    expect(layout.totalColumns).toBe(13);
    expect(layout.columns.every((column) => column.surfaces.length === 2)).toBe(true);
  });

  it("throws on negative, non-integer, or oversized inputs", () => {
    expect(() => computeSurfaceLayout(-1)).toThrow(/non-negative/);
    expect(() => computeSurfaceLayout(1.5)).toThrow(/integer/);
    expect(() => computeSurfaceLayout(27)).toThrow(/exceeds/);
  });
});

describe("computeSurfaceLayoutGate", () => {
  it("requires a new column when growing from 4 to 5 teams", () => {
    const gate = computeSurfaceLayoutGate(4, 5);
    expect(gate.requiresNewColumn).toBe(true);
    expect(gate.preStaffingCheck).toContain("new-split right");
  });

  it("requires an exec column split when growing from 3 to 4 teams", () => {
    const gate = computeSurfaceLayoutGate(3, 4);
    expect(gate.requiresNewColumn).toBe(false);
    expect(gate.requiresExecColumnSplit).toBe(true);
    expect(gate.preStaffingCheck).toContain("Split A's column");
  });

  it("requires a new column when growing from 1 to 2 teams", () => {
    const gate = computeSurfaceLayoutGate(1, 2);
    expect(gate.requiresNewColumn).toBe(true);
  });

  it("rejects gates where toTeamCount is not greater than fromTeamCount", () => {
    expect(() => computeSurfaceLayoutGate(4, 4)).toThrow(/toTeamCount/);
    expect(() => computeSurfaceLayoutGate(4, 3)).toThrow(/toTeamCount/);
  });
});
