import type { NavigatorLike } from "./types";
import type { BrowserInfo } from "./types";

function lower(value: string | undefined): string {
  return value?.toLowerCase() ?? "";
}

export function detectBrowserFamily(navigatorLike: NavigatorLike | undefined): string {
  const brandText = navigatorLike?.userAgentData?.brands?.map((brand) => brand.brand).join(" ") ?? "";
  const source = `${brandText} ${navigatorLike?.userAgent ?? ""}`.toLowerCase();

  if (!source) return "unknown";
  if (source.includes("edg")) return "edge";
  if (source.includes("firefox")) return "firefox";
  if (source.includes("chrome") || source.includes("chromium")) return "chromium";
  if (source.includes("safari")) return "safari";
  return "unknown";
}

export function detectOsFamily(navigatorLike: NavigatorLike | undefined): string {
  const platform = lower(navigatorLike?.userAgentData?.platform);
  const userAgent = lower(navigatorLike?.userAgent);
  const source = `${platform} ${userAgent}`;

  if (!source.trim()) return "unknown";
  if (source.includes("windows")) return "windows";
  if (source.includes("android")) return "android";
  if (source.includes("iphone") || source.includes("ipad") || source.includes("ios")) return "ios";
  if (source.includes("mac os") || source.includes("macos") || source.includes("macintosh")) return "macos";
  if (source.includes("linux")) return "linux";
  return "unknown";
}

export function detectBrowserInfo(navigatorLike: NavigatorLike | undefined): BrowserInfo {
  return {
    browserFamily: detectBrowserFamily(navigatorLike),
    osFamily: detectOsFamily(navigatorLike),
  };
}
