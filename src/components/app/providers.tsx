"use client";
import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";
import { SaveStatusProvider } from "@/lib/ui/autosave";

export function Providers({ children }: { children: React.ReactNode }) {
  // Browsers that installed the old notifications service worker (sw.js) let it go, with its push subscription.
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.getRegistrations().then((all) => all.forEach((r) => void r.unregister())).catch(() => {});
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <SWRConfig value={{ revalidateOnFocus: false, errorRetryCount: 2 }}>
        <SaveStatusProvider>{children}</SaveStatusProvider>
      </SWRConfig>
    </ThemeProvider>
  );
}
