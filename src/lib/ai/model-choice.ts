"use client";
// Which AI model this person asks (Sonnet by default, or Haiku): kept in this browser, sent with every
// AI request as the X-Benchjot-Model header (lib/server/llm.ts modelFrom). Every picker (under the
// chat box, in Settings) shows the same choice: a change is announced to the others.
import { useEffect, useState } from "react";
import { AI, type AiModel } from "@/config/app";

const KEY = "bj-ai-model";
const CHANGED = "bj-ai-model-changed";

export function aiModel(): AiModel {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    return v && v in AI.models ? (v as AiModel) : AI.defaultModel;
  } catch {
    return AI.defaultModel;
  }
}

export function setAiModel(m: AiModel): void {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // private window or storage blocked: the default is used
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

/** The chosen model, kept in step with every other picker (and other tabs); undefined until mounted. */
export function useAiModel(): [AiModel | undefined, (m: AiModel) => void] {
  const [model, setModel] = useState<AiModel | undefined>(undefined);
  useEffect(() => {
    const read = () => setModel(aiModel());
    read();
    window.addEventListener(CHANGED, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(CHANGED, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return [model, setAiModel];
}
