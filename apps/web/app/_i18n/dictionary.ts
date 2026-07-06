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

export function getByPath(dictionary: Dictionary, path: string): string | undefined {
  const value = path.split(".").reduce<unknown>((node, segment) => {
    if (node && typeof node === "object" && segment in node) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, dictionary);

  return typeof value === "string" ? value : undefined;
}
