export type ViolationEntry = {
  class: string;
  description?: string;
};

export type HaltEntry = {
  source: string;
  target: string;
  trigger: string;
};

export type ModelSignal = {
  role: string;
  model: string;
  violations: number;
};

export type SessionReportInput = {
  teamCount: number;
  violations: ViolationEntry[];
  halts: HaltEntry[];
  layoutDriftEvents: number;
  peakContextPct: number;
  closeoutClean: boolean;
  modelSignals: ModelSignal[];
};

export type SessionReport = SessionReportInput & {
  version: string;
  compiledAt: string;
  violationCount: number;
  haltCount: number;
};

export function compileSessionReport(input: SessionReportInput, version: string): SessionReport {
  return {
    ...input,
    version,
    compiledAt: new Date().toISOString(),
    violationCount: input.violations.length,
    haltCount: input.halts.length
  };
}
