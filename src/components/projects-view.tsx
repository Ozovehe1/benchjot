"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createProject, deleteProject, updateProject, useProject, useProjects } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import type { Project } from "@/lib/schemas";
import { Button, EmptyState, ErrorState, IconButton, Input, Label, Skeleton, Textarea } from "./ui";
import { PageHeader } from "./page-header";
import { Sheet } from "./sheet";
import { ExperimentsView } from "./experiment-list";
import { useShell } from "./shell";

export function ProjectsView() {
  const { data, error, isLoading, mutate } = useProjects();
  const [editing, setEditing] = useState<Project | "new" | null>(null);

  return (
    <>
      <PageHeader
        title="Projects"
        actions={
          <Button size="sm" variant="primary" onClick={() => setEditing("new")} className="mr-2 md:mr-0">
            <Plus className="size-4" /> New project
          </Button>
        }
      />
      <main className="mx-auto max-w-5xl px-4 py-5 md:px-6 md:py-6">
        {error ? (
          <ErrorState error={error} onRetry={() => void mutate()} />
        ) : isLoading || !data ? (
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={<FolderTree className="size-5" />}
            title="Group experiments into projects"
            body="A project is one research thread, like “Sparse attention” or “Final-year thesis”. Experiments can live in one, or stand alone."
            action={
              <Button variant="primary" onClick={() => setEditing("new")}>
                Create a project
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {data.map((p) => {
              const n = p.experiments[0]?.count ?? 0;
              return (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-border-strong active:bg-surface-2"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                      <FolderTree className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold tracking-tight">{p.name}</span>
                      <span className="block truncate text-sm text-muted">
                        {n} experiment{n === 1 ? "" : "s"} · {timeAgo(p.updated_at)}
                      </span>
                    </span>
                    <ChevronRight className="size-5 text-faint" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <ProjectSheet project={editing} onClose={() => setEditing(null)} />
    </>
  );
}

export function ProjectView({ id }: { id: string }) {
  const { data: project, error } = useProject(id);
  const { openNew } = useShell();
  const [editing, setEditing] = useState(false);

  if (error) {
    return (
      <>
        <PageHeader back="/projects" title="Project" />
        <main className="mx-auto max-w-3xl px-4 py-8">
          <ErrorState error={error.message === "Not found" ? new Error("This project doesn't exist or was deleted.") : error} />
        </main>
      </>
    );
  }

  return (
    <>
      <ExperimentsView
        projectId={id}
        back="/projects"
        title={project?.name ?? " "}
        headerActions={
          <>
            <IconButton label="Edit project" onClick={() => setEditing(true)} disabled={!project}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="New experiment in this project" onClick={() => openNew(id)}>
              <Plus className="size-5" />
            </IconButton>
          </>
        }
        intro={project?.description ? <p className="mb-4 max-w-2xl text-[15px] leading-relaxed text-muted">{project.description}</p> : null}
      />
      <ProjectSheet project={editing && project ? project : null} onClose={() => setEditing(false)} />
    </>
  );
}

function ProjectSheet({ project, onClose }: { project: Project | "new" | null; onClose: () => void }) {
  const router = useRouter();
  const isNew = project === "new";
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project && project !== "new") {
      setName(project.name);
      setDescription(project.description);
    } else if (project === "new") {
      setName("");
      setDescription("");
    }
  }, [project]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (isNew) {
        const p = await createProject({ name, description });
        onClose();
        router.push(`/projects/${p.id}`);
      } else if (project) {
        await updateProject(project.id, { name, description });
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save project");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!project || project === "new") return;
    if (!window.confirm(`Delete “${project.name}” and every experiment in it? This can't be undone.`)) return;
    try {
      await deleteProject(project.id);
      onClose();
      router.replace("/projects");
      toast.success("Project deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <Sheet open={project !== null} onOpenChange={(o) => !o && onClose()} title={isNew ? "New project" : "Edit project"}>
      <form onSubmit={submit} className="space-y-4 pt-2">
        <div>
          <Label htmlFor="pj-name">Name</Label>
          <Input id="pj-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Efficient attention" maxLength={120} />
        </div>
        <div>
          <Label htmlFor="pj-desc" hint="optional">
            Description
          </Label>
          <Textarea id="pj-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="The question this thread is chasing" />
        </div>
        <Button type="submit" variant="primary" className="w-full" loading={saving} disabled={!name.trim()}>
          {isNew ? "Create project" : "Save"}
        </Button>
        {!isNew && (
          <Button variant="danger" className="w-full" onClick={remove}>
            <Trash2 className="size-4" /> Delete project
          </Button>
        )}
      </form>
    </Sheet>
  );
}
