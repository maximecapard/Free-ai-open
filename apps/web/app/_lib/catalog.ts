import type { PerformanceMode, TaskCategory } from "@free-ai-open/types";

export interface TaskOption {
  id: TaskCategory;
  label: string;
  description: string;
}

export interface ModeOption {
  id: PerformanceMode;
  label: string;
  description: string;
}

export const taskCategories: TaskOption[] = [
  { id: "chat", label: "Chat & assistant", description: "General conversation and quick questions." },
  { id: "writing", label: "Writing help", description: "Draft new text from a prompt." },
  { id: "rewrite", label: "Rewrite & improve", description: "Polish or restructure existing text." },
  { id: "summarization", label: "Summarize", description: "Condense long text into key points." },
  { id: "translation", label: "Translate", description: "Translate text between languages." },
  { id: "coding", label: "Code helper", description: "Explain, write, or debug code." },
  { id: "learning", label: "Learn something", description: "Study help and explanations." },
  {
    id: "document_analysis",
    label: "Analyze a document",
    description: "Ask questions about a document you provide.",
  },
];

export const performanceModes: ModeOption[] = [
  { id: "fast", label: "Fast", description: "Lighter model, quicker replies." },
  { id: "balanced", label: "Balanced", description: "Good quality and speed. Recommended for most devices." },
  { id: "performance", label: "Performance", description: "Best quality. May be slower on your device." },
];

export function findTaskLabel(id: string | null | undefined): string | null {
  return taskCategories.find((task) => task.id === id)?.label ?? null;
}

export function findModeLabel(id: string | null | undefined): string | null {
  return performanceModes.find((mode) => mode.id === id)?.label ?? null;
}

export function isTaskCategory(value: string | null | undefined): value is TaskCategory {
  return taskCategories.some((task) => task.id === value);
}

export function isPerformanceMode(value: string | null | undefined): value is PerformanceMode {
  return performanceModes.some((mode) => mode.id === value);
}
