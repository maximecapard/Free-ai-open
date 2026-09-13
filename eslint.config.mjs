import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

// Turns this repo's own .gitignore into additional ESLint ignore globs, so
// any nested checkout Git itself already excludes -- a linked worktree
// living under a gitignored directory, in particular -- is excluded here
// too, without this config needing to know about any specific tool (an
// editor's local worktrees, or anything else) by name. A nested git
// worktree breaks typescript-eslint's project-service tsconfig discovery
// (multiple candidate root tsconfig.json files, one per worktree, with no
// single inferable tsconfigRootDir), so every one of them must be excluded
// here regardless of what created it or where it lives under the repo.
function gitignoreToEslintIgnores() {
  let contents;
  try {
    contents = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
  } catch {
    return [];
  }

  const globs = [];
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    // Skip blanks, comments, and negation patterns -- this repo's
    // .gitignore has none of the latter today, and a naive glob
    // translation of a negation would incorrectly RE-INCLUDE files ESLint
    // should still ignore, which is worse than simply not translating it.
    if (line.length === 0 || line.startsWith("#") || line.startsWith("!")) continue;

    const isDirectory = line.endsWith("/");
    const isAnchoredToRoot = line.startsWith("/");
    const pattern = line.replace(/^\/+/, "").replace(/\/+$/, "");
    if (pattern.length === 0) continue;

    const base = isAnchoredToRoot ? pattern : `**/${pattern}`;
    globs.push(base);
    if (isDirectory) globs.push(`${base}/**`);
  }
  return globs;
}

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/out/**",
      "**/next-env.d.ts",
      ...gitignoreToEslintIgnores(),
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  }
);
