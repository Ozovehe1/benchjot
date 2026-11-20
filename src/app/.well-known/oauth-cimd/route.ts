// GET /.well-known/oauth-cimd — Benchjot's Client ID Metadata Document for Hugging Face sign-in.
// Its own URL is the client_id (lib/server/huggingface.ts): Hugging Face fetches it to learn the app's
// name, logo and the one address it may send users back to. Public, and holds nothing secret.
import { NextResponse } from "next/server";
import { appOrigin, clientMetadata } from "@/lib/server/huggingface";

export const runtime = "nodejs";

export function GET(request: Request) {
  return NextResponse.json(clientMetadata(appOrigin(request)), { headers: { "cache-control": "public, max-age=3600" } });
}
