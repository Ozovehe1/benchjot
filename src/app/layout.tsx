import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { APP_DESCRIPTION, APP_NAME } from "@/config/app";
import { BRAND } from "@/lib/brand";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${APP_NAME} · ${APP_DESCRIPTION}`, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: BRAND.charcoal,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning style={{ "--charcoal": BRAND.charcoal, "--ash": BRAND.ash } as React.CSSProperties}>
      <body className="min-h-dvh font-sans text-[15px] leading-normal antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
