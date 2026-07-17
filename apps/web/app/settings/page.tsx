"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_MODEL_ID } from "@free-ai-open/ai-runtime";
import type { DeviceProfile } from "@free-ai-open/device-profiler";
import type { PerformanceMode } from "@free-ai-open/types";
import { DeviceCapabilitySummary } from "../_components/DeviceCapabilitySummary";
import { performanceModes } from "../_lib/catalog";
import { detectAndStoreDeviceProfile } from "../_lib/deviceProfileDetection";
import { resetGettingStarted } from "../_lib/gettingStartedPreference";
import { isPerformanceModeChangeBlockedStatus } from "../_lib/performanceModeRuntimePolicy";
import { LanguageToggle } from "../_i18n/LanguageToggle";
import { useTranslations } from "../_i18n/LocaleContext";
import { ThemeToggle } from "../_theme/ThemeToggle";
import { useAppRuntime } from "../_runtime/AppRuntimeProvider";

export default function SettingsPage() {
  const t = useTranslations();
  const router = useRouter();
  const { runtimeState, performanceMode: savedMode, applyPerformanceMode } = useAppRuntime();
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [pendingMode, setPendingMode] = useState<PerformanceMode | null>(null);
  const [modeSavedNotice, setModeSavedNotice] = useState(false);
  const [modeBlockedNotice, setModeBlockedNotice] = useState(false);
  const [isResetConfirming, setIsResetConfirming] = useState(false);

  useEffect(() => {
    detectAndStoreDeviceProfile().then(setProfile);
  }, []);

  const availableModes = performanceModes.filter((mode) => mode.id !== "performance" || profile?.webgpuAvailable);
  const selectedMode = pendingMode ?? savedMode;
  const hasPendingMode = pendingMode !== null && pendingMode !== savedMode;
  const performanceChangeBlocked = hasPendingMode && isPerformanceModeChangeBlockedStatus(runtimeState.status);

  function handlePick(mode: PerformanceMode) {
    setModeSavedNotice(false);
    setModeBlockedNotice(false);
    setPendingMode(mode);
  }

  async function handleSaveMode() {
    if (!pendingMode || pendingMode === savedMode) return;
    const result = await applyPerformanceMode(pendingMode);
    if (!result.ok) {
      setModeSavedNotice(false);
      setModeBlockedNotice(result.blockedReason === "active_generation");
      return;
    }

    setPendingMode(null);
    setModeBlockedNotice(false);
    setModeSavedNotice(true);
  }

  function handleRecheckDevice() {
    setProfile(null);
    detectAndStoreDeviceProfile().then(setProfile);
  }

  function handleResetGettingStarted() {
    resetGettingStarted();
    router.push("/onboarding");
  }

  return (
    <main className="fo-container-narrow" style={{ padding: "48px 0" }}>
      <h1 className="fo-page-title">{t("settings.title")}</h1>
      <p className="fo-muted" style={{ lineHeight: 1.6, fontSize: 16, marginBottom: 32 }}>
        {t("settings.body")}
      </p>

      <section className="fo-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>{t("settings.performanceHeading")}</h2>
        <p className="fo-muted" style={{ margin: "0 0 16px", fontSize: 14 }}>
          {t("settings.performanceBody")}
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          {availableModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className="fo-card"
              onClick={() => handlePick(mode.id)}
              style={{
                padding: 14,
                textAlign: "left",
                borderColor: selectedMode === mode.id ? "var(--fo-accent)" : undefined,
                background: selectedMode === mode.id ? "var(--fo-accent-soft)" : undefined,
              }}
              aria-pressed={selectedMode === mode.id}
            >
              <strong>{t(mode.labelKey)}</strong>
              <p className="fo-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                {t(mode.descriptionKey)}
              </p>
            </button>
          ))}
        </div>

        <p className="fo-muted" style={{ margin: "12px 0 0", fontSize: 12 }}>
          {t("settings.performanceHint")}
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
          <button
            type="button"
            className="fo-button fo-button-primary"
            onClick={handleSaveMode}
            disabled={!hasPendingMode || performanceChangeBlocked}
          >
            {t("settings.performanceSave")}
          </button>
          {modeSavedNotice && (
            <span role="status" className="fo-muted" style={{ fontSize: 13 }}>
              {t("settings.performanceSaved")}
            </span>
          )}
        </div>
        {(performanceChangeBlocked || modeBlockedNotice) && (
          <p role="status" className="fo-muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
            {t("settings.performanceBlockedWhileGenerating")}
          </p>
        )}
      </section>

      <section className="fo-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>{t("settings.languageHeading")}</h2>
        <LanguageToggle />
      </section>

      <section className="fo-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>{t("settings.themeHeading")}</h2>
        <ThemeToggle />
      </section>

      <section className="fo-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>{t("settings.deviceHeading")}</h2>
        <div style={{ margin: "8px 0 16px" }}>
          <DeviceCapabilitySummary profile={profile} />
        </div>
        <button type="button" className="fo-button fo-button-secondary" onClick={handleRecheckDevice}>
          {t("settings.recheckDevice")}
        </button>
      </section>

      <section className="fo-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>{t("settings.resetHeading")}</h2>
        <p className="fo-muted" style={{ margin: "0 0 12px", fontSize: 14 }}>
          {t("settings.resetBody")}
        </p>
        {isResetConfirming ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 14 }}>{t("settings.resetConfirm")}</span>
            <button type="button" className="fo-button fo-button-secondary" onClick={handleResetGettingStarted}>
              {t("common.yes")}
            </button>
            <button type="button" className="fo-button fo-button-secondary" onClick={() => setIsResetConfirming(false)}>
              {t("common.cancel")}
            </button>
          </div>
        ) : (
          <button type="button" className="fo-button fo-button-secondary" onClick={() => setIsResetConfirming(true)}>
            {t("settings.resetButton")}
          </button>
        )}
      </section>

      <details className="fo-card" style={{ padding: 20 }}>
        <summary className="fo-muted" style={{ cursor: "pointer", fontSize: 14 }}>
          {t("onboarding.advancedDetails")}
        </summary>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", marginTop: 12 }}>
          <dt className="fo-muted">{t("settings.exactMode")}</dt>
          <dd className="fo-technical-value">{savedMode ?? t("common.unknown")}</dd>
          <dt className="fo-muted">{t("settings.modelId")}</dt>
          <dd className="fo-technical-value">{DEFAULT_MODEL_ID}</dd>
          <dt className="fo-muted">{t("onboarding.preferredBackend")}</dt>
          <dd className="fo-technical-value">{profile?.preferredBackend ?? t("common.unknown")}</dd>
          <dt className="fo-muted">{t("onboarding.deviceTier")}</dt>
          <dd className="fo-technical-value">{profile ? profile.deviceTier : t("common.unknown")}</dd>
        </dl>
      </details>
    </main>
  );
}
