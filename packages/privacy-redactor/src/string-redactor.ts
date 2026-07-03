import {
  MAX_SAFE_STRING_LENGTH,
  REDACTED_EMAIL,
  REDACTED_JWT,
  REDACTED_LONG_STRING,
  REDACTED_PHONE,
  REDACTED_SECRET,
} from "./constants";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi;
const KNOWN_SECRET_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|pk_[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|hf_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})\b/g;
const KEY_VALUE_SECRET_PATTERN =
  /\b(api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|session[_-]?token|authorization|password)\b\s*[:=]\s*["']?[^\s"',;{}]{8,}/gi;
const PHONE_CANDIDATE_PATTERN = /(?<![A-Za-z0-9])\+?\d[\d().\-\s]{7,}\d(?![A-Za-z0-9])/g;

function redactPhoneCandidate(candidate: string): string {
  const digitCount = candidate.replace(/\D/g, "").length;
  if (digitCount < 10 || digitCount > 15) {
    return candidate;
  }

  return REDACTED_PHONE;
}

export function redactString(value: string): string {
  if (value.length > MAX_SAFE_STRING_LENGTH) {
    return REDACTED_LONG_STRING;
  }

  return value
    .replace(JWT_PATTERN, REDACTED_JWT)
    .replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED_SECRET}`)
    .replace(KNOWN_SECRET_PATTERN, REDACTED_SECRET)
    .replace(KEY_VALUE_SECRET_PATTERN, (match, label: string) => `${label}=${REDACTED_SECRET}`)
    .replace(EMAIL_PATTERN, REDACTED_EMAIL)
    .replace(PHONE_CANDIDATE_PATTERN, redactPhoneCandidate);
}
