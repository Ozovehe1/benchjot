import { Settings } from "@/components/settings";
import { serverSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const sb = await serverSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const { data: profile } = user ? await sb.from("profiles").select("username").eq("user_id", user.id).maybeSingle() : { data: null };
  return <Settings email={user?.email ?? ""} username={profile?.username ?? ""} />;
}
