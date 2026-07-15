import { en } from "./locales/en";

// Widens every literal string leaf from `en` (typed via `as const`) to plain
// `string`, while keeping the nested namespace shape. This lets `fr.ts`
// satisfy the same `Dictionary` type with different text.
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

export type Dictionary = Widen<typeof en>;

type DotPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : DotPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type TranslationKey = DotPaths<typeof en>;

export function getDictionaryKeys(dictionary: Dictionary, prefix = ""): string[] {
  return collectDictionaryKeys(dictionary as Record<string, unknown>, prefix);
}

function collectDictionaryKeys(dictionary: Record<string, unknown>, prefix: string): string[] {
  return Object.entries(dictionary).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : collectDictionaryKeys(value as Record<string, unknown>, path);
  });
}

export function getByPath(dictionary: Dictionary, path: string): string | undefined {
  const value = path.split(".").reduce<unknown>((node, segment) => {
    if (node && typeof node === "object" && segment in node) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, dictionary);

  return typeof value === "string" ? value : undefined;
}

export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return Object.entries(params).reduce((next, [name, value]) => next.replaceAll(`{${name}}`, String(value)), text);
}

export function translateFromDictionary(
  dictionary: Dictionary,
  fallbackDictionary: Dictionary,
  key: TranslationKey,
  params?: Record<string, string | number>,
  options: { throwOnMissing?: boolean } = {}
): string {
  const localized = getByPath(dictionary, key);
  if (localized !== undefined) return interpolate(localized, params);

  const fallback = getByPath(fallbackDictionary, key);
  if (fallback !== undefined) {
    if (options.throwOnMissing) {
      throw new Error(`Missing translation key: ${key}`);
    }
    return interpolate(fallback, params);
  }

  if (options.throwOnMissing) {
    throw new Error(`Unknown translation key: ${key}`);
  }

  return key;
}
