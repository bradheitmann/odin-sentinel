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
