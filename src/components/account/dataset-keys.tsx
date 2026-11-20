"use client";
// Settings → Connections → Hugging Face: for gated and private Hugging Face models and datasets in
// server runs. One tap opens huggingface.co; the user signs in and taps Allow; they come back
// connected. Benchjot receives a read-only token (sealed on our server, never shown) that server runs
// get as HF_TOKEN. Pasting a token by hand is still there, under "How it works".
import { useEffect, useState } from "react";
import { datasetKeyStatus, saveHfToken, setDatasetKeys, type DatasetKeyStatus } from "@/lib/account/auth";
import { userMessage } from "@/lib/ui/user-message";
import { Button, ButtonLink, FIELD, TextButton } from "../ui";
import { ConnectionRow, Steps } from "./connection-row";

/** What ?hf= says when the user comes back from Hugging Face. */
const RESULT: Record<string, string> = {
  connected: "Hugging Face connected. Server runs can now download the gated and private models and datasets your account can open.",
  cancelled: "Nothing was connected.",
  failed: "Couldn’t finish connecting. Try again.",
  expired: "That sign-in took too long or finished in another browser. Tap Connect Hugging Face again, in this browser.",
  unavailable: "Connecting isn’t available right now. Try again later.",
};

/** Said when Hugging Face no longer accepts the connection (the access was removed on huggingface.co). */
const REMOVED = "Benchjot’s access was removed on Hugging Face, so it’s disconnected here too. Connect again to use gated and private models.";

export function DatasetKeys({ next = "/settings" }: { next?: string }) {
  const [status, setStatus] = useState<DatasetKeyStatus | null>(null);
  const [hf, setHf] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = () =>
    datasetKeyStatus().then((s) => {
      if (!s) return;
      setStatus(s);
      if (s.hfRemoved) setMessage(REMOVED);
    });
  useEffect(() => {
    void load();
    const result = new URLSearchParams(window.location.search).get("hf");
    if (result && RESULT[result]) setMessage(RESULT[result]);
  }, []);

  async function finish(error: { message: string; code?: string } | null, done: string) {
    setBusy(false);
    if (error) return setMessage(error.code === "notice" ? error.message : userMessage(error));
    setHf("");
    setMessage(done);
    await load();
  }

  const connected = Boolean(status?.hf);
  return (
    <ConnectionRow
      id="hugging-face"
      name="Hugging Face"
      status={!connected ? "Not connected" : status?.hfUser ? `Connected as @${status.hfUser}` : status?.hfBy === "token" ? "Connected with a token" : "Connected"}
      action={
        connected ? (
          <TextButton
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await finish((await setDatasetKeys({ hf_token: "" })).error, "Hugging Face disconnected.");
            }}
          >
            Disconnect
          </TextButton>
        ) : (
          <ButtonLink href={`/api/hf/connect?next=${encodeURIComponent(next)}`} prefetch={false} size="sm">
            Connect
          </ButtonLink>
        )
      }
      description="For gated and private models and datasets in server runs (Llama, Gemma and others). Public models need nothing."
      message={message}
      details={
        <>
          <Steps
            steps={[
              "Hugging Face opens. Sign in (free).",
              <>
                Tap <span className="text-fg">Allow</span>. Benchjot can read your models and datasets; it can’t change anything on your account.
              </>,
              "You come back here, connected. Server runs get it as HF_TOKEN.",
            ]}
          />
          <p>For a gated model, also accept its terms once on its Hugging Face page.</p>
          {connected && status?.hfBy !== "token" && (
            <a href="https://huggingface.co/settings/connected-applications" target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center underline underline-offset-4">
              Manage on Hugging Face
            </a>
          )}
          {!connected && (
            <div className="pt-2">
              <p>
                Or paste a Read token from{" "}
                <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
                  huggingface.co → Settings → Access Tokens
                </a>{" "}
                (starts with hf_):
              </p>
              <div className="mt-2 flex gap-2">
                <input aria-label="Hugging Face token" placeholder="hf_…" type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={hf} onChange={(e) => setHf(e.target.value)} className={`${FIELD} h-11`} />
                <Button
                  size="sm"
                  variant="neutral"
                  disabled={busy || hf.trim() === ""}
                  onClick={async () => {
                    setBusy(true);
                    setMessage("");
                    await finish((await saveHfToken(hf)).error, "Hugging Face token saved.");
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </>
      }
    />
  );
}
