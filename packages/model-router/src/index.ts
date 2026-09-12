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
export { ADAPTIVE_ROUTER_DECISION_VERSION, routeAdaptiveModel } from "./adaptiveRouter";
export type { AdaptiveRouterOptions } from "./adaptiveRouter";
export type {
  RouterDecision,
  RouterInput,
  RouterReasonCode,
  RouterRejectedModel,
  RouterRejectionCode,
  RouterScoreBreakdown,
  RouterWarningCode,
} from "./adaptiveRouterContracts";
export {
  CHAT_MESSAGE_OVERHEAD_TOKENS,
  CONTEXT_SAFETY_MARGIN_TOKENS,
  MINIMUM_USEFUL_OUTPUT_TOKENS,
  calculateGenerationBudget,
  estimateChatInputTokens,
  estimateTokenCount,
} from "./contextBudget";
export type { GenerationBudgetInput, GenerationBudgetResult } from "./contextBudget";
