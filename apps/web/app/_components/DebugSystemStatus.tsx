"use client";

import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { getDeviceTierDisplayLabel } from "@free-ai-open/device-profiler";
import type { RuntimeState } from "@free-ai-open/ai-runtime";
import type { PerformanceMode } from "@free-ai-open/types";
import { findModeLabelKey } from "../_lib/catalog";
import { DebugField, DebugSection } from "./DebugSection";
import { useTranslations } from "../_i18n/LocaleContext";

export function DebugSystemStatus({
  deviceProfile,
  performanceMode,
  runtimeStatus,
}: {
  deviceProfile: DeviceProfile | null;
  performanceMode: PerformanceMode | null;
  runtimeStatus: RuntimeState["status"];
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
        value={performanceMode ? t(findModeLabelKey(performanceMode) ?? "modes.balanced.label") : t("common.unknown")}
      />
      <DebugField
        label={t("debug.runtimeStatusLabel")}
        value={runtimeStatus}
        technical
      />
    </DebugSection>
  );
}
