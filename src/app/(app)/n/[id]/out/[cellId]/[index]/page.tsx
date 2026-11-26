import { OutputViewer } from "@/components/outputs/output-viewer";

export default async function OutputPage({ params }: { params: Promise<{ id: string; cellId: string; index: string }> }) {
  const { id, cellId, index } = await params;
  return <OutputViewer noteId={id} cellId={cellId} index={Number(index)} />;
}
