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
