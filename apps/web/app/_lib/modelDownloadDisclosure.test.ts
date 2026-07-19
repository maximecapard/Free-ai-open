import { describe, expect, it } from "vitest";
import { formatApproximateDownloadSize, isLargeMobileDownload } from "./modelDownloadDisclosure";

describe("formatApproximateDownloadSize", () => {
  it("formats sub-gigabyte sizes in rounded megabytes", () => {
    expect(formatApproximateDownloadSize(207_000_000)).toEqual({ value: 207, unit: "MB" });
    expect(formatApproximateDownloadSize(352_000_000)).toEqual({ value: 352, unit: "MB" });
  });

  it("formats gigabyte-and-above sizes to one decimal place", () => {
    expect(formatApproximateDownloadSize(2_280_000_000)).toEqual({ value: 2.3, unit: "GB" });
    expect(formatApproximateDownloadSize(1_000_000_000)).toEqual({ value: 1, unit: "GB" });
  });

  it("returns null for missing, zero, or invalid sizes", () => {
    expect(formatApproximateDownloadSize(undefined)).toBeNull();
    expect(formatApproximateDownloadSize(0)).toBeNull();
    expect(formatApproximateDownloadSize(-100)).toBeNull();
    expect(formatApproximateDownloadSize(Number.NaN)).toBeNull();
  });
});

describe("isLargeMobileDownload", () => {
  it("warns for a large download on a mobile device", () => {
    expect(isLargeMobileDownload(2_280_000_000, true)).toBe(true);
  });

  it("does not warn for the same size on a non-mobile device", () => {
    expect(isLargeMobileDownload(2_280_000_000, false)).toBe(false);
  });

  it("does not warn for a small download on a mobile device", () => {
    expect(isLargeMobileDownload(207_000_000, true)).toBe(false);
  });

  it("does not warn when the size is unknown", () => {
    expect(isLargeMobileDownload(undefined, true)).toBe(false);
  });
});
