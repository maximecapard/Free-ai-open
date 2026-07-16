"use client";

import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { getDeviceTierDisplayLabel } from "@free-ai-open/device-profiler";
import type { PerformanceMode } from "@free-ai-open/types";
import { findModeLabelKey } from "../_lib/catalog";
import type { LastRuntimeStatus } from "../_lib/debugDiagnostics";
import { DebugField, DebugSection } from "./DebugSection";
import { useTranslations } from "../_i18n/LocaleContext";

export function DebugSystemStatus({
  deviceProfile,
  performanceMode,
  lastRuntimeStatus,
}: {
  deviceProfile: DeviceProfile | null;
  performanceMode: PerformanceMode;
  lastRuntimeStatus: LastRuntimeStatus | null;
}) {
  const t = useTranslations();

  return (
    <DebugSection title={t("debug.systemStatus")}>
      {!deviceProfile ? (
        <p className="fo-muted" style={{ fontSize: 14 }}>
          {t("debug.checkingDevice")}
        </p>
      ) : (
        <>
          <DebugField
            label={t("debug.webgpu")}
            value={deviceProfile.webgpuAvailable ? t("debug.available") : t("debug.notAvailable")}
          />
          <DebugField label={t("debug.activeBackend")} value={deviceProfile.preferredBackend} technical />
          <DebugField
            label={t("debug.deviceTier")}
            value={`${deviceProfile.deviceTier} (${getDeviceTierDisplayLabel(deviceProfile.deviceTierLabel, deviceProfile.preferredBackend)})`}
            technical
          />
          <DebugField label={t("debug.formFactor")} value={deviceProfile.formFactor} technical />
        </>
      )}
      <DebugField
        label={t("debug.performanceModePreview")}
        value={t(findModeLabelKey(performanceMode) ?? "modes.balanced.label")}
      />
      <DebugField
        label={t("debug.runtimeStatusLabel")}
        value={
          lastRuntimeStatus
            ? t("debug.runtimeStatusAsOf", {
                status: lastRuntimeStatus.status,
                timestamp: new Date(lastRuntimeStatus.timestamp).toLocaleString(),
              })
            : t("debug.noSessionRecorded")
        }
        technical={Boolean(lastRuntimeStatus)}
      />
    </DebugSection>
  );
}
