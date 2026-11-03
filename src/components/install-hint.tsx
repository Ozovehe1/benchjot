"use client";
// A quiet "Install app" line for Android. Uses the browser's install prompt when
// Chrome offers one; otherwise says where the menu item is. Hidden once installed.
import { useEffect, useState } from "react";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

export function InstallHint() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const installed = window.matchMedia("(display-mode: standalone)").matches;
    setShow(!installed && /android/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!show) return null;
  return prompt ? (
    <button type="button" onClick={() => void prompt.prompt()} className="h-12 w-full text-sm text-muted underline underline-offset-4 hover:text-fg">
      Install app
    </button>
  ) : (
    <p className="flex h-12 items-center justify-center text-sm text-faint">To install: browser menu ⋮ → Install app</p>
  );
}
