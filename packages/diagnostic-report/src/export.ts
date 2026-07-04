import { buildDiagnosticReport } from "./build";
import { validateDiagnosticReportPrivacy } from "./privacy";
import type { ClipboardDiagnosticReportData, DiagnosticReport, DiagnosticReportInput, DiagnosticReportOptions } from "./types";

function serializeReport(report: DiagnosticReport): string {
  const privacy = validateDiagnosticReportPrivacy(report);
  if (!privacy.valid || report.contentLogged !== false) {
    throw new Error("Diagnostic report failed privacy validation");
  }

  return JSON.stringify(report, null, 2);
}

export function exportDiagnosticReportAsJson(
  input: DiagnosticReportInput,
  options: DiagnosticReportOptions = {}
): string {
  return serializeReport(buildDiagnosticReport(input, options));
}

export function copyDiagnosticReportToClipboardData(
  input: DiagnosticReportInput,
  options: DiagnosticReportOptions = {}
): ClipboardDiagnosticReportData {
  const json = exportDiagnosticReportAsJson(input, options);
  return {
    "application/json": json,
    "text/plain": json,
  };
}
