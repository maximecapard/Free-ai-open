import { describe, expect, it } from "vitest";
import { shouldDisposeRuntimeForTrigger } from "./runtimeLifecyclePolicy";

describe("runtime lifecycle policy", () => {
  it("keeps the runtime alive for internal route view unmounts", () => {
    expect(shouldDisposeRuntimeForTrigger("route_view_unmount")).toBe(false);
  });

  it("keeps the runtime alive when the document becomes hidden", () => {
    expect(shouldDisposeRuntimeForTrigger("visibility_hidden")).toBe(false);
  });

  it("allows disposal for root teardown and explicit replacement paths", () => {
    expect(shouldDisposeRuntimeForTrigger("app_root_unmount")).toBe(true);
    expect(shouldDisposeRuntimeForTrigger("explicit_reload")).toBe(true);
    expect(shouldDisposeRuntimeForTrigger("performance_replacement")).toBe(true);
    expect(shouldDisposeRuntimeForTrigger("recovery")).toBe(true);
  });
});
