"use client";

import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { getDeviceTierDisplayLabel } from "@free-ai-open/device-profiler";
import type { PerformanceMode } from "@free-ai-open/types";
import { findModeLabel } from "../_lib/catalog";
import type { LastRuntimeStatus } from "../_lib/debugDiagnostics";
import { DebugField, DebugSection } from "./DebugSection";
import { useTranslations } from "../_i18n/LocaleContext";
import type { TranslationKey } from "../_i18n/dictionary";

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
        <p style={{ opacity: 0.6, fontSize: 14 }}>{t("debug.checkingDevice")}</p>
      ) : (
        <>
          <DebugField
            label={t("debug.webgpu")}
            value={deviceProfile.webgpuAvailable ? t("debug.available") : t("debug.notAvailable")}
          />
          <DebugField label={t("debug.activeBackend")} value={deviceProfile.preferredBackend} />
          <DebugField
            label={t("debug.deviceTier")}
            value={`${deviceProfile.deviceTier} (${getDeviceTierDisplayLabel(deviceProfile.deviceTierLabel, deviceProfile.preferredBackend)})`}
          />
        </>
      )}
      <DebugField label={t("debug.performanceModePreview")} value={findModeLabel(performanceMode) ?? performanceMode} />
      <DebugField
        label={t("debug.runtimeStatusLabel")}
        value={
          lastRuntimeStatus
            ? t("debug.runtimeStatusAsOf", {
                status: t(`runtimeStatus.${lastRuntimeStatus.status}` as TranslationKey),
                timestamp: new Date(lastRuntimeStatus.timestamp).toLocaleString(),
              })
            : t("debug.noSessionRecorded")
        }
      />
    </DebugSection>
  );
}
