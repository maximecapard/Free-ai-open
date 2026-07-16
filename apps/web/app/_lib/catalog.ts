import type { PerformanceMode, TaskCategory } from "@free-ai-open/types";
import type { TranslationKey } from "../_i18n/dictionary";

export interface TaskOption {
  id: TaskCategory;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
}

export interface ModeOption {
  id: PerformanceMode;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
}

export const taskCategories: TaskOption[] = [
  { id: "chat", labelKey: "tasks.chat.label", descriptionKey: "tasks.chat.description" },
  { id: "writing", labelKey: "tasks.writing.label", descriptionKey: "tasks.writing.description" },
  { id: "rewrite", labelKey: "tasks.rewrite.label", descriptionKey: "tasks.rewrite.description" },
  { id: "summarization", labelKey: "tasks.summarization.label", descriptionKey: "tasks.summarization.description" },
  { id: "translation", labelKey: "tasks.translation.label", descriptionKey: "tasks.translation.description" },
  { id: "coding", labelKey: "tasks.coding.label", descriptionKey: "tasks.coding.description" },
  { id: "learning", labelKey: "tasks.learning.label", descriptionKey: "tasks.learning.description" },
  {
    id: "document_analysis",
    labelKey: "tasks.document_analysis.label",
    descriptionKey: "tasks.document_analysis.description",
  },
];

export const performanceModes: ModeOption[] = [
  { id: "fast", labelKey: "modes.fast.label", descriptionKey: "modes.fast.description" },
  { id: "balanced", labelKey: "modes.balanced.label", descriptionKey: "modes.balanced.description" },
  { id: "performance", labelKey: "modes.performance.label", descriptionKey: "modes.performance.description" },
];

// Presented when starting a new conversation. Excludes document_analysis:
// the product has no document upload/analysis entry point yet, so offering
// it here would promise a capability that doesn't actually exist.
export const newChatTaskOptions: TaskOption[] = taskCategories.filter((task) => task.id !== "document_analysis");

export function findTaskLabelKey(id: string | null | undefined): TranslationKey | null {
  return taskCategories.find((task) => task.id === id)?.labelKey ?? null;
}

export function findModeLabelKey(id: string | null | undefined): TranslationKey | null {
  return performanceModes.find((mode) => mode.id === id)?.labelKey ?? null;
}

export function isTaskCategory(value: string | null | undefined): value is TaskCategory {
  return taskCategories.some((task) => task.id === value);
}

export function isPerformanceMode(value: string | null | undefined): value is PerformanceMode {
  return performanceModes.some((mode) => mode.id === value);
}

// Conversations created before the per-conversation task field existed (or
// imported from an older export) have no stored task. Falls back to "chat"
// (general conversation) rather than losing the conversation or blocking on
// a choice, per the migration rule: default missing task metadata to the
// current general chat behavior.
export function resolveConversationTask(task: string | null | undefined): TaskCategory {
  return isTaskCategory(task) ? task : "chat";
}
