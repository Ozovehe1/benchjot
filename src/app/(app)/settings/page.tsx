import { Settings } from "@/components/account/settings";
import { currentAccount } from "@/lib/server/account";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const account = await currentAccount();
  return <Settings email={account?.email ?? ""} username={account?.username ?? ""} />;
}
