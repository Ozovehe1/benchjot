import { notFound } from "next/navigation";
import { NoteList } from "@/components/notes/note-list";
import { findProject } from "@/lib/server/account";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const project = await findProject((await params).id);
  if (!project) notFound();
  return <NoteList key={project.id + project.name} project={project} />;
}
