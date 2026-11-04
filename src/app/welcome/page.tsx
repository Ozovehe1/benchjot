import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";
import { suggestUsername } from "@/lib/username";
import { ChooseUsername } from "@/components/choose-username";

export const metadata = { title: "Choose a username" };

export default async function WelcomePage() {
  const sb = await serverSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await sb.from("profiles").select("username").eq("user_id", user.id).maybeSingle();
  if (profile?.username) redirect("/");
  return <ChooseUsername suggestion={suggestUsername(user.email)} />;
}
