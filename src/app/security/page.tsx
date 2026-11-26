import Link from "next/link";
import { IconClock, IconCode, IconEye, IconLink, IconLock, IconMail, IconSearch, IconShield, IconUndo } from "@/components/ui";
import { Folder, Folders, Glance, LegalPage } from "@/components/app/legal-page";

export const metadata = { title: "Security" };

// How Benchjot keeps notes and connected keys, in plain words. Every claim here is what the code
// does (lib/server/secret-box.ts, the private schema's own-row functions, tests/boundaries.test.ts).
export default function SecurityPage() {
  return (
    <LegalPage path="/security" title="Security" updated="26 November 2026" lead="Your notes are private to you, enforced by the database itself.">
      <Glance
        items={[
          { value: "Private", label: "every note, by default" },
          { value: "AES-256", label: "keys encrypted before storage" },
          { value: "HTTPS", label: "everything in transit" },
          { value: "Isolated", label: "server runs, discarded after" },
        ]}
      />
      <Folders title="Your notes">
        <Folder icon={IconLock} title="Private notes" summary="Row-level security: only your account can read them.">
          <p>Every note, code cell and output is private to your account. The database enforces that itself (row-level security), so even a bug in the app can’t show your notes to someone else.</p>
        </Folder>
        <Folder icon={IconLink} title="Shared notes" summary="Only when you share; stopping takes effect at once.">
          <p>A note is shared only when you share it. Its link carries a random 128-bit code, made by the database, that can’t be guessed. The database checks every open: who you added, or whether the link is open to anyone, and whether it has ended.</p>
          <p>A shared note’s figures open only through its link and only from its current run; nothing else in your account can be read or listed through it. Stopping, a new link or removing someone takes effect at once; a figure address already handed out stops working within two minutes.</p>
        </Folder>
        <Folder icon={IconSearch} title="Search by meaning" summary="Runs inside Benchjot's database, not an outside AI.">
          <p>So the assistant can find a related note even when it uses other words, Benchjot keeps a search index of your notes: lists of numbers worked out from each note’s text by a small model that runs inside Benchjot’s database service (Supabase), not by an outside AI. Only your account can search yours, and a note’s index goes when the note is deleted for good.</p>
        </Folder>
      </Folders>
      <Folders title="AI">
        <Folder icon={IconEye} title="What the AI reads" summary="Only what you ask about, sent to our AI provider.">
          <p>AI needs no account of yours: it runs on Benchjot’s own account with its AI provider, currently Anthropic. The assistant reads a note only when you send it a message, and Fix only the cell you ask it to fix. That text goes to the AI provider to get the answer, and it doesn’t train its models on it. A sent question never changes your note: its code is added only when you tap Insert.</p>
          <p>To know what a figure, chart or animation shows, the assistant sends that picture to the AI, and keeps the few sentences it gets back with that run. When your request needs another of your notes, it reads that note (never changes it) and may send what it found to the AI with your question. Only your own notes: never anyone else’s.</p>
        </Folder>
        <Folder icon={IconUndo} title="What the AI can change" summary="This note only, when asked. Undo puts it all back.">
          <p>When you ask the assistant for work to be done in the note, typed or spoken, it acts: it adds, changes and runs code cells in that note, the way you would, until your request is done. It reads the note again at each step. It writes in the note’s text only when you ask, never touches cell notes or the outcome, stops when you tap Stop, and Undo puts back everything it changed.</p>
          <p>It can propose a change to another note, but nothing changes there until you tap Apply.</p>
        </Folder>
        <Folder icon={IconClock} title="What we count" summary="Numbers and times only, never content.">
          <p>Benchjot counts how many AI requests and runs each account makes, and what each AI request cost (its credits). It keeps the numbers and times only, never the content. You see your own in Settings under Usage. No page in Benchjot shows them to anyone else.</p>
        </Folder>
      </Folders>
      <Folders title="Keys and code">
        <Folder icon={IconShield} title="Hugging Face key" summary="Encrypted, never shown again, used only for your runs.">
          <p>The one thing you can connect is Hugging Face (one tap), for gated or private models and datasets. When you connect it:</p>
          <ul>
            <li><strong>Encrypted before it’s stored.</strong> Keys are encrypted on our server (AES-256-GCM) before they reach the database. A copy of the database alone reveals none of them.</li>
            <li><strong>Never shown again.</strong> No page displays a key after you connect it, to you or anyone else.</li>
            <li><strong>Used only for your own runs.</strong> Your token is given to your own server runs as HF_TOKEN, because that code needs it to download gated data. It can read your models and datasets and use your free inference credits, but it can’t change anything on your Hugging Face account.</li>
            <li><strong>You stay in control.</strong> Disconnect on the Data page, under Sources, at any time. You can also revoke it on Hugging Face → Settings → Connected Apps (or Access Tokens, for a token you pasted).</li>
          </ul>
        </Folder>
        <Folder icon={IconCode} title="Code you run" summary="Browser runs stay local; server runs are sandboxed.">
          <p>Browser runs stay in your browser. Server runs happen in an isolated sandbox (Modal) that is discarded afterwards, with network access limited to common dataset sites unless you ask for more.</p>
        </Folder>
        <Folder icon={IconLock} title="In transit and at rest" summary="HTTPS, encrypted disks, no stored passwords.">
          <p>Everything between your browser or phone and Benchjot travels encrypted (HTTPS). The database is encrypted on disk (Supabase, AES-256). Passwords are never stored: sign-in keeps only a one-way hash of yours, which can&apos;t be turned back into it.</p>
        </Folder>
      </Folders>
      <Folders title="Contact">
        <Folder icon={IconMail} title="Report a problem" summary="Email us how to reproduce it.">
          <p>If you find a security problem, email abdulcosman01@gmail.com with how to reproduce it. Please don&apos;t look at other people&apos;s data or share the problem publicly until it&apos;s fixed. You&apos;ll get an answer within a few days.</p>
          <p>Questions: abdulcosman01@gmail.com. See also the <Link href="/privacy">privacy policy</Link>.</p>
        </Folder>
      </Folders>
    </LegalPage>
  );
}
