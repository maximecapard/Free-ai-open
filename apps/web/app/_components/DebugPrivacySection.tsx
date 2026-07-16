"use client";

import { PrivacyNotice } from "./PrivacyNotice";
import { DebugField, DebugSection } from "./DebugSection";
import { useTranslations } from "../_i18n/LocaleContext";

export function DebugPrivacySection({ contentLogged }: { contentLogged: boolean | null }) {
  const t = useTranslations();

  return (
    <DebugSection title={t("debug.privacyTitle")}>
      <PrivacyNotice />
      <p className="fo-muted" style={{ fontSize: 13, margin: "8px 0" }}>
        {t("debug.privacyBody")}
      </p>
      <DebugField label="contentLogged" value={contentLogged === null ? "—" : String(contentLogged)} technical />
    </DebugSection>
  );
}
