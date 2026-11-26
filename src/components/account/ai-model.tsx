"use client";
// Settings → AI: which model answers (kept in this browser, lib/ai/model-choice.ts). The chat box has the same choice.
import { AI_MODEL_NAMES, type AiModel } from "@/config/app";
import { useAiModel } from "@/lib/ai/model-choice";
import { Segmented } from "../ui";

export const MODELS: AiModel[] = ["sonnet", "haiku"];
export const WHAT: Record<AiModel, string> = { sonnet: "Best answers. The default.", haiku: "Faster, and uses far fewer credits." };

export function AiModelPicker() {
  const [model, setModel] = useAiModel();
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-0">
        <p>Model</p>
        {model && <p className="text-sm text-faint">{WHAT[model]}</p>}
      </div>
      <Segmented
        label="Model"
        options={MODELS.map((m) => ({ value: m, label: AI_MODEL_NAMES[m] }))}
        value={model}
        onChange={setModel}
      />
    </div>
  );
}
