"use client";
// The way out of the connect step (/welcome/boosts): always there, so nothing is forced. It notes
// that this browser has been through the step (SETUP_COOKIE), then opens the app.
import { SETUP_COOKIE_VALUE } from "@/lib/web/setup";
import { Button, TextButton } from "../ui";

export function ContinueSetup({ connected }: { connected: boolean }) {
  const go = () => {
    document.cookie = SETUP_COOKIE_VALUE;
    window.location.assign("/");
  };
  if (connected) {
    return (
      <Button onClick={go} className="mt-8 w-full">
        Continue to Benchjot
      </Button>
    );
  }
  return (
    <div className="mt-6 text-center">
      <TextButton onClick={go}>Continue without AI</TextButton>
      <p className="mt-1 text-sm text-muted">Fix and the assistant stay off until you connect. Benchjot offers it again when you use them.</p>
    </div>
  );
}
