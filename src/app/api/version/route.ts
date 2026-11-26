// GET /api/version — which build of the app the server is running, so a tab opened before an
// update can tell it is out of date (components/app/update-banner.tsx). Public: it says nothing else.
import { NextResponse } from "next/server";
import { APP_BUILD } from "@/config/build";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ build: APP_BUILD }, { headers: { "cache-control": "no-store" } });
}
