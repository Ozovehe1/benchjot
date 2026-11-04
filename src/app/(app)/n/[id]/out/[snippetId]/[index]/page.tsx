import { OutputViewer } from "@/components/output-viewer";

export default async function OutputPage({ params }: { params: Promise<{ id: string; snippetId: string; index: string }> }) {
  const { id, snippetId, index } = await params;
  return <OutputViewer noteId={id} snippetId={snippetId} index={Number(index)} />;
}
