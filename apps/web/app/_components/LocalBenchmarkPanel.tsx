"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalBenchmarkResult, StaticCapabilityProfile } from "@free-ai-open/types";
import type { TranslationKey } from "../_i18n/dictionary";
import { clearStoredLocalBenchmarkResult, getStoredLocalBenchmarkForProfile } from "../_lib/benchmarkResultStore";
import { runAndStoreLocalBenchmark } from "../_lib/localBenchmarkClient";
import { useLocale, useTranslations } from "../_i18n/LocaleContext";

export interface LocalBenchmarkPanelProps {
  profile: StaticCapabilityProfile;
  autoRun?: boolean;
  disabled?: boolean;
  onSettled?: () => void;
}

const STATUS_KEYS: Record<LocalBenchmarkResult["status"], TranslationKey> = {
  completed: "benchmark.status.completed",
  cancelled: "benchmark.status.cancelled",
  failed: "benchmark.status.failed",
  unsupported: "benchmark.status.unsupported",
};

const STABILITY_KEYS: Record<LocalBenchmarkResult["stability"], TranslationKey> = {
  unknown: "benchmark.stabilityValue.unknown",
  stable: "benchmark.stabilityValue.stable",
  degraded: "benchmark.stabilityValue.degraded",
  failed: "benchmark.stabilityValue.failed",
};

const CONFIDENCE_KEYS: Record<LocalBenchmarkResult["confidence"], TranslationKey> = {
  low: "benchmark.confidenceValue.low",
  medium: "benchmark.confidenceValue.medium",
  high: "benchmark.confidenceValue.high",
};

export function LocalBenchmarkPanel({ profile, autoRun = false, disabled = false, onSettled }: LocalBenchmarkPanelProps) {
  const t = useTranslations();
  const { locale } = useLocale();
  const initialRef = useRef(getStoredLocalBenchmarkForProfile(profile));
  const [result, setResult] = useState<LocalBenchmarkResult | null>(initialRef.current);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const autoStartedRef = useRef(false);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const run = useCallback(async (force: boolean) => {
    if (runningRef.current || disabled) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    setRunning(true);
    const measured = await runAndStoreLocalBenchmark(profile, { force, signal: controller.signal });
    setResult(measured.result);
    runningRef.current = false;
    setRunning(false);
    controllerRef.current = null;
    onSettledRef.current?.();
  }, [disabled, profile]);

  useEffect(() => {
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    if (autoRun && !initialRef.current && !autoStartedRef.current) {
      startTimer = setTimeout(() => {
        autoStartedRef.current = true;
        void run(false);
      }, 0);
    } else if (initialRef.current) {
      onSettledRef.current?.();
    }
    return () => {
      if (startTimer !== undefined) clearTimeout(startTimer);
      controllerRef.current?.abort();
    };
  }, [autoRun, run]);

  const status = running ? t("benchmark.running") : result ? t(STATUS_KEYS[result.status]) : t("benchmark.notRun");

  function handleClear() {
    clearStoredLocalBenchmarkResult();
    setResult(null);
    onSettledRef.current?.();
  }

  return (
    <section aria-labelledby="local-benchmark-title">
      <h2 id="local-benchmark-title" style={{ fontSize: 18, margin: "0 0 4px" }}>{t("benchmark.title")}</h2>
      <p className="fo-muted" style={{ margin: "0 0 12px", fontSize: 14 }}>{t("benchmark.description")}</p>
      <p role="status" style={{ margin: "0 0 12px", fontSize: 14 }}><strong>{status}</strong></p>
      {result?.status === "completed" && (
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: "0 0 12px" }}>
          <dt className="fo-muted">{t("benchmark.lastChecked")}</dt>
          <dd className="fo-technical-value">
            {new Date(result.measuredAt).toLocaleString(locale === "fr" ? "fr-FR" : "en-US")}
          </dd>
          <dt className="fo-muted">{t("benchmark.score")}</dt><dd className="fo-technical-value">{result.computeScore ?? t("common.unknown")}/100</dd>
          <dt className="fo-muted">{t("benchmark.stability")}</dt><dd className="fo-technical-value">{t(STABILITY_KEYS[result.stability])}</dd>
          <dt className="fo-muted">{t("benchmark.confidence")}</dt><dd className="fo-technical-value">{t(CONFIDENCE_KEYS[result.confidence])}</dd>
        </dl>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {running ? (
          <button type="button" className="fo-button fo-button-secondary" onClick={() => controllerRef.current?.abort()}>{t("benchmark.cancel")}</button>
        ) : (
          <button type="button" className="fo-button fo-button-secondary" disabled={disabled} onClick={() => void run(Boolean(result))}>
            {result ? t("benchmark.rerun") : t("benchmark.run")}
          </button>
        )}
        {!running && result && (
          <button type="button" className="fo-button fo-button-secondary" onClick={handleClear}>
            {t("benchmark.clear")}
          </button>
        )}
      </div>
      <p className="fo-muted" style={{ margin: "12px 0 0", fontSize: 12 }}>{t("benchmark.privacy")}</p>
    </section>
  );
}
