import { describe, expect, it } from "vitest";
import { formatApproximateDownloadSize } from "./modelDownloadDisclosure";

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
