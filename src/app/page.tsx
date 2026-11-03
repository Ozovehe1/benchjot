import { EntryList } from "@/components/entry-list";
import { ButtonLink, Logo, TextLink } from "@/components/ui";
import { APP_DESCRIPTION } from "@/config/app";
import { serverSupabase } from "@/lib/supabase/server";

// One jotter entry: project, title, a hypothesis, code with the output
// Benchjot's in-browser Python prints for it, and the takeaway.
const SAMPLE = [
  [["", "acc = {"], ["num", "0.1"], ["", ": ["], ["num", "91.8"], ["", ", "], ["num", "92.4"], ["", ", "], ["num", "92.1"], ["", "],"]],
  [["", "       "], ["num", "0.3"], ["", ": ["], ["num", "90.9"], ["", ", "], ["num", "90.7"], ["", ", "], ["num", "91.1"], ["", "]}"]],
  [["kw", "for"], ["", " p, r "], ["kw", "in"], ["", " acc.items():"]],
  [["", "    print(p, round(sum(r) / len(r), "], ["num", "1"], ["", "))"]],
] as const;
const SAMPLE_OUTPUT = "0.1 92.1\n0.3 90.9";
const tone = { kw: "text-[var(--hl-keyword)] font-medium", num: "text-[var(--hl-number)]", str: "text-[var(--hl-string)]", "": "" } as const;

function EntryPreview() {
  return (
    <figure aria-label="Example jotter entry: a note, a Python snippet, its output and a takeaway" className="rounded-md border border-line px-3.5 pb-3 pt-2.5">
      <p className="font-mono text-[11px] text-faint">Project: tokenizer study</p>
      <p className="mt-1 text-[15px] font-semibold">Exp 3 — dropout 0.1 vs 0.3</p>
      <p className="mt-1 text-[13px] leading-snug text-muted">
        <strong className="font-medium text-fg">Hypothesis:</strong> lower dropout helps on the small set.
      </p>
      <div className="mt-2.5 overflow-hidden rounded border border-line bg-tint font-mono text-[11.5px] leading-[1.65]">
        <div className="flex h-8 items-center justify-between border-b border-line pl-2.5 pr-1 text-[11px] text-muted">
          <span>dropout.py</span>
          <span aria-hidden className="rounded-sm bg-fg px-2.5 py-0.5 font-sans font-medium text-bg">
            Run
          </span>
        </div>
        <pre className="overflow-x-auto px-2.5 py-2">
          {SAMPLE.map((line, i) => (
            <div key={i}>
              {line.map(([t, text], j) => <span key={j} className={tone[t]}>{text}</span>)}
            </div>
          ))}
        </pre>
        <pre className="border-t border-line px-2.5 py-2 text-fg">{SAMPLE_OUTPUT}</pre>
      </div>
      <p className="mt-2.5 text-[13px] leading-snug">0.1 wins by 1.2 pts, keep it.</p>
    </figure>
  );
}

// Home: the list for signed-in users, a one-screen landing page for everyone else.
export default async function Home() {
  const {
    data: { user },
  } = await (await serverSupabase()).auth.getUser();
  if (user) return <EntryList />;
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pb-6">
      <header className="flex h-14 items-center">
        <Logo />
      </header>

      <main className="flex flex-1 flex-col justify-center pb-8">
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-tight">{APP_DESCRIPTION}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Write notes, keep snippets, organise them in projects, and run Python and JavaScript right on your phone.
        </p>
        <div className="mt-6">
          <EntryPreview />
        </div>

        <nav aria-label="Account" className="mt-6 flex flex-col">
          <ButtonLink href="/login?mode=signup" className="w-full">
            Create account
          </ButtonLink>
          <TextLink href="/login" strong className="w-full justify-center">
            Sign in
          </TextLink>
        </nav>
      </main>
    </div>
  );
}
