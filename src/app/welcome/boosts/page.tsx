import { redirect } from "next/navigation";
import { ConnectAi } from "@/components/account/connect-ai";
import { ContinueSetup } from "@/components/account/continue-setup";
import { Logo } from "@/components/ui";
import { connectionGate, currentAccount } from "@/lib/server/account";

export const metadata = { title: "Connect your free AI" };

// The step after choosing a username: connecting the user's own free AI (OpenRouter), about a
// minute, with directions and what it changes. Everyone passes through it and nothing is required:
// the way on is always at the bottom, and the app offers it again where it's needed (ConnectPrompt).
// The same card is in Settings.
export default async function BoostsPage() {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (!account.username) redirect("/welcome");
  const gate = await connectionGate();
  return (
    <div className="mx-auto w-full max-w-[520px] px-5 pb-16">
      <header className="flex h-16 items-center">
        <Logo />
      </header>
      <main className="pt-6">
        <p className="font-mono text-[12px] text-faint">Step 2 of 2 · about a minute</p>
        <h1 className="mt-2 text-[28px] font-medium leading-tight tracking-tight">Connect your free AI</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Fix and the assistant run on a free OpenRouter account that belongs to you. No card, and it stays under your control. Code runs in your browser, and on Benchjot’s server with a GPU when it needs one.
        </p>
        <div className="mt-8 space-y-6">
          <div className="rounded-xl border border-line p-5">
            <ConnectAi next="/welcome/boosts" />
          </div>
        </div>
        <ContinueSetup connected={gate.aiConnected} />
      </main>
    </div>
  );
}
