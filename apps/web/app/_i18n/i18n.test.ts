import { describe, expect, it } from "vitest";
import { getDictionaryKeys, translateFromDictionary } from "./dictionary";
import type { Dictionary, TranslationKey } from "./dictionary";
import { en } from "./locales/en";
import { fr } from "./locales/fr";

const REPRESENTATIVE_KEYS: TranslationKey[] = [
  "home.kicker",
  "home.lead",
  "settings.title",
  "onboarding.deviceTitle",
  "onboarding.modeTitle",
  "newChatDialog.title",
  "newChatDialog.body",
  "tasks.document_analysis.label",
  "modes.balanced.label",
  "modelStatus.noCompatibleModel",
  "router.selectedWithFallback",
  "chat.reloadModel",
  "chat.scrollToLatest",
  "history.storedLocally",
  "backup.privacyNote",
  "runtimeStatus.recovering",
  "runtimeError.cancel_timeout",
  "storageNotice.generationStoppedRecovering",
  "debug.clearLogsConfirm",
  "debug.formFactor",
  "header.themeLight",
  "header.language",
  "header.home",
  "header.chat",
  "header.primaryNavigation",
  "privacy.notice",
  "home.openChat",
  "deviceCapability.recommended",
  "runtimeStatusPlain.ready",
  "chat.composerHint",
  "chat.technicalDetails",
  "modes.recommendedBadge",
  "settings.performanceHeading",
  "settings.resetConfirm",
];

describe("i18n dictionaries", () => {
  it("keeps English and French catalogs in lockstep", () => {
    expect(getDictionaryKeys(fr).sort()).toEqual(getDictionaryKeys(en).sort());
  });

  it("contains localized strings for every public route and shared component area", () => {
    for (const key of REPRESENTATIVE_KEYS) {
      expect(translateFromDictionary(en, en, key)).toBeTruthy();
      expect(translateFromDictionary(fr, en, key)).toBeTruthy();
    }

    expect(translateFromDictionary(fr, en, "home.kicker")).toContain("Assistant IA");
    expect(translateFromDictionary(fr, en, "settings.title")).toBe("Paramètres");
    expect(translateFromDictionary(fr, en, "runtimeStatus.recovering")).toBe("Récupération");
    expect(translateFromDictionary(fr, en, "backup.privacyNote")).toContain("ne sont pas chiffrés");
  });

  it("falls back to English in production-like mode when a localized key is missing", () => {
    const incompleteFr = {
      ...fr,
      settings: {
        body: fr.settings.body,
      },
    } as unknown as Dictionary;

    expect(translateFromDictionary(incompleteFr, en, "settings.title")).toBe("Settings");
  });

  it("throws clearly in development/test mode when a localized key is missing", () => {
    const incompleteFr = {
      ...fr,
      settings: {
        body: fr.settings.body,
      },
    } as unknown as Dictionary;

    expect(() => translateFromDictionary(incompleteFr, en, "settings.title", undefined, { throwOnMissing: true })).toThrow(
      "Missing translation key: settings.title"
    );
  });
});
