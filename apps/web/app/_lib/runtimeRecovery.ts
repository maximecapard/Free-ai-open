import { addLocalLog } from "@free-ai-open/local-logs";
import { createLogEvent, logEvent } from "@free-ai-open/logger";
import type { RuntimeStatus } from "@free-ai-open/ai-runtime";

export type RuntimeRecoveryEvent = "runtime.recovery.started" | "runtime.recovery.completed" | "runtime.recovery.failed";

export function recordRuntimeRecoveryEvent(
  event: RuntimeRecoveryEvent,
  severity: "info" | "error",
  runtimeStatus: RuntimeStatus,
  errorCode?: string
): void {
  logEvent(createLogEvent(event, severity, errorCode ? { errorCode } : {}));
  void addLocalLog({
    event,
    severity,
    runtimeStatus,
    errorCode,
  });
}
