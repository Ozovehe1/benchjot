import { EntryList } from "@/components/entry-list";
import { SampleNoteTag } from "@/components/note-parts";
import { NotePreview } from "@/components/note-preview";
import { ButtonLink, Logo, TextLink } from "@/components/ui";
import { ANDROID_APK_URL, ANDROID_APP_LABEL, APP_DESCRIPTION } from "@/config/app";
import { sampleOutputPath } from "@/lib/paths";
import { SAMPLE_ENTRY, SAMPLE_OUTPUT_URLS, SAMPLE_SNIPPETS } from "@/lib/sample-note";
import { serverSupabase } from "@/lib/supabase/server";

const SAMPLE_HREFS = { urls: SAMPLE_OUTPUT_URLS, hrefs: (SAMPLE_SNIPPETS[0]?.last_run?.outputs?.items ?? []).map((_, i) => sampleOutputPath(i)) };

// Home: the list for signed-in users, a one-screen landing page for everyone else.
export default async function Home() {
  const {
    data: { user },
  } = await (await serverSupabase()).auth.getUser();
  if (user) return <EntryList />;
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pb-6">
      <header className="flex h-14 items-center justify-between">
        <Logo />
        <TextLink href="/login" strong>
          Sign in
        </TextLink>
      </header>

      <main className="flex flex-1 flex-col justify-center pb-8">
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-tight">{APP_DESCRIPTION}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Write notes, keep snippets, organise them in projects, and run Python and JavaScript right on your phone.
        </p>
        <figure aria-label="Sample note" className="mt-8 rounded-md border border-line px-4 pb-1">
          <figcaption className="flex pt-3">
            <SampleNoteTag />
          </figcaption>
          <NotePreview entry={SAMPLE_ENTRY} snippets={SAMPLE_SNIPPETS} outputs={SAMPLE_HREFS} />
        </figure>

        <nav aria-label="Account" className="mt-6 flex flex-col">
          <ButtonLink href="/login?mode=signup" className="w-full">
            Create account
          </ButtonLink>
          <TextLink href="/login" strong className="w-full justify-center">
            Sign in
          </TextLink>
          <TextLink href={ANDROID_APK_URL} prefetch={false} className="w-full justify-center">
            {ANDROID_APP_LABEL}
          </TextLink>
        </nav>
      </main>
      <footer className="mt-10 flex justify-center gap-5 pb-6 text-xs text-faint">
        <TextLink href="/privacy" className="text-xs">Privacy</TextLink>
        <TextLink href="/terms" className="text-xs">Terms</TextLink>
      </footer>
    </div>
  );
}
