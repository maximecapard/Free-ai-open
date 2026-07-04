import type { GenerationMetrics } from "../_lib/debugDiagnostics";
import { DebugField, DebugSection } from "./DebugSection";

export function DebugPerformanceSection({
  loadTimeMs,
  generationMetrics,
  isGenerating,
}: {
  loadTimeMs: number | undefined;
  generationMetrics: GenerationMetrics | null;
  isGenerating: boolean;
}) {
  return (
    <DebugSection title="Performance">
      <DebugField label="Model load time" value={loadTimeMs !== undefined ? `${loadTimeMs} ms` : "Not recorded yet"} />
      <DebugField
        label="First token"
        value={
          generationMetrics?.firstTokenMs !== undefined && generationMetrics.firstTokenMs !== null
            ? `${generationMetrics.firstTokenMs} ms`
            : "Not recorded yet"
        }
      />
      <DebugField
        label="Tokens / sec"
        value={generationMetrics?.tokensPerSecond !== undefined ? generationMetrics.tokensPerSecond : "Not recorded yet"}
      />
      <DebugField label="Generation in progress" value={isGenerating ? "Yes" : "No"} />
    </DebugSection>
  );
}
