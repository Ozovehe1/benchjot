import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { currentAccount } from "@/lib/server/account";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const account = await currentAccount();
  if (!account) redirect("/login");
  // Every account needs a username; Google sign-ups and older accounts choose one first.
  if (!account.username) redirect("/welcome");
  return (
    <AppShell username={account.username}>
      {children}
    </AppShell>
  );
}
