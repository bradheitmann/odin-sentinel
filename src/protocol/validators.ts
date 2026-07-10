export type ValidationResult = {
  valid: boolean;
  missing: string[];
  invalid: string[];
  warnings: string[];
};

type FieldKind = "string" | "boolean" | "string_array" | "object";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`Invalid protocol data: ${label} must be an object`);
}

export function requireStringArray(value: unknown, label: string): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "")) {
    return value;
  }

  throw new Error(`Invalid protocol data: ${label} must be a string array`);
}

export function buildValidationResult(
  missing: string[],
  invalid: string[],
  warnings: string[] = []
): ValidationResult {
  return {
    valid: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    warnings
  };
}

export function validateRequiredFields(value: Record<string, unknown>, requiredFields: string[]): string[] {
  return requiredFields.filter((field) => {
    const current = value[field];
    if (current === undefined || current === null) return true;
    if (typeof current === "string" && current.trim() === "") return true;
    return false;
  });
}

export function validateFieldTypes(value: Record<string, unknown>, expected: Record<string, FieldKind>): string[] {
  return Object.entries(expected)
    .filter(([field, kind]) => {
      if (!(field in value) || value[field] === undefined || value[field] === null) return false;
      const current = value[field];
      if (kind === "string") return typeof current !== "string" || current.trim() === "";
      if (kind === "boolean") return typeof current !== "boolean";
      if (kind === "string_array") return !Array.isArray(current) || current.some((item) => typeof item !== "string" || item.trim() === "");
      return typeof current !== "object" || Array.isArray(current);
    })
    .map(([field]) => field);
}

export function validateNonEmptyArrays(value: Record<string, unknown>, fields: string[]): string[] {
  return fields.filter((field) => Array.isArray(value[field]) && value[field].length === 0);
}

export function isVisibleRoleSlot(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9_-]*\/[A-Z0-9][A-Z0-9_-]*(?:-\d+)?$/.test(value);
}

export function compareSemver(left: string, right: string): number {
  const normalize = (value: string) =>
    value
      .trim()
      .replace(/^v/i, "")
      .split(".")
      .map((part) => {
        const parsed = Number.parseInt(part.replace(/[^0-9].*$/, ""), 10);
        return Number.isFinite(parsed) ? parsed : 0;
      });
  const a = normalize(left);
  const b = normalize(right);
  const length = Math.max(a.length, b.length, 3);
  for (let i = 0; i < length; i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function isVersionBelow(version: string, minimum: string): boolean {
  return compareSemver(version, minimum) < 0;
}

export function redactSecretLikeText(value: string): string {
  return value
    .replace(/(sk|pk|ghp|gho|ghu|github_pat|xox[baprs])-?[A-Za-z0-9_=-]{8,}/gi, "[REDACTED]")
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*=)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._=-]+/gi, "$1[REDACTED]");
}

// EPIC-026/028/031 holdout-facing validator surfaces. The sealed holdouts import
// this compiled module (./dist/src/protocol/validators.js) and call these names
// directly; the canonical implementations live in service.ts and are re-exported
// here so the holdout's import path resolves. These re-exports are lazy live
// bindings (function declarations are hoisted), so the validators <-> service
// module pair resolves safely at call time.
export {
  validateHarnessControlRecipe,
  validateDeliveryVerification,
  evaluateOversizedSliceSentinel,
  evaluateQaTimeoutSentinel,
  evaluateSpecDefectSentinel
} from "./service.js";
