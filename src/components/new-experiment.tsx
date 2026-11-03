"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createExperiment, useProjects } from "@/lib/data";
import { Sheet } from "./sheet";
import { Button, Input, Label, Select, Textarea } from "./ui";

export function NewExperimentSheet({
  open,
  onOpenChange,
  defaultProjectId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultProjectId: string | null;
}) {
  const router = useRouter();
  const { data: projects } = useProjects();
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setHypothesis("");
      setProjectId(defaultProjectId ?? "");
    }
  }, [open, defaultProjectId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const exp = await createExperiment({ title, hypothesis, project_id: projectId || null });
      onOpenChange(false);
      router.push(`/e/${exp.id}?tab=code`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create experiment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="New experiment" description="Name it now, add code and runs next.">
      <form id="new-exp" onSubmit={submit} className="space-y-4 pt-2">
        <div>
          <Label htmlFor="ne-title">Title</Label>
          <Input
            id="ne-title"
            autoFocus
            placeholder="e.g. Cosine LR vs step decay on CIFAR-10"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </div>
        <div>
          <Label htmlFor="ne-hyp" hint="optional">
            Hypothesis
          </Label>
          <Textarea
            id="ne-hyp"
            rows={3}
            placeholder="What do you expect, and why?"
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ne-proj" hint="optional">
            Project
          </Label>
          <Select id="ne-proj" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="primary" className="w-full" loading={saving} disabled={!title.trim()}>
          Create experiment
        </Button>
      </form>
    </Sheet>
  );
}
