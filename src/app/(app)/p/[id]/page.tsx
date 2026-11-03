import { notFound } from "next/navigation";
import { EntryList } from "@/components/entry-list";
import { serverSupabase } from "@/lib/supabase/server";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: project } = await (await serverSupabase()).from("projects").select("id, name").eq("id", id).maybeSingle();
  if (!project) notFound();
  return <EntryList key={project.id + project.name} project={project} />;
}
