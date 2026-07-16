import type { DeviceProfile, DeviceTierLabel } from "@free-ai-open/device-profiler";
import type { Backend, DeviceTier } from "@free-ai-open/types";
import { rejectIncompatibleModels } from "./compatibility";
import { explainModelDecision } from "./explain";
import { getFallbackModel } from "./fallback";
import { rankCompatibleModels } from "./scoring";
import type { ModelRouterInput, ModelRouterResult, RouteModelInput, RouteModelResult } from "./types";

function getPreferredBackend(availableBackends: readonly Backend[] | undefined): Backend {
  if (!availableBackends) return "webgpu";
  if (availableBackends.includes("webgpu")) return "webgpu";
  if (availableBackends.includes("wasm")) return "wasm";
  return "cpu";
}

function getDeviceTierLabel(deviceTier: DeviceTier): DeviceTierLabel {
  if (deviceTier === 0) return "cpu_only";
  if (deviceTier === 1) return "webgpu_low";
  if (deviceTier === 2) return "webgpu_medium";
  if (deviceTier === 3) return "webgpu_high";
  return "desktop_power";
}

function buildLegacyDeviceProfile(input: RouteModelInput): DeviceProfile {
  const availableBackends = input.availableBackends;

  return {
    webgpuAvailable: availableBackends ? availableBackends.includes("webgpu") : true,
    wasmAvailable: availableBackends ? availableBackends.includes("wasm") : true,
    preferredBackend: getPreferredBackend(availableBackends),
    browserFamily: "unknown",
    osFamily: "unknown",
    benchmark: {
      status: "skipped",
      score: null,
      reason: "placeholder",
    },
    deviceTier: input.deviceTier,
    deviceTierLabel: getDeviceTierLabel(input.deviceTier),
    // The legacy routeModel() input only carries a device tier, not a full
    // capability profile, so these coarse fields are unknown rather than
    // guessed.
    formFactor: "unknown",
    architectureClass: "unknown",
    memoryClass: "unknown",
    cpuConcurrencyClass: "unknown",
  };
}

export function selectRecommendedModel(input: ModelRouterInput): ModelRouterResult {
  const { compatibleModels, rejectedModels } = rejectIncompatibleModels(input);
  const rankedModels = rankCompatibleModels(input, compatibleModels);
  const selectedModel = rankedModels[0] ?? null;
  const fallbackModel = getFallbackModel(input, rankedModels, selectedModel);
  const explanation = explainModelDecision(input, selectedModel, fallbackModel, rejectedModels);

  return {
    selectedModel,
    fallbackModel,
    rejectedModels,
    reasonCode: explanation.reasonCode,
    humanReadableReason: explanation.humanReadableReason,
  };
}

export function routeModel(input: RouteModelInput): RouteModelResult {
  const result = selectRecommendedModel({
    task: input.task,
    performanceMode: input.performanceMode,
    deviceProfile: buildLegacyDeviceProfile(input),
    modelRegistry: input.models,
  });

  return {
    ...result,
    rejected: result.rejectedModels,
  };
}
