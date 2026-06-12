import type { WakeVerdict, PromptBudgetClass } from "../protocol/schemas.js";

export interface ClassifierInput {
  text: string;
  hash: string;
  prev_hash: string | null;
  elapsed_ms: number;
  now_ms: number;
  mandatory_audit_interval_ms: number;
  stale_threshold_ms: number;
  write_scope: string[];
  dirty_paths: string[];
  last_verdict: WakeVerdict | null;
  last_mandatory_audit_ts: number | null;
}

export interface ClassifierResult {
  verdict: WakeVerdict;
  wake: 0 | 1;
  reason_codes: string[];
  prompt_budget_class: PromptBudgetClass;
  dirty_out_of_scope: string[];
  last_marker: string | undefined;
}

// Approval markers: exact strings and regex for numbered interactive options
const APPROVAL_STRINGS = [
  "Proceed with the proposal",
  "Proceed with comment",
  "No and explain why",
  "Enter Select",
] as const;

const NUMBERED_OPTION_RE = /^\d+\.\s/m;

// Crash markers
const CRASH_STRINGS = [
  "panic",
  "stack trace",
  "program experienced a panic",
  "TUI run error",
  "fatal error",
] as const;

// Completion markers (order matters: QA_COMPLETE check before DEV_COMPLETE)
const QA_COMPLETE_STRINGS = ["QA COMPLETE", "QA_COMPLETE"] as const;
const DEV_COMPLETE_STRINGS = [
  "DEV_COMPLETE_QA_PENDING",
  "implementation complete",
  "ready for QA",
] as const;

// Blocker markers
const BLOCKER_STRINGS = [
  "BLOCKED",
  "cannot proceed",
  "missing",
  "permission denied",
  "need approval",
  "SPEC-AMENDMENT",
  "non-fast-forward",
] as const;

// Working state positive evidence: active spinner chars or streaming progress patterns
const WORKING_RE =
  /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|(?:\.\.\.|Running|Generating|Compiling|Building|Installing|Fetching|Downloading|Uploading|Processing|Streaming|Writing|Thinking)/;

function containsAny(text: string, markers: readonly string[]): string | null {
  for (const marker of markers) {
    if (text.includes(marker)) return marker;
  }
  return null;
}

/**
 * Classify a screen snapshot using 8 ordered rules (first-match wins).
 * Pure function — no I/O.
 */
export function classify(input: ClassifierInput): ClassifierResult {
  const {
    text,
    hash,
    prev_hash,
    elapsed_ms,
    now_ms,
    mandatory_audit_interval_ms,
    stale_threshold_ms,
    write_scope,
    dirty_paths,
    last_verdict,
    last_mandatory_audit_ts,
  } = input;

  const dirty_out_of_scope: string[] = [];

  // Compute out-of-scope dirty paths (used in rule 6)
  if (write_scope.length > 0) {
    for (const path of dirty_paths) {
      const inScope = write_scope.some(
        (scope) => path === scope || path.startsWith(scope + "/") || path.startsWith(scope)
      );
      if (!inScope) {
        dirty_out_of_scope.push(path);
      }
    }
  }

  // Rule 1: Mandatory audit due
  // elapsed since last mandatory audit >= interval → wake, preserve current verdict, budget=compact
  const auditElapsed =
    last_mandatory_audit_ts !== null
      ? now_ms - last_mandatory_audit_ts
      : elapsed_ms;
  if (auditElapsed >= mandatory_audit_interval_ms) {
    const preservedVerdict: WakeVerdict = last_verdict ?? "UNKNOWN_NEEDS_READ";
    return {
      verdict: preservedVerdict,
      wake: 1,
      reason_codes: ["MANDATORY_AUDIT interval elapsed"],
      prompt_budget_class: "compact",
      dirty_out_of_scope,
      last_marker: undefined,
    };
  }

  // Rule 2: Approval markers
  const approvalMarker = containsAny(text, APPROVAL_STRINGS);
  if (approvalMarker !== null || NUMBERED_OPTION_RE.test(text)) {
    const marker = approvalMarker ?? "numbered interactive option";
    return {
      verdict: "WAITING_APPROVAL",
      wake: 1,
      reason_codes: ["APPROVAL_MARKER"],
      prompt_budget_class: "diagnostic",
      dirty_out_of_scope,
      last_marker: marker,
    };
  }

  // Rule 3: Crash markers
  const crashMarker = containsAny(text, CRASH_STRINGS);
  if (crashMarker !== null) {
    return {
      verdict: "CRASHED",
      wake: 1,
      reason_codes: ["CRASH_MARKER"],
      prompt_budget_class: "forensic",
      dirty_out_of_scope,
      last_marker: crashMarker,
    };
  }

  // Rule 4: Completion markers (QA_COMPLETE checked before DEV_COMPLETE)
  const qaMarker = containsAny(text, QA_COMPLETE_STRINGS);
  if (qaMarker !== null) {
    return {
      verdict: "QA_COMPLETE",
      wake: 1,
      reason_codes: ["COMPLETION_MARKER"],
      prompt_budget_class: "compact",
      dirty_out_of_scope,
      last_marker: qaMarker,
    };
  }
  const devMarker = containsAny(text, DEV_COMPLETE_STRINGS);
  if (devMarker !== null) {
    return {
      verdict: "DEV_COMPLETE_QA_PENDING",
      wake: 1,
      reason_codes: ["COMPLETION_MARKER"],
      prompt_budget_class: "compact",
      dirty_out_of_scope,
      last_marker: devMarker,
    };
  }

  // Rule 5: Blocker markers
  const blockerMarker = containsAny(text, BLOCKER_STRINGS);
  if (blockerMarker !== null) {
    return {
      verdict: "BLOCKED",
      wake: 1,
      reason_codes: ["BLOCKER_MARKER"],
      prompt_budget_class: "diagnostic",
      dirty_out_of_scope,
      last_marker: blockerMarker,
    };
  }

  // Rule 6: Scope violation (dirty paths outside write_scope)
  if (dirty_out_of_scope.length > 0) {
    return {
      verdict: "BLOCKED",
      wake: 1,
      reason_codes: dirty_out_of_scope.map(
        (p) => `DIRTY_OUT_OF_SCOPE ${p}`
      ),
      prompt_budget_class: "diagnostic",
      dirty_out_of_scope,
      last_marker: undefined,
    };
  }

  // Rule 7: Stale hash (unchanged content beyond stale threshold)
  if (
    prev_hash !== null &&
    prev_hash === hash &&
    elapsed_ms > stale_threshold_ms
  ) {
    return {
      verdict: "IDLE",
      wake: 1,
      reason_codes: ["STALE_HASH"],
      prompt_budget_class: "compact",
      dirty_out_of_scope,
      last_marker: undefined,
    };
  }

  // Rule 8: All clear — WORKING requires positive evidence
  // Positive evidence: text contains active working indicators
  if (WORKING_RE.test(text)) {
    return {
      verdict: "WORKING",
      wake: 0,
      reason_codes: ["ALL_CLEAR"],
      prompt_budget_class: "silent",
      dirty_out_of_scope,
      last_marker: undefined,
    };
  }

  // Conservative bias: ambiguous (empty text with no stale trigger, or non-empty
  // without positive WORKING evidence) → UNKNOWN_NEEDS_READ, wake=1
  return {
    verdict: "UNKNOWN_NEEDS_READ",
    wake: 1,
    reason_codes: ["AMBIGUOUS_STATE"],
    prompt_budget_class: "compact",
    dirty_out_of_scope,
    last_marker: undefined,
  };
}
