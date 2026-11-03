import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const {
    data: { user },
  } = await (await serverSupabase()).auth.getUser();
  if (!user) redirect("/login");
  return children;
}
