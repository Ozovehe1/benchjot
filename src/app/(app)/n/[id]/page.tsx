import { EntryView } from "@/components/entry-view";

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EntryView key={id} id={id} />;
}
