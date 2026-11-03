"use client";
import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";
import { Toaster } from "sonner";
import { SaveStatusProvider } from "@/lib/autosave";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} themes={["dark", "light"]} disableTransitionOnChange>
      <SWRConfig value={{ revalidateOnFocus: false, errorRetryCount: 2 }}>
        <SaveStatusProvider>{children}</SaveStatusProvider>
      </SWRConfig>
      <Toaster position="top-center" theme="system" toastOptions={{ className: "!rounded-xl !border-border !bg-surface !text-fg" }} />
    </ThemeProvider>
  );
}
