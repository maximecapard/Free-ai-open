import { REDACTED_CIRCULAR_REFERENCE, REDACTED_FORBIDDEN_FIELD } from "./constants";
import { shouldRedactField } from "./field-rules";
import { redactString } from "./string-redactor";

export type RedactedJson =
  | string
  | number
  | boolean
  | null
  | undefined
  | RedactedJson[]
  | { [key: string]: RedactedJson };

function redactValue(input: unknown, seen: WeakSet<object>): RedactedJson {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return redactString(input);
  if (typeof input === "number" || typeof input === "boolean") return input;
  if (typeof input !== "object") return REDACTED_FORBIDDEN_FIELD;

  if (seen.has(input)) {
    return REDACTED_CIRCULAR_REFERENCE;
  }
  seen.add(input);

  if (Array.isArray(input)) {
    return input.map((item) => redactValue(item, seen));
  }

  const output: { [key: string]: RedactedJson } = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = shouldRedactField(key) ? REDACTED_FORBIDDEN_FIELD : redactValue(value, seen);
  }

  seen.delete(input);
  return output;
}

export function redactTelemetryPayload(input: unknown): RedactedJson {
  return redactValue(input, new WeakSet<object>());
}
