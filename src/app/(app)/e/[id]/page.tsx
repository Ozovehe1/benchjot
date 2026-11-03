import { ExperimentView } from "@/components/experiment/experiment-view";

export default async function ExperimentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExperimentView id={id} />;
}
