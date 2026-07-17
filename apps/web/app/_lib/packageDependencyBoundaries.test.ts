import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// v0.7.0-alpha Phase 0 rule: "Do not create a circular dependency between
// router, runtime and registry." This reads each package's real
// package.json (the same tooling `pnpm -r` already relies on) and walks the
// workspace dependency graph rather than asserting a fixed edge list, so it
// keeps working as new packages/edges are added in later v0.7 phases.
function readWorkspaceDependencies(packageName: string): string[] {
  const path = new URL(`../../../../packages/${packageName}/package.json`, import.meta.url);
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { dependencies?: Record<string, string> };
  return Object.keys(manifest.dependencies ?? {})
    .filter((dependency) => dependency.startsWith("@free-ai-open/"))
    .map((dependency) => dependency.replace("@free-ai-open/", ""));
}

function hasPath(from: string, to: string, packages: string[], visited = new Set<string>()): boolean {
  if (from === to) return true;
  if (visited.has(from)) return false;
  visited.add(from);

  for (const dependency of readWorkspaceDependencies(from)) {
    if (!packages.includes(dependency)) continue;
    if (hasPath(dependency, to, packages, visited)) return true;
  }
  return false;
}

const V0_7_RELEVANT_PACKAGES = ["types", "device-profiler", "local-benchmark", "model-registry", "model-router", "ai-runtime"];

describe("v0.7 router/runtime/registry package boundaries", () => {
  it("keeps @free-ai-open/types a zero-workspace-dependency leaf, since router/runtime/registry/profiler all share it", () => {
    expect(readWorkspaceDependencies("types")).toEqual([]);
  });

  it("does not let model-router depend on ai-runtime", () => {
    expect(readWorkspaceDependencies("model-router")).not.toContain("ai-runtime");
  });

  it("does not let ai-runtime depend on model-router or model-registry", () => {
    const aiRuntimeDeps = readWorkspaceDependencies("ai-runtime");
    expect(aiRuntimeDeps).not.toContain("model-router");
    expect(aiRuntimeDeps).not.toContain("model-registry");
  });

  it("has no dependency cycle among the router/runtime/registry/profiler/types packages", () => {
    for (const pkg of V0_7_RELEVANT_PACKAGES) {
      for (const dependency of readWorkspaceDependencies(pkg)) {
        if (!V0_7_RELEVANT_PACKAGES.includes(dependency)) continue;
        // A cycle exists if the dependency can, through any path, depend
        // back on the original package.
        expect(hasPath(dependency, pkg, V0_7_RELEVANT_PACKAGES)).toBe(false);
      }
    }
  });
});
