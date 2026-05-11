import { z } from "zod";

export const startupPacketInputShape = {
  role: z.string().optional(),
  pods: z.number().int().min(0).max(25).optional(),
  repoPath: z.string().optional(),
  handoffPaths: z.array(z.string()).optional(),
  userInstruction: z.string().optional()
} as const;

export const startupPacketInputSchema = z.object(startupPacketInputShape);
export type StartupPacketInput = z.infer<typeof startupPacketInputSchema>;

export const delegationPacketInputShape = {
  sourceRole: z.string(),
  targetRoleSlot: z.string(),
  task: z.string(),
  scope: z.string().optional(),
  mayImplement: z.boolean().optional(),
  mayQaAccept: z.boolean().optional(),
  writeScope: z.array(z.string()).optional(),
  readScope: z.array(z.string()).optional(),
  prohibitedPaths: z.array(z.string()).optional(),
  reportBack: z.string().optional()
} as const;

export const delegationPacketInputSchema = z.object(delegationPacketInputShape);
export type DelegationPacketInput = z.infer<typeof delegationPacketInputSchema>;

export const recordInputShape = {
  packet: z.record(z.string(), z.unknown())
} as const;

export const roleProfileInputShape = {
  role: z.string()
} as const;

export const bootReceiptInputShape = {
  receipt: z.record(z.string(), z.unknown())
} as const;

export const teamManifestInputShape = {
  manifest: z.record(z.string(), z.unknown())
} as const;

export const closeoutModeSchema = z.enum(["PARK_FOR_CONTINUITY", "FULL_SESSION_SHUTDOWN"]);
export type CloseoutMode = z.infer<typeof closeoutModeSchema>;

export const closeoutChecklistInputShape = {
  mode: closeoutModeSchema
} as const;

export const surfaceLayoutInputShape = {
  teamCount: z.number().int().min(0).max(26)
} as const;

export const surfaceLayoutGateInputShape = {
  fromTeamCount: z.number().int().min(0).max(26),
  toTeamCount: z.number().int().min(1).max(26)
} as const;

export const sessionReportInputShape = {
  teamCount: z.number().int().min(0).max(26),
  violations: z.array(
    z.object({
      class: z.string(),
      description: z.string().optional()
    })
  ),
  halts: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      trigger: z.string()
    })
  ),
  layoutDriftEvents: z.number().int().min(0),
  peakContextPct: z.number().int().min(0).max(100),
  closeoutClean: z.boolean(),
  modelSignals: z.array(
    z.object({
      role: z.string(),
      model: z.string(),
      violations: z.number().int().min(0)
    })
  )
} as const;

export const reportRecordInputShape = {
  report: z.record(z.string(), z.unknown())
} as const;
