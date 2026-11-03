import { ProjectView } from "@/components/projects-view";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectView id={id} />;
}
