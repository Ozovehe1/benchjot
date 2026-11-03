import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { AppShell } from "@/components/shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await serverSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  return <AppShell email={user.email ?? ""}>{children}</AppShell>;
}
