import { redirect } from "next/navigation";
import { ChooseUsername } from "@/components/account/choose-username";
import { suggestUsername } from "@/lib/account/username";
import { currentAccount } from "@/lib/server/account";

export const metadata = { title: "Choose a username" };

export default async function WelcomePage() {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (account.username) redirect("/");
  return <ChooseUsername suggestion={suggestUsername(account.email)} />;
}
