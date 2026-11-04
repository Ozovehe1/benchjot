import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await serverSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  // Every account needs a username; Google sign-ups and older accounts choose one first.
  const { data: profile } = await sb.from("profiles").select("username").eq("user_id", user.id).maybeSingle();
  if (!profile?.username) redirect("/welcome");
  return children;
}
