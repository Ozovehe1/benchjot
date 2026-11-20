"use client";
// After an update, a tab that was already open keeps running the code it loaded (a phone's browser
// tab can stay open for days). This asks the server which build it runs when the tab comes back to
// the front and every 10 minutes, and when it's newer, offers a reload. Notes are saved as you type,
// so reloading loses nothing.
import { useEffect, useState } from "react";
import { APP_BUILD } from "@/config/build";

const EVERY_MS = 10 * 60_000;

/** Whether the server runs a different build than this tab ("dev" never asks). */
export async function newerBuild(fetcher: typeof fetch = fetch): Promise<boolean> {
  if (APP_BUILD === "dev") return false;
  try {
    const res = await fetcher("/api/version", { cache: "no-store" });
    if (!res.ok) return false;
    const { build } = (await res.json()) as { build?: unknown };
    return typeof build === "string" && build !== "dev" && build !== APP_BUILD;
  } catch {
    return false; // offline, or the server is busy: ask again later
  }
}

export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void newerBuild().then((yes) => live && yes && setStale(true));
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    const timer = window.setInterval(check, EVERY_MS);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
      window.clearInterval(timer);
    };
  }, []);
  if (!stale) return null;
  return (
    <div role="status" className="sticky top-0 z-40 flex min-h-10 items-center justify-center gap-3 border-b border-line bg-raise/95 px-4 py-1.5 text-center text-sm text-fg">
      <span>Benchjot was updated.</span>
      <button type="button" onClick={() => window.location.reload()} className="font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-fg/40">
        Reload
      </button>
    </div>
  );
}
