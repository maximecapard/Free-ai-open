"use client";

import type { LocalLogRecord } from "@free-ai-open/local-logs";
import { DebugSection } from "./DebugSection";
import { useTranslations } from "../_i18n/LocaleContext";

const SEVERITY_COLOR_VAR: Record<LocalLogRecord["severity"], string> = {
  debug: "var(--fo-muted-500)",
  info: "var(--fo-muted-500)",
  warn: "var(--fo-warning)",
  error: "var(--fo-danger)",
  critical: "var(--fo-danger)",
};

export function DebugRecentLogs({ logs, logsAvailable }: { logs: LocalLogRecord[]; logsAvailable: boolean }) {
  const t = useTranslations();

  return (
    <DebugSection title={t("debug.recentLogs")}>
      {!logsAvailable ? (
        <p className="fo-muted" style={{ fontSize: 14 }}>
          {t("debug.logsUnavailable")}
        </p>
      ) : logs.length === 0 ? (
        <p className="fo-muted" style={{ fontSize: 14 }}>
          {t("debug.noEventsRecorded")}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {logs.map((log) => (
            <li key={log.id} className="fo-technical-value" style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "baseline" }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: SEVERITY_COLOR_VAR[log.severity],
                  flexShrink: 0,
                }}
              />
              <span className="fo-muted" style={{ whiteSpace: "nowrap" }}>
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span>{log.event}</span>
              {log.errorCode && <span className="fo-muted">— {log.errorCode}</span>}
            </li>
          ))}
        </ul>
      )}
    </DebugSection>
  );
}
