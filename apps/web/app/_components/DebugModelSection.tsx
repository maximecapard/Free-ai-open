import type { ModelRecord } from "@free-ai-open/model-registry";
import { DebugField, DebugSection } from "./DebugSection";

function ModelDetails({ model }: { model: ModelRecord }) {
  return (
    <>
      <DebugField label="Source" value={model.source} />
      <DebugField label="Status" value={model.status} />
      <DebugField label="Estimated size" value={`${model.estimatedDownloadGb} GB`} />
      <DebugField label="License" value={model.license} />
    </>
  );
}

export function DebugModelSection({
  recommendedModel,
  loadedModelId,
  loadedModel,
}: {
  recommendedModel: ModelRecord | null;
  loadedModelId: string | null;
  loadedModel: ModelRecord | null;
}) {
  return (
    <DebugSection title="Model">
      <DebugField label="Recommended model" value={recommendedModel ? recommendedModel.displayName : "None available"} />
      {recommendedModel && <ModelDetails model={recommendedModel} />}

      <div style={{ marginTop: 12 }}>
        <DebugField
          label="Loaded model"
          value={loadedModelId ? loadedModel?.displayName ?? loadedModelId : "No model loaded in this browser yet"}
        />
        {loadedModelId && loadedModel && <ModelDetails model={loadedModel} />}
        {loadedModelId && !loadedModel && (
          <p style={{ fontSize: 13, opacity: 0.6, margin: "6px 0 0" }}>
            Not in the local model registry yet — this is the WebLLM test model used by this early build, not one of the
            catalogued recommendations above.
          </p>
        )}
      </div>
    </DebugSection>
  );
}
