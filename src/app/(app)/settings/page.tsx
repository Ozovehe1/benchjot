import { Settings } from "@/components/settings";
import { serverSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const {
    data: { user },
  } = await (await serverSupabase()).auth.getUser();
  return <Settings email={user?.email ?? ""} />;
}
