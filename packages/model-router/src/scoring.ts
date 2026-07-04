import type { ModelRecord } from "@free-ai-open/model-registry";
import type { ModelRouterInput } from "./types";

function compareNumber(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareId(left: ModelRecord, right: ModelRecord): number {
  return left.id.localeCompare(right.id);
}

function compareFastMode(left: ModelRecord, right: ModelRecord): number {
  return (
    compareNumber(left.estimatedRamGb, right.estimatedRamGb) ||
    compareNumber(left.estimatedDownloadGb, right.estimatedDownloadGb) ||
    compareNumber(left.recommendedDeviceTier, right.recommendedDeviceTier) ||
    compareId(left, right)
  );
}

function compareBalancedMode(left: ModelRecord, right: ModelRecord, input: ModelRouterInput): number {
  return (
    compareNumber(
      Math.abs(left.recommendedDeviceTier - input.deviceProfile.deviceTier),
      Math.abs(right.recommendedDeviceTier - input.deviceProfile.deviceTier)
    ) ||
    compareNumber(left.estimatedRamGb, right.estimatedRamGb) ||
    compareNumber(left.estimatedDownloadGb, right.estimatedDownloadGb) ||
    compareId(left, right)
  );
}

function comparePerformanceMode(left: ModelRecord, right: ModelRecord): number {
  return (
    compareNumber(right.recommendedDeviceTier, left.recommendedDeviceTier) ||
    compareNumber(right.estimatedRamGb, left.estimatedRamGb) ||
    compareNumber(right.estimatedDownloadGb, left.estimatedDownloadGb) ||
    compareId(left, right)
  );
}

export function compareModelsForRoute(left: ModelRecord, right: ModelRecord, input: ModelRouterInput): number {
  if (input.performanceMode === "fast") {
    return compareFastMode(left, right);
  }

  if (input.performanceMode === "performance") {
    return comparePerformanceMode(left, right);
  }

  return compareBalancedMode(left, right, input);
}

export function rankCompatibleModels(input: ModelRouterInput, compatibleModels: readonly ModelRecord[]): ModelRecord[] {
  return [...compatibleModels].sort((left, right) => compareModelsForRoute(left, right, input));
}
