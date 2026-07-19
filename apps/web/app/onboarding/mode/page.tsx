"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_MODEL_ID } from "@free-ai-open/ai-runtime";
import type { DeviceProfile } from "@free-ai-open/device-profiler";
import { modelRegistryV2 } from "@free-ai-open/model-registry";
import type { PerformanceMode } from "@free-ai-open/types";
import { performanceModes } from "../../_lib/catalog";
import { detectAndStoreDeviceProfile } from "../../_lib/deviceProfileDetection";
import { getRecommendedPerformanceModeForProfile } from "../../_lib/deviceRecommendation";
import { completeGettingStarted } from "../../_lib/gettingStartedPreference";
import { formatApproximateDownloadSize } from "../../_lib/modelDownloadDisclosure";
import { localizedModelName } from "../../_lib/modelDisplayName";
import { useTranslations } from "../../_i18n/LocaleContext";

export default function OnboardingModePage() {
  const t = useTranslations();
  const router = useRouter();
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [isConfirming, setIsConfirming] = useState<PerformanceMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectAndStoreDeviceProfile().then((result) => {
      if (!cancelled) setProfile(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const recommendedModeId = profile ? getRecommendedPerformanceModeForProfile(profile) : null;
  // Quality mode is only offered when WebGPU is available: on a WASM/CPU-only
  // device it would not run acceptably, so it is left off rather than
  // dangling a choice that can't work here.
  const availableModes = performanceModes.filter((mode) => mode.id !== "performance" || profile?.webgpuAvailable);
  const initialModel = modelRegistryV2.find((record) => record.webllmModelId === DEFAULT_MODEL_ID);
  const initialSize = formatApproximateDownloadSize(initialModel?.downloadSize.value);

  function handleConfirm(mode: PerformanceMode) {
    if (isConfirming) return;
    setIsConfirming(mode);
    completeGettingStarted(
      mode,
      profile
        ? { deviceTier: profile.deviceTier, webgpuAvailable: profile.webgpuAvailable, formFactor: profile.formFactor }
        : null
    );
    router.push("/chat");
  }

  return (
    <main className="fo-container-narrow" style={{ padding: "48px 0" }}>
      <p className="fo-technical-label">{t("onboarding.step2")}</p>
      <h1 className="fo-page-title" style={{ marginTop: 8 }}>
        {t("onboarding.modeTitle")}
      </h1>
      <p className="fo-muted" style={{ margin: "0 0 24px", fontSize: 15 }}>
        {t("onboarding.modeIntro")}
      </p>

      {initialModel && initialSize && (
        <section className="fo-inline-notice" aria-labelledby="initial-model-download-title" style={{ marginBottom: 20 }}>
          <strong id="initial-model-download-title">{t("onboarding.initialDownloadTitle")}</strong>
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            {t("onboarding.initialDownloadBody", {
              model: localizedModelName(initialModel, t),
              size: `${initialSize.value} ${initialSize.unit}`,
            })}
          </p>
        </section>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {availableModes.map((mode) => {
          const isRecommended = mode.id === recommendedModeId;
          return (
            <button
              key={mode.id}
              type="button"
              className="fo-card"
              disabled={isConfirming !== null}
              onClick={() => handleConfirm(mode.id)}
              style={{
                padding: 16,
                textAlign: "left",
                borderColor: isRecommended ? "var(--fo-accent)" : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong>{t(mode.labelKey)}</strong>
                {isRecommended && (
                  <span className="fo-badge" style={{ borderColor: "var(--fo-accent)", color: "var(--fo-accent-text)" }}>
                    {t("modes.recommendedBadge")}
                  </span>
                )}
              </div>
              <p className="fo-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                {t(mode.descriptionKey)}
              </p>
            </button>
          );
        })}
      </div>

      <p className="fo-muted" style={{ marginTop: 24, fontSize: 13 }}>
        {t("onboarding.modeFooter")}
      </p>
    </main>
  );
}
