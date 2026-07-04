import type { Backend } from "@free-ai-open/types";
import type { DeviceTierLabel } from "./types";

export function getDeviceTierDisplayLabel(deviceTierLabel: DeviceTierLabel, preferredBackend: Backend): string {
  if (deviceTierLabel === "cpu_only" && preferredBackend === "wasm") {
    return "WASM/CPU fallback";
  }

  return deviceTierLabel;
}
