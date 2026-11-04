import type { Metadata } from "next";
import { NoteMap } from "@/components/note-map";

export const metadata: Metadata = { title: "Map" };

export default function MapPage() {
  return <NoteMap />;
}
