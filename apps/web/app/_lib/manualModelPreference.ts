// v0.7.0-alpha Phase 5: whether model selection is "automatic" (the adaptive
// router decides, recommended) or "manual" (the user picked a specific
// registry model ID, advanced). Mirrors gettingStartedPreference.ts's
// single-JSON-object/schema-versioned/window-guarded localStorage
// convention. Deliberately does not import @free-ai-open/model-registry —
// this is a low-level preference store; eligibility of a stored
// manualModelId is validated where it's consumed (the adaptive router itself
// warns via manual_model_unknown/manual_model_ineligible rather than
// silently bypassing hard gates — see docs/model-selection.md).
const STORAGE_KEY = "free-ai-open:manual-model-preference";
const SCHEMA_VERSION = 1;

export type ModelSelectionMode = "automatic" | "manual";

export interface ManualModelPreferenceState {
  schemaVersion: number;
  mode: ModelSelectionMode;
  manualModelId: string | null;
}

const DEFAULT_STATE: ManualModelPreferenceState = {
  schemaVersion: SCHEMA_VERSION,
  mode: "automatic",
  manualModelId: null,
};

function parseState(raw: string | null): ManualModelPreferenceState {
  if (!raw) return DEFAULT_STATE;

  try {
    const parsed = JSON.parse(raw) as Partial<ManualModelPreferenceState> | null;
    if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== SCHEMA_VERSION) return DEFAULT_STATE;

    const mode = parsed.mode === "manual" ? "manual" : "automatic";
    const manualModelId = mode === "manual" && typeof parsed.manualModelId === "string" ? parsed.manualModelId : null;
    if (mode === "manual" && !manualModelId) return DEFAULT_STATE;

    return { schemaVersion: SCHEMA_VERSION, mode, manualModelId };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(state: ManualModelPreferenceState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable (private browsing, quota, disabled).
  }
}

export function getStoredManualModelPreference(): ManualModelPreferenceState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    return parseState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_STATE;
  }
}

export function setManualModelSelection(modelId: string): void {
  writeState({ schemaVersion: SCHEMA_VERSION, mode: "manual", manualModelId: modelId });
}

export function setAutomaticModelSelection(): void {
  writeState(DEFAULT_STATE);
}
