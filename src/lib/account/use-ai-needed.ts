"use client";
// Whether Fix, the Assistant and the agent would ask this user to connect AI (connection_gate: they run
// only on the user's own connected AI, and this one hasn't connected). Read once per page load.
import { useEffect, useState } from "react";
import { aiNeeded } from "./auth";

let needed: Promise<boolean> | null = null;

export function useAiNeeded(): boolean {
  const [need, setNeed] = useState(false);
  useEffect(() => {
    let live = true;
    (needed ??= aiNeeded().catch(() => false)).then((v) => live && setNeed(v));
    return () => {
      live = false;
    };
  }, []);
  return need;
}
