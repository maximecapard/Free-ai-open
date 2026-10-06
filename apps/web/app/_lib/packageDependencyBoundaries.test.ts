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

// v0.8.0-alpha Phase 0/2 rule (see docs/architecture.md's "Persistence and
// package boundary" / "Router relationship (defined, not wired)" /
// "Benchmark runner package placement" sections): @free-ai-open/model-benchmark
// started (Phase 0) as a thin, isolated leaf depending on nothing but
// @free-ai-open/types. Phase 2 deliberately adds exactly ONE new dependency,
// on @free-ai-open/ai-runtime, so the runner can orchestrate real
// loadModel()/generate() calls against runtime-backed metrics -- see
// runner.ts's own top-of-file comment. It must still never depend on
// model-registry (a benchmark target is validated structurally, not looked
// up in a live registry) or model-router (a future router integration may
// let model-router depend ON model-benchmark; the reverse edge must never
// exist). apps/web (this very test's own app) is not itself a workspace
// package any other package can declare a dependency on in this pnpm
// layout (packages never depend on apps), so "must not import the web UI"
// is enforced structurally by this same allowlist check rather than needing
// a separate source-level scanner.
const V0_8_RELEVANT_PACKAGES = [...V0_7_RELEVANT_PACKAGES, "model-benchmark"];

describe("v0.8 model-benchmark package boundaries (Phase 0/2)", () => {
  it("depends on exactly @free-ai-open/types and @free-ai-open/ai-runtime", () => {
    expect(readWorkspaceDependencies("model-benchmark").sort()).toEqual(["ai-runtime", "types"]);
  });

  it("does not depend on model-router -- a future router integration is defined but not wired, and must depend in the router -> benchmark direction only", () => {
    expect(readWorkspaceDependencies("model-benchmark")).not.toContain("model-router");
  });

  it("does not depend on model-registry -- a benchmark target is validated structurally, never looked up in a live registry catalog", () => {
    expect(readWorkspaceDependencies("model-benchmark")).not.toContain("model-registry");
  });

  it("does not let ai-runtime depend back on model-benchmark", () => {
    expect(readWorkspaceDependencies("ai-runtime")).not.toContain("model-benchmark");
  });

  it("has no dependency cycle among the router/runtime/registry/profiler/benchmark/types packages", () => {
    for (const pkg of V0_8_RELEVANT_PACKAGES) {
      for (const dependency of readWorkspaceDependencies(pkg)) {
        if (!V0_8_RELEVANT_PACKAGES.includes(dependency)) continue;
        expect(hasPath(dependency, pkg, V0_8_RELEVANT_PACKAGES)).toBe(false);
      }
    }
  });
});
