import { redactTelemetryPayload } from "@free-ai-open/privacy-redactor";
import type { DiagnosticReportPrivacyResult } from "./types";

const FORBIDDEN_FIELD_NAMES = new Set([
  "prompt",
  "response",
  "messages",
  "message",
  "conversation",
  "document",
  "documentcontent",
  "filecontent",
  "usertext",
  "inputtext",
  "outputtext",
  "chathistory",
]);

const FORBIDDEN_FIELD_PARTS = ["prompt", "response", "documentcontent", "filecontent", "usertext", "inputtext", "outputtext", "chathistory"];
const REDACTION_MARKERS = ["[FORBIDDEN_FIELD_REMOVED]", "[REDACTED_LONG_STRING]"];

function normalizeFieldName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inspect(value: unknown, path: string, violations: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspect(item, `${path}[${index}]`, violations));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalized = normalizeFieldName(key);
      if (FORBIDDEN_FIELD_NAMES.has(normalized) || FORBIDDEN_FIELD_PARTS.some((part) => normalized.includes(part))) {
        violations.push(`${path}.${key}`);
      }
      inspect(child, `${path}.${key}`, violations);
    }
    return;
  }

  if (typeof value === "string" && REDACTION_MARKERS.some((marker) => value.includes(marker))) {
    violations.push(path);
  }
}

export function redactDiagnosticInput(input: unknown): unknown {
  return redactTelemetryPayload(input);
}

export function validateDiagnosticReportPrivacy(report: unknown): DiagnosticReportPrivacyResult {
  const violations: string[] = [];
  inspect(report, "report", violations);
  return {
    valid: violations.length === 0,
    violations,
  };
}
