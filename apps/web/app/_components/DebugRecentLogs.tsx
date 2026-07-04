import type { LocalLogRecord } from "@free-ai-open/local-logs";
import { DebugSection } from "./DebugSection";

const SEVERITY_COLOR: Record<LocalLogRecord["severity"], string> = {
  debug: "#888",
  info: "#888",
  warn: "#e5a53e",
  error: "#e5484d",
  critical: "#e5484d",
};

export function DebugRecentLogs({ logs, logsAvailable }: { logs: LocalLogRecord[]; logsAvailable: boolean }) {
  return (
    <DebugSection title="Recent technical logs">
      {!logsAvailable ? (
        <p style={{ fontSize: 14, opacity: 0.75 }}>
          Local log storage (IndexedDB) isn&apos;t available in this browser, so no history can be shown here.
        </p>
      ) : logs.length === 0 ? (
        <p style={{ fontSize: 14, opacity: 0.6 }}>No technical events recorded yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {logs.map((log) => (
            <li key={log.id} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: SEVERITY_COLOR[log.severity], flexShrink: 0 }} />
              <span style={{ opacity: 0.6, whiteSpace: "nowrap" }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span>{log.event}</span>
              {log.errorCode && <span style={{ opacity: 0.75 }}>— {log.errorCode}</span>}
            </li>
          ))}
        </ul>
      )}
    </DebugSection>
  );
}
