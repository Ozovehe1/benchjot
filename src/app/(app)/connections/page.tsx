import { redirect } from "next/navigation";

// Connections moved into Data, as its Sources part.
export default function ConnectionsPage() {
  redirect("/data");
}
