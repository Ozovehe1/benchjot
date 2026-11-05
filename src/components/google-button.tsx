"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { GOOGLE_CLIENT_ID } from "@/lib/env";
import { Button } from "@/components/ui";
import { userMessage } from "@/lib/user-message";

/**
 * Sign in with Google on Benchjot's own origin (Google Identity Services), so
 * Google's prompt names Benchjot instead of the Supabase project domain. The ID
 * token goes to Supabase with signInWithIdToken. If Google's script can't load,
 * falls back to the redirect flow via `onFallback`.
 */

type GoogleId = {
  initialize(o: Record<string, unknown>): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const SCRIPT = "https://accounts.google.com/gsi/client";

function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    const s = existing ?? Object.assign(document.createElement("script"), { src: SCRIPT, async: true });
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => reject(new Error("Google script failed to load")));
    if (!existing) document.head.appendChild(s);
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function GoogleButton(props: {
  onSignedIn: () => void;
  onError: (message: string) => void;
  onFallback: () => void;
  disabled?: boolean;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const handlers = useRef(props);
  handlers.current = props;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadScript();
        if (cancelled || !slot.current || !window.google) return;
        const nonce = crypto.randomUUID();
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: await sha256Hex(nonce), // Google gets the hash, Supabase the raw value
          ux_mode: "popup",
          itp_support: true,
          callback: async ({ credential }: { credential?: string }) => {
            if (!credential) return handlers.current.onError("Google sign-in didn't finish. Try again.");
            const { error } = await supabase().auth.signInWithIdToken({ provider: "google", token: credential, nonce });
            if (error) handlers.current.onError(userMessage(error, "sign_in"));
            else handlers.current.onSignedIn();
          },
        });
        const light = document.documentElement.classList.contains("light");
        window.google.accounts.id.renderButton(slot.current, {
          type: "standard",
          theme: light ? "outline" : "filled_black",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "center",
          width: Math.min(400, slot.current.offsetWidth || 320),
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <Button onClick={props.onFallback} disabled={props.disabled} variant="neutral" className="w-full">
        Continue with Google
      </Button>
    );
  }
  return <div ref={slot} className="flex min-h-12 w-full items-center justify-center" aria-label="Continue with Google" />;
}
