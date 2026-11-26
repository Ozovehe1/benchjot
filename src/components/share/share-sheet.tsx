"use client";
// "Share" in a note, laid out as the best sharing dialogs are (Google Docs, Figma, Notion): one
// invite field, the people with access (you as owner first), general access as a single row with
// a choice, and Copy link as the one main action. Everything else (what readers see, copying,
// search engines, when sharing ends, views, new link, stop sharing) sits folded under Settings.
// Invites happen in Benchjot (the note appears under the person's Shared with me; no email).
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/ui/format";
import { copyText } from "@/lib/ui/copy";
import { userMessage } from "@/lib/ui/user-message";
import { endOfDay, expiryText, localDay, sharePath } from "@/lib/share/share";
import { inviteToShare, removeFromShare, resetShare, startSharing, stopSharing, updateShare, useShare, useSharePeople, type ShareOptions } from "@/lib/data/shares";
import { Button, IconCheck, IconChevron, IconGlobe, IconLink, IconLock, IconX, Notice, Spinner } from "../ui";

export type ShareSheetHandle = { open: () => void };

const endsLabel = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/** When sharing ends, as a calendar: the date reads as text and the device's own date picker opens on tap; Clear removes the end. */
function EndsOn({ value, onChange, disabled }: { value: string | null; onChange: (at: string | null) => void; disabled?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <span className="relative inline-flex items-center gap-1 rounded-md px-1 py-0.5 focus-within:ring-2 focus-within:ring-fg/40 hover:bg-tint">
        <span className={cn("text-[14px]", value ? "text-fg" : "text-muted")}>{value ? endsLabel.format(new Date(value)) : "No end date"}</span>
        <IconChevron aria-hidden className="size-3 rotate-90 text-muted" />
        <input
          type="date"
          aria-label="Sharing ends on"
          min={localDay(Date.now() + 86_400_000)}
          value={value ? localDay(value) : ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value ? endOfDay(e.target.value) : null)}
          className="absolute inset-0 cursor-pointer opacity-0 [color-scheme:dark]"
        />
      </span>
      {value && (
        <button type="button" disabled={disabled} onClick={() => onChange(null)} className="text-xs text-faint hover:text-fg">
          Clear
        </button>
      )}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-tint text-[13px] font-medium uppercase text-fg">{name.slice(0, 1)}</span>;
}

function Toggle({ label, on, disabled, onChange, hint }: { label: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className="flex min-h-11 w-full items-center justify-between gap-4 text-left disabled:opacity-50">
      <span className="min-w-0 text-[14px] text-fg">
        {label}
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </span>
      <span aria-hidden className={cn("inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors", on ? "bg-fg" : "bg-line")}>
        <span className={cn("size-4 rounded-full bg-bg transition-transform", on && "translate-x-4")} />
      </span>
    </button>
  );
}

/** A choice that reads as text with an arrow; the device's own picker opens on tap (a native select laid over it, so nothing clips). */
function Choice<T extends string>({ label, value, options, onChange, disabled, strong }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean; strong?: boolean }) {
  return (
    <span className="relative -ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 focus-within:ring-2 focus-within:ring-fg/40 hover:bg-tint">
      <span className={cn("text-[14px]", strong ? "font-medium text-fg" : "text-muted")}>{options.find((o) => o.value === value)?.label}</span>
      <IconChevron aria-hidden className="size-3 rotate-90 text-muted" />
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)} className="absolute inset-0 cursor-pointer opacity-0">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </span>
  );
}

export const ShareSheet = forwardRef<ShareSheetHandle, { noteId: string; title: string }>(function ShareSheet({ noteId, title }, ref) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { data: row, isLoading, error: loadError, mutate } = useShare(noteId);
  const { data: people } = useSharePeople(noteId, Boolean(row));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ who: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [settings, setSettings] = useState(false);
  useImperativeHandle(ref, () => ({
    open: () => {
      setError(null);
      setAdded(null);
      setCopied(false);
      setSettings(false);
      void mutate();
      dialog.current?.showModal();
    },
  }), [mutate]);

  async function act(what: string, fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(what);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as { friendly?: string }).friendly ?? userMessage(e, "share"));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function invite() {
    const who = name.trim().replace(/^@/, "");
    if (!who) return;
    const ok = await act("invite", async () => {
      if (!row) await startSharing(noteId);
      await inviteToShare(noteId, who);
    });
    if (ok) {
      setName("");
      setAdded({ who });
    }
  }

  /** Copy link: makes the link first when the note isn't shared yet (only the people added can open it then). */
  async function copyLink() {
    let r = row;
    if (!r && !(await act("copy", async () => { r = await startSharing(noteId); }))) return;
    if (!r) return;
    const url = `${window.location.origin}${sharePath(r.token)}`;
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else setError(`Copy this link: ${url}`);
  }

  const set = (patch: ShareOptions) => void act("options", () => updateShare(noteId, patch));
  const access = row?.access ?? "people";
  const ends = row ? expiryText(row.expires_at) : null;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="share-title"
      onClick={(e) => e.target === dialog.current && !busy && dialog.current.close()}
      className="m-auto w-[min(30rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-bg p-0 text-fg shadow-float backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
        <h2 id="share-title" tabIndex={-1} autoFocus className="min-w-0 truncate text-[17px] font-medium outline-none">
          Share <span className="text-muted">“{title}”</span>
        </h2>
        <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="-mr-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-muted outline-none hover:bg-tint hover:text-fg focus-visible:ring-2 focus-visible:ring-fg/40">
          <IconX className="size-4" />
        </button>
      </div>

      <div className="max-h-[72dvh] overflow-y-auto px-5 pb-4">
        {isLoading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted"><Spinner className="size-4" /> Loading…</p>
        ) : loadError && !row ? (
          <Notice className="mt-3" actions={[{ label: "Try again", onClick: () => void mutate() }]}>{userMessage(loadError, "share")}</Notice>
        ) : (
          <>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void invite();
              }}
            >
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setAdded(null); }}
                placeholder="Add people by username"
                aria-label="Username to share with"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-transparent px-3.5 text-[15px] outline-none placeholder:text-faint focus:border-faint"
              />
              <Button type="submit" size="sm" loading={busy === "invite"} disabled={!name.trim() || busy !== null} className="h-11 px-4">Invite</Button>
            </form>
            <p className="mt-1.5 text-xs text-faint" role="status">
              {added
                ? `Invited @${added.who}. They accept it on their home.`
                : "They get an invitation to accept in Benchjot."}
            </p>

            <p className="mt-5 text-xs font-medium text-muted">People with access</p>
            <ul className="mt-1">
              <li className="flex min-h-12 items-center gap-3">
                <Avatar name="Y" />
                <span className="flex-1 text-[14px]">You</span>
                <span className="text-xs text-faint">Owner</span>
              </li>
              {(row ? people ?? [] : []).map((p) => (
                <li key={p.user_id} className="group flex min-h-12 items-center gap-3">
                  <Avatar name={p.username ?? "?"} />
                  <span className="min-w-0 flex-1 truncate text-[14px]">@{p.username ?? "someone"}</span>
                  <span className="text-xs text-faint">{p.accepted ? "Can read" : "Invited"}</span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => row && void act(`remove-${p.user_id}`, () => removeFromShare(noteId, p.user_id, row.token))}
                    aria-label={`Remove @${p.username ?? "them"}`}
                    className="-mr-2 flex size-9 items-center justify-center rounded-lg text-faint hover:bg-tint hover:text-fg disabled:opacity-40"
                  >
                    {busy === `remove-${p.user_id}` ? <Spinner className="size-3.5" /> : <IconX className="size-3.5" />}
                  </button>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-xs font-medium text-muted">General access</p>
            <div className="mt-1 flex min-h-14 items-center gap-3">
              <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", access === "link" ? "bg-fg text-bg" : "bg-tint text-muted")}>
                {access === "link" ? <IconGlobe className="size-4" /> : <IconLock className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <Choice
                  label="Who can open the link"
                  strong
                  value={access}
                  disabled={busy !== null}
                  options={[{ value: "people", label: "Only people added" }, { value: "link", label: "Anyone with the link" }]}
                  onChange={(v) => void act("options", () => (row ? updateShare(noteId, { access: v }) : startSharing(noteId, v)))}
                />
                <span className="block text-xs text-faint">{access === "link" ? "Anyone with the link can read it. No account needed." : "Only the people above can open the link."}</span>
              </div>
            </div>

            {row && (
              <div className="mt-2 border-t border-line">
                <button type="button" aria-expanded={settings} onClick={() => setSettings((s) => !s)} className="flex min-h-11 w-full items-center gap-2 text-left text-[13px] text-muted hover:text-fg">
                  <IconChevron className={cn("size-3.5 transition-transform", settings && "rotate-90")} />
                  Settings
                  <span className="ml-auto text-xs text-faint">{[`${row.views} view${row.views === 1 ? "" : "s"}`, ends].filter(Boolean).join(" · ")}</span>
                </button>
                {settings && (
                  <div className="pb-2 pl-5">
                    <Toggle label="Show the code" hint={row.show_code ? undefined : "Readers see the text and results only."} on={row.show_code} disabled={busy !== null} onChange={(v) => set({ show_code: v })} />
                    <Toggle label="Readers can copy it" hint={row.show_code ? undefined : "Needs the code shown."} on={row.allow_copy && row.show_code} disabled={busy !== null || !row.show_code} onChange={(v) => set({ allow_copy: v })} />
                    {row.access === "link" && <Toggle label="Search engines can list it" on={row.indexable} disabled={busy !== null} onChange={(v) => set({ indexable: v })} />}
                    <div className="flex min-h-11 items-center justify-between gap-3">
                      <span className="text-[14px]">Ends</span>
                      <EndsOn value={row.expires_at} onChange={(at) => set({ expires_at: at })} disabled={busy !== null} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                      <button type="button" disabled={busy !== null} className="min-h-10 text-muted hover:text-fg"
                        onClick={() => window.confirm("Make a new link? The current one stops working now; people you added keep access.") && void act("reset", () => resetShare(noteId, row.token))}>
                        {busy === "reset" ? "Making…" : "New link"}
                      </button>
                      <button type="button" disabled={busy !== null} className="min-h-10 text-fail hover:brightness-125"
                        onClick={() => window.confirm("Stop sharing? The link and everyone’s access end now.") && void act("stop", () => stopSharing(noteId, row.token))}>
                        {busy === "stop" ? "Stopping…" : "Stop sharing"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {error && <Notice className="mt-3" onDismiss={() => setError(null)}>{error}</Notice>}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        {row ? (
          <a href={sharePath(row.token)} target="_blank" rel="noopener" className="text-[13px] text-muted hover:text-fg">Open page</a>
        ) : (
          <span className="text-xs text-faint">Not shared yet</span>
        )}
        <Button size="sm" variant="soft" onClick={() => void copyLink()} loading={busy === "copy"} className="h-10 px-4">
          {copied ? <IconCheck className="size-4" /> : <IconLink className="size-4" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </dialog>
  );
});
