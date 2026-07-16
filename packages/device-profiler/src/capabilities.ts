import { detectOsFamily } from "./families";
import type { ArchitectureClass, CpuConcurrencyClass, FormFactor, MemoryClass, NavigatorLike } from "./types";

function lower(value: string | undefined): string {
  return value?.toLowerCase() ?? "";
}

// Best-effort only. UA-based mobile/tablet hints are not fully reliable. The
// specific iPadOS Safari desktop-mode signal must run before generic macOS
// desktop classification, otherwise a touch tablet reports as "Macintosh" and
// bypasses the tablet tier cap.
export function detectFormFactor(navigatorLike: NavigatorLike | undefined): FormFactor {
  const userAgent = lower(navigatorLike?.userAgent);
  const uaDataMobile = navigatorLike?.userAgentData?.mobile;
  const maxTouchPoints = navigatorLike?.maxTouchPoints ?? 0;

  const looksLikeTablet =
    userAgent.includes("ipad") || (userAgent.includes("android") && !userAgent.includes("mobile"));
  if (looksLikeTablet) return "tablet";

  const looksLikeMobile =
    uaDataMobile === true || userAgent.includes("iphone") || (userAgent.includes("android") && userAgent.includes("mobile"));
  if (looksLikeMobile) return "mobile";

  const looksLikeDesktopStyleIpad =
    (userAgent.includes("macintosh") || userAgent.includes("mac os")) && maxTouchPoints > 1;
  if (looksLikeDesktopStyleIpad) {
    return uaDataMobile === undefined ? "tablet" : "unknown";
  }

  if (uaDataMobile === false) return "desktop";

  const osFamily = detectOsFamily(navigatorLike);
  if (osFamily === "windows" || osFamily === "macos" || osFamily === "linux") {
    // A touch-capable "desktop" OS report is most often a touchscreen laptop,
    // not a tablet — keep it conservative and call it desktop rather than
    // guessing tablet from touch points alone.
    return "desktop";
  }

  return "unknown";
}

// Uses the Client Hints high-entropy API when available; falls back to
// "unknown" for any browser that doesn't support it or denies/errors the
// request. Never derived from OS family alone, since e.g. Apple Silicon Macs
// are ARM despite reporting "macos".
export async function detectArchitectureClass(navigatorLike: NavigatorLike | undefined): Promise<ArchitectureClass> {
  const userAgentData = navigatorLike?.userAgentData;
  const getHighEntropyValues = userAgentData?.getHighEntropyValues;
  if (typeof getHighEntropyValues !== "function") return "unknown";

  try {
    const values = await getHighEntropyValues.call(userAgentData, ["architecture"]);
    const architecture = lower(typeof values.architecture === "string" ? values.architecture : undefined);
    if (architecture.includes("arm")) return "arm";
    if (architecture.includes("x86") || architecture.includes("x64")) return "x86";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function detectCpuConcurrency(navigatorLike: NavigatorLike | undefined): number | undefined {
  const cores = navigatorLike?.hardwareConcurrency;
  return typeof cores === "number" && Number.isFinite(cores) && cores > 0 ? cores : undefined;
}

export function classifyMemory(estimatedMemoryGb: number | undefined): MemoryClass {
  if (estimatedMemoryGb === undefined) return "unknown";
  if (estimatedMemoryGb < 4) return "low";
  if (estimatedMemoryGb < 8) return "medium";
  return "high";
}

// Thresholds are set so common 8-core mobile SoCs land in "medium" while
// higher-core-count desktop/laptop CPUs land in "high" — hardwareConcurrency
// alone does not reliably separate phones from desktops otherwise.
export function classifyCpuConcurrency(cores: number | undefined): CpuConcurrencyClass {
  if (cores === undefined) return "unknown";
  if (cores <= 4) return "low";
  if (cores <= 8) return "medium";
  return "high";
}
