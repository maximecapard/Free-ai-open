"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "../_i18n/LocaleContext";
import type { TranslationKey } from "../_i18n/dictionary";
import { useAppRuntime } from "../_runtime/AppRuntimeProvider";

export function GlobalRuntimeStatus() {
  const t = useTranslations();
  const pathname = usePathname();
  const { runtimeState, generation } = useAppRuntime();
  const isChatRoute = pathname?.startsWith("/chat") ?? false;
  const isGeneratingAwayFromChat =
    !isChatRoute && (runtimeState.status === "generating" || runtimeState.status === "cancelling");
  const shouldShow =
    runtimeState.status === "loading_model" ||
    runtimeState.status === "recovering" ||
    runtimeState.status === "error" ||
    isGeneratingAwayFromChat;

  if (!shouldShow) return null;

  const label =
    runtimeState.status === "loading_model"
      ? t("globalRuntime.loading", { progress: Math.round(runtimeState.loadProgress * 100) })
      : t(`globalRuntime.${runtimeState.status}` as TranslationKey);

  return (
    <div
      className={`global-runtime-status global-runtime-status--${runtimeState.status}`}
      role={runtimeState.status === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <span className="fo-status-dot" />
      <span>{label}</span>
      {isGeneratingAwayFromChat && generation.conversationId && (
        <Link href="/chat" className="global-runtime-status__action">
          {t("globalRuntime.returnToConversation")}
        </Link>
      )}
    </div>
  );
}
