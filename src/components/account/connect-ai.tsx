"use client";
// "Connect AI": the user's own free AI through OpenRouter (Settings, and the step after sign-up).
// One tap opens OpenRouter; they sign in and tap Authorize; they come back connected. Benchjot
// receives a key they control (sealed on our server, never shown), and Fix and the assistant use its
// free allowance and nothing else (Benchjot pays for no free account's AI). They can disconnect here or revoke it on OpenRouter.
import { useEffect, useState } from "react";
import Link from "next/link";
import { aiStatus, disconnectAi, type AiStatus } from "@/lib/account/auth";
import { ButtonLink, TextButton } from "../ui";
import { ConnectionRow, Steps } from "./connection-row";

/** What ?ai= says when the user comes back from OpenRouter. */
const RESULT: Record<string, string> = {
  connected: "AI connected. Fix and the assistant now work, on your own free allowance.",
  cancelled: "Nothing was connected.",
  failed: "Couldn’t finish connecting. Try again.",
  unavailable: "Connecting isn’t available right now. Try again later.",
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** `compact`: the Settings row (status and one action, the steps folded away); otherwise the full card for the sign-up step. */
export function ConnectAi({ next, compact = false }: { next: string; compact?: boolean }) {
  const [status, setStatus] = useState<AiStatus>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void aiStatus().then(setStatus);
    const result = new URLSearchParams(window.location.search).get("ai");
    if (result && RESULT[result]) setMessage(RESULT[result]);
  }, []);

  async function disconnect() {
    setBusy(true);
    const { error } = await disconnectAi();
    setBusy(false);
    if (error) return setMessage(error.message);
    setStatus(null);
    setMessage("Disconnected. Fix and the assistant are off until you connect again.");
  }

  const connect = `/api/ai-key/connect?next=${encodeURIComponent(next)}`;
  if (compact)
    return (
      <ConnectionRow
        id="ai-key"
        name="AI · OpenRouter"
        status={status ? `Connected ${day(status.connectedAt)}${status.usedAt ? ` · last used ${day(status.usedAt)}` : ""}` : "Not connected"}
        action={
          status ? (
            <TextButton disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </TextButton>
          ) : (
            <ButtonLink href={connect} prefetch={false} size="sm">
              Connect
            </ButtonLink>
          )
        }
        description="Runs Fix and the assistant on your own free OpenRouter account. No card."
        message={message}
        details={
          <>
            <Steps
              steps={[
                "OpenRouter opens. Sign in with Google or email (free, no card).",
                <>
                  Tap <span className="text-fg">Authorize</span>. Leave the credit limit as it is: free models need none.
                </>,
                "You come back here, connected.",
              ]}
            />
            <p>Without it, there’s no Fix and no assistant. Notes, runs and export work the same.</p>
            {status && (
              <a href={`https://openrouter.ai/keys/${status.keyHash}`} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center underline underline-offset-4">
                Manage or revoke on OpenRouter
              </a>
            )}
          </>
        }
      />
    );

  return (
    <section id="ai-key" className="scroll-mt-20">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold">Connect AI</h2>
        <span className="text-sm text-faint">{status ? "Connected" : "Not connected"}</span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Benchjot’s AI runs on your own free OpenRouter account. Free, no card.
      </p>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex gap-2"><dt className="w-[72px] shrink-0 text-faint">With it</dt><dd className="text-muted">Fix repairs a failed run, and the assistant answers questions about your note or does the work in it (writes and runs code, writes in the note) when you ask, on your own free daily allowance.</dd></div>
        <div className="flex gap-2"><dt className="w-[72px] shrink-0 text-faint">Without</dt><dd className="text-muted">No Fix and no assistant. Notes, runs and export work the same.</dd></div>
      </dl>

      {status ? (
        <>
          <p className="mt-3 text-sm text-muted">
            Connected {day(status.connectedAt)}
            {status.usedAt ? ` · last used ${day(status.usedAt)}` : " · not used yet"}.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-5">
            <a href={`https://openrouter.ai/keys/${status.keyHash}`} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-12 items-center text-sm underline underline-offset-4">
              Manage or revoke on OpenRouter
            </a>
            <TextButton disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </TextButton>
          </div>
        </>
      ) : (
        <>
          <ol className="mt-3 space-y-1.5 text-[15px] text-muted">
            <li className="flex gap-3"><span className="font-mono text-[12px] text-faint">1</span><span>OpenRouter opens. Sign in with Google or email (free, no card).</span></li>
            <li className="flex gap-3"><span className="font-mono text-[12px] text-faint">2</span><span>Tap <span className="text-fg">Authorize</span>. Leave the credit limit as it is: free models need none.</span></li>
            <li className="flex gap-3"><span className="font-mono text-[12px] text-faint">3</span><span>You come back here, connected.</span></li>
          </ol>
          <ButtonLink href={connect} prefetch={false} className="mt-4">
            Connect AI
          </ButtonLink>
        </>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-muted">
          {message}
        </p>
      )}
      <p className="mt-3 text-xs text-faint">
        Benchjot never sees your OpenRouter password. The key it receives is encrypted on our server, never shown, and never given to code you run.{" "}
        <Link href="/security" className="underline underline-offset-2">
          How keys are kept
        </Link>
      </p>
    </section>
  );
}
