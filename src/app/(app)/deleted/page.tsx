import type { Metadata } from "next";
import { RecentlyDeleted } from "@/components/notes/recently-deleted";

export const metadata: Metadata = { title: "Recently deleted" };

export default function RecentlyDeletedPage() {
  return <RecentlyDeleted />;
}
