"use client";
import { Play } from "lucide-react";
import { EmptyState } from "../ui";

// Tracer-bullet placeholder: replaced by the full runs UI in the next commit.
export function RunsPanel({ experimentId: _experimentId }: { experimentId: string }) {
  return <EmptyState icon={<Play className="size-5" />} title="Runs are coming next" />;
}
