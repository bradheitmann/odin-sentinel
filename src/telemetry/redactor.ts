// Pre-redaction for outbound payloads. Strips or masks file-system paths,
// email addresses, token shapes, secret-bearing key/value text, and sensitive
// object fields. Intentionally conservative: over-redacts rather than under-redacts.

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
  /\bsk-(?:proj-)?[a-zA-Z0-9_-]{20,}\b/g,
  /\blin_api_[a-zA-Z0-9]{16,}\b/g,
  /\bghp_[a-zA-Z0-9]{20,}\b/g,
  /\bgho_[a-zA-Z0-9]{20,}\b/g,
  /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bxox[bp]-[a-zA-Z0-9-]{20,}\b/g,
  /\bdp\.st\.[a-zA-Z0-9._-]{16,}\b/g,
  /\bdp\.pt\.[a-zA-Z0-9._-]{16,}\b/g,
  /\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g
];

const AUTH_BEARER_RE = /\b(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+\/-]{8,}={0,2}\b/gi;
const BEARER_RE = /\b(Bearer\s+)[A-Za-z0-9._~+\/-]{8,}={0,2}\b/g;
const SENSITIVE_KEY_RE = /secret|token|api[_-]?key|apiKey|access[_-]?key|accessKey|private[_-]?key|privateKey|password|credential|authorization|client[_-]?secret|clientSecret/i;
const ENV_DUMP_LINE_RE = /^([A-Z][A-Z0-9_]{1,60}=).+$/gm;
const SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_.-]*(?:secret|token|api[_-]?key|apiKey|access[_-]?key|accessKey|private[_-]?key|privateKey|password|credential|client[_-]?secret|clientSecret)[A-Za-z0-9_.-]*\s*[:=]\s*)(["']?)(?!<)([^\s"',}]+)/gi;
const JSON_SECRET_RE = /("[^"]*(?:secret|token|apiKey|api_key|accessKey|access_key|privateKey|private_key|password|credential|authorization|clientSecret|client_secret)[^"]*"\s*:\s*)("[^"]*"|\d+|true|false|null)/gi;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

export function redactString(value: string): string {
  let result = value
    .replace(HOME_USERS_RE, "<HOME>")
    .replace(HOME_LINUX_RE, "<HOME>")
    .replace(HOME_WIN_RE, "<HOME>")
    .replace(EMAIL_RE, "<EMAIL>")
    .replace(AUTH_BEARER_RE, "$1<TOKEN>")
    .replace(BEARER_RE, "$1<TOKEN>")
    .replace(ENV_DUMP_LINE_RE, "$1<ENV_VALUE>")
    .replace(SECRET_ASSIGNMENT_RE, "$1$2<SECRET>")
    .replace(JSON_SECRET_RE, "$1" + '"<SECRET>"');
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
      result[key] = isSensitiveKey(key) ? "<SECRET>" : redactPayload(value);
    }
    return result as unknown as T;
  }
  return payload;
}
