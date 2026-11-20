import { ImageResponse } from "next/og";
import { APP_NAME } from "@/config/app";
import { OUTCOME_LABEL } from "@/lib/notes/outcome";
import { loadShared } from "@/lib/server/shared-note";
import { shareDescription } from "@/lib/share/share";
import { BRAND, logoSvg } from "@/lib/ui/brand";
import { displayTitle } from "@/lib/ui/format";

// The card a shared link shows in chats and feeds: the note's title, its first line, its outcome,
// who shared it, and the mark. From the same cached read as the page; an inactive link gets a plain card.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A note shared on Benchjot";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await loadShared(token).catch(() => null);
  // A note shared with invited people shows nothing of itself to a preview (it has no sign-in).
  const page = found?.kind === "note" ? found.page : null;
  const title = page ? displayTitle(page.note.note.title) : found?.kind === "restricted" ? "A note shared with specific people" : "This link isn’t active";
  const line = page ? shareDescription(page.note.note.notes, 140) : "";
  const outcome = page?.note.note.outcome ? OUTCOME_LABEL[page.note.note.outcome] : null;
  const by = page?.note.author ? `@${page.note.author}` : null;
  const logo = `data:image/svg+xml;base64,${Buffer.from(logoSvg({ padding: 0.18 })).toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: BRAND.charcoal, color: BRAND.ash, padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30, opacity: 0.85 }}>
          <img src={logo} width={56} height={56} alt="" style={{ borderRadius: 12 }} />
          <span>{APP_NAME}</span>
          <span style={{ opacity: 0.5 }}>· shared note</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: title.length > 60 ? 54 : 68, lineHeight: 1.1, letterSpacing: -1, display: "flex" }}>{title.length > 110 ? `${title.slice(0, 109)}…` : title}</div>
          {line && <div style={{ fontSize: 30, lineHeight: 1.35, opacity: 0.7, display: "flex" }}>{line}</div>}
        </div>
        <div style={{ display: "flex", gap: 24, fontSize: 28, opacity: 0.8 }}>
          {outcome && <span style={{ border: `2px solid ${BRAND.ash}55`, borderRadius: 999, padding: "6px 20px" }}>{outcome}</span>}
          {by && <span style={{ padding: "8px 0" }}>{by}</span>}
        </div>
      </div>
    ),
    size,
  );
}
