export { getAvailableBackends, getModelRejectionReason, rejectIncompatibleModels } from "./compatibility";
export { explainModelDecision } from "./explain";
export { getFallbackModel } from "./fallback";
export { routeModel, selectRecommendedModel } from "./router";
export { compareModelsForRoute, rankCompatibleModels } from "./scoring";
export type {
  CompatibilityResult,
  ModelDecisionExplanation,
  ModelDecisionReasonCode,
  ModelRouterInput,
  ModelRouterResult,
  RejectedModel,
  RejectionReason,
  RouteModelInput,
  RouteModelResult,
} from "./types";
// v0.7.0-alpha contracts only — not yet wired to an implementation.
export type { RouterDecision, RouterInput } from "./adaptiveRouterContracts";
