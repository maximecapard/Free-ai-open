// v0.7.0-alpha Phase 4: formats a model's registry download-size Estimate
// (bytes) into a rounded, human-scale figure for the download-consent UI.
// Never claims a precision the registry data doesn't have — Estimate.value is
// itself an approximation, so this only rounds for display.
export interface ApproximateDownloadSize {
  value: number;
  unit: "MB" | "GB";
}

const BYTES_PER_MB = 1_000_000;
const BYTES_PER_GB = 1_000_000_000;

export function formatApproximateDownloadSize(bytes: number | undefined): ApproximateDownloadSize | null {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  if (bytes < BYTES_PER_GB) {
    return { value: Math.round(bytes / BYTES_PER_MB), unit: "MB" };
  }
  return { value: Math.round((bytes / BYTES_PER_GB) * 10) / 10, unit: "GB" };
}

// v0.7.0-alpha Phase 5: "warn on large mobile download when appropriate."
// 500MB is a deliberately lower bar than the router's own 1GB
// download_large warning threshold (adaptiveScoring.ts) — mobile data plans
// are commonly capped well below what a desktop connection tolerates
// comfortably, so this is a separate, mobile-specific judgment call rather
// than reusing the desktop-oriented threshold.
const LARGE_MOBILE_DOWNLOAD_BYTES = 500_000_000;

export function isLargeMobileDownload(bytes: number | undefined, isMobileFormFactor: boolean): boolean {
  return isMobileFormFactor && typeof bytes === "number" && bytes >= LARGE_MOBILE_DOWNLOAD_BYTES;
}
