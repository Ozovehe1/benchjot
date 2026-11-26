import { NoteView } from "@/components/notes/note-view";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NoteView key={id} id={id} />;
}
