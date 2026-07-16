"use client";

import { useTranslations } from "../_i18n/LocaleContext";

const sponsorsUrl = process.env.NEXT_PUBLIC_GITHUB_SPONSORS_URL;
const coffeeUrl = process.env.NEXT_PUBLIC_BUY_ME_A_COFFEE_URL;

export function Footer() {
  const t = useTranslations();

  return (
    <footer className="app-footer">
      <span>{t("footer.tagline")}</span>
      {(sponsorsUrl || coffeeUrl) && (
        <span className="app-footer__links">
          {sponsorsUrl && <a href={sponsorsUrl}>{t("footer.support")}</a>}
          {coffeeUrl && <a href={coffeeUrl}>{t("footer.coffee")}</a>}
        </span>
      )}
    </footer>
  );
}
