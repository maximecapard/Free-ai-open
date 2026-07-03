const FORBIDDEN_FIELDS = new Set([
  "prompt",
  "response",
  "message",
  "messages",
  "document",
  "documentContent",
  "chatHistory",
  "apiKey",
  "accessToken",
  "refreshToken",
]);

export function redactString(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:sk-|pk_)[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .slice(0, 2000);
}

export function redactTelemetryPayload(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return redactString(input);
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(redactTelemetryPayload);

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      output[key] = "[FORBIDDEN_FIELD_REMOVED]";
      continue;
    }
    output[key] = redactTelemetryPayload(value);
  }
  return output;
}
