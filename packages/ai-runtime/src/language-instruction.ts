import type { RuntimeLocale } from "./types";

const LANGUAGE_INSTRUCTIONS: Record<RuntimeLocale, string> = {
  en: "Reply in English by default. Use another language only when the user explicitly requests it.",
  fr: "Réponds en français par défaut. Utilise une autre langue uniquement si l’utilisateur le demande explicitement.",
};

export function getRuntimeLanguageInstruction(locale: RuntimeLocale = "en"): string {
  return LANGUAGE_INSTRUCTIONS[locale] ?? LANGUAGE_INSTRUCTIONS.en;
}
