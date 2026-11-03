import { EntryList } from "@/components/entry-list";
import { InstallHint } from "@/components/install-hint";
import { ButtonLink, Logo, TextLink } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase/server";

// A real snippet and the output Benchjot's in-browser Python prints for it.
const SAMPLE = [
  [["kw", "import"], ["", " statistics "], ["kw", "as"], ["", " st"]],
  [],
  [["", "runs = ["], ["num", "0.91"], ["", ", "], ["num", "0.93"], ["", ", "], ["num", "0.89"], ["", ", "], ["num", "0.94"], ["", "]"]],
  [["", "print("], ["str", 'f"mean {st.mean(runs):.3f}"'], ["", ")"]],
] as const;
const SAMPLE_OUTPUT = "mean 0.917";
const tone = { kw: "text-[var(--hl-keyword)]", num: "text-[var(--hl-number)]", str: "text-[var(--hl-string)]", "": "" } as const;

function CodePreview() {
  return (
    <figure aria-label="Example: a Python snippet and its output" className="overflow-hidden rounded-md border border-line bg-tint font-mono text-[12.5px] leading-[1.7]">
      <div className="flex h-10 items-center justify-between border-b border-line pl-3 pr-1.5 text-xs text-muted">
        <span>eval.py</span>
        <span aria-hidden className="rounded bg-accent px-3 py-1 font-sans font-medium text-accent-ink">
          Run
        </span>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5">
        {SAMPLE.map((line, i) => (
          <div key={i}>
            {line.length === 0 ? " " : line.map(([t, text], j) => <span key={j} className={tone[t]}>{text}</span>)}
          </div>
        ))}
      </pre>
      <pre className="border-t border-line px-3 py-2.5 text-fg">{SAMPLE_OUTPUT}</pre>
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
      <header className="flex h-16 items-center">
        <Logo />
      </header>

      <main className="flex flex-1 flex-col justify-center pb-8">
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-tight">Write, run and fix code on your phone.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Notes and code, organised in projects. Python and JavaScript run right in the browser.
        </p>
        <div className="mt-7">
          <CodePreview />
        </div>

        <nav aria-label="Account" className="mt-8 flex flex-col">
          <ButtonLink href="/login?mode=signup" className="w-full">
            Create account
          </ButtonLink>
          <TextLink href="/login" strong className="w-full justify-center">
            Sign in
          </TextLink>
          <InstallHint />
        </nav>
      </main>
    </div>
  );
}
