import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { getDeviceTierDisplayLabel } from "@free-ai-open/device-profiler";
import type { PerformanceMode } from "@free-ai-open/types";
import { findModeLabel } from "../_lib/catalog";
import type { LastRuntimeStatus } from "../_lib/debugDiagnostics";
import { DebugField, DebugSection } from "./DebugSection";

const RUNTIME_STATUS_LABEL: Record<LastRuntimeStatus["status"], string> = {
  idle: "Not started",
  loading_model: "Loading model",
  ready: "Ready",
  generating: "Generating",
  cancelling: "Stopping",
  error: "Error",
};

export function DebugSystemStatus({
  deviceProfile,
  performanceMode,
  lastRuntimeStatus,
}: {
  deviceProfile: DeviceProfile | null;
  performanceMode: PerformanceMode;
  lastRuntimeStatus: LastRuntimeStatus | null;
}) {
  return (
    <DebugSection title="System status">
      {!deviceProfile ? (
        <p style={{ opacity: 0.6, fontSize: 14 }}>Checking device…</p>
      ) : (
        <>
          <DebugField label="WebGPU" value={deviceProfile.webgpuAvailable ? "Available" : "Not available"} />
          <DebugField label="Active backend" value={deviceProfile.preferredBackend} />
          <DebugField
            label="Device tier"
            value={`${deviceProfile.deviceTier} (${getDeviceTierDisplayLabel(deviceProfile.deviceTierLabel, deviceProfile.preferredBackend)})`}
          />
        </>
      )}
      <DebugField label="Performance mode (preview)" value={findModeLabel(performanceMode) ?? performanceMode} />
      <DebugField
        label="Runtime status"
        value={
          lastRuntimeStatus
            ? `${RUNTIME_STATUS_LABEL[lastRuntimeStatus.status]} (as of ${new Date(lastRuntimeStatus.timestamp).toLocaleString()})`
            : "No session recorded yet"
        }
      />
    </DebugSection>
  );
}
