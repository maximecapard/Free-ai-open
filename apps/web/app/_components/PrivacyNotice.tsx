"use client";

import { useTranslations } from "../_i18n/LocaleContext";

export function PrivacyNotice() {
  const t = useTranslations();

  return <p style={{ fontSize: 13, opacity: 0.65, lineHeight: 1.5 }}>{t("privacy.notice")}</p>;
}
