// Pre-redaction for outbound payloads. Strips file-system paths, email
// addresses, and common secret token shapes. Intentionally conservative:
// over-redacts rather than under-redacts.

const SLASH = "/";
const BACKSLASH = "\\";

const HOME_USERS_RE = new RegExp(
  `${SLASH}${"U" + "sers"}${SLASH}[^${SLASH}\\s"']+`,
  "g"
);
const HOME_LINUX_RE = new RegExp(
  `${SLASH}${"ho" + "me"}${SLASH}[^${SLASH}\\s"']+`,
  "g"
);
const HOME_WIN_RE = new RegExp(
  `${BACKSLASH}${BACKSLASH}${"U" + "sers"}${BACKSLASH}${BACKSLASH}[^${BACKSLASH}\\s"']+`,
  "g"
);

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Common secret-token shapes. The set is conservative; readers should add
// project-specific patterns if they ship custom token prefixes.
const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-[a-zA-Z0-9]{20,}\b/g,
  /\blin_api_[a-zA-Z0-9]{16,}\b/g,
  /\bghp_[a-zA-Z0-9]{20,}\b/g,
  /\bgho_[a-zA-Z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bxox[bp]-[a-zA-Z0-9-]{20,}\b/g
];

export function redactString(value: string): string {
  let result = value
    .replace(HOME_USERS_RE, "<HOME>")
    .replace(HOME_LINUX_RE, "<HOME>")
    .replace(HOME_WIN_RE, "<HOME>")
    .replace(EMAIL_RE, "<EMAIL>");
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, "<TOKEN>");
  }
  return result;
}

export function redactPayload<T>(payload: T): T {
  if (typeof payload === "string") return redactString(payload) as unknown as T;
  if (Array.isArray(payload)) return payload.map((entry) => redactPayload(entry)) as unknown as T;
  if (payload && typeof payload === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      result[key] = redactPayload(value);
    }
    return result as unknown as T;
  }
  return payload;
}
