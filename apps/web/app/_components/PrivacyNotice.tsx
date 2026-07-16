"use client";

import { useTranslations } from "../_i18n/LocaleContext";

export function PrivacyNotice() {
  const t = useTranslations();

  return <p className="privacy-notice">{t("privacy.notice")}</p>;
}
