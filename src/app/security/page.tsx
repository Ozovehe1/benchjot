import Link from "next/link";
import { LegalPage } from "@/components/app/legal-page";

export const metadata = { title: "Security" };

// How Benchjot keeps notes and connected keys, in plain words. Every claim here is what the code
// does (lib/server/secret-box.ts, the private schema's own-row functions, tests/boundaries.test.ts).
export default function SecurityPage() {
  return (
    <LegalPage title="Security" updated="20 November 2026">
      <p>What Benchjot does with your notes and with the accounts you connect, in plain words.</p>
      <h2>Your notes</h2>
      <p>Every note, code cell and output is private to your account. The database enforces that itself (row-level security), so even a bug in the app can’t show your notes to someone else.</p>
      <h2>Shared notes</h2>
      <p>A note is shared only when you share it. Its link carries a random 128-bit code, made by the database, that can’t be guessed. The database checks every open: who you added, or whether the link is open to anyone, and whether it has ended. A shared note’s figures open only through its link and only from its current run; nothing else in your account can be read or listed through it. Stopping, a new link or removing someone takes effect at once; a figure address already handed out stops working within two minutes.</p>
      <h2>Connected accounts and keys</h2>
      <p>Fix and the assistant run on a free AI account of your own, so sign-up walks you through connecting OpenRouter. It isn’t required. Connecting Hugging Face (one tap) is for gated or private models and datasets. When you connect:</p>
      <ul className="list-disc space-y-2 pl-5">
        <li><strong>Encrypted before they’re stored.</strong> Keys are encrypted on our server (AES-256-GCM) before they reach the database. A copy of the database alone reveals none of them.</li>
        <li><strong>Never shown again.</strong> No page displays a key after you connect it, to you or anyone else.</li>
        <li><strong>Used only for your own requests.</strong> Your OpenRouter key answers your Fix and assistant requests. Your Hugging Face connection lets your server runs download the models and datasets your account can open.</li>
        <li><strong>Your AI key is never given to code you run.</strong> Your Hugging Face token, if you connect it, is given to your own server runs as HF_TOKEN, because that code needs it to download gated data. It can read your models and datasets and use your free inference credits, but it can’t change anything on your Hugging Face account.</li>
        <li><strong>You stay in control.</strong> Disconnect in Settings at any time. You can also revoke the key at its source: OpenRouter → Keys, Hugging Face → Settings → Connected Apps (or Access Tokens, for a token you pasted).</li>
      </ul>
      <h2>Connecting AI never shares your password</h2>
      <p>“Connect AI” sends you to OpenRouter, where you sign in and tap Authorize. OpenRouter then gives Benchjot a key for your account that you can limit or revoke there. Benchjot never sees your OpenRouter password.</p>
      <h2>AI and your notes</h2>
      <p>The assistant reads a note only when you send it a message, and Fix only the cell you ask it to fix. That text goes to OpenRouter, through the AI account you connected, to get the answer. A sent question never changes your note: its code is added only when you tap Insert.</p>
      <p>When you ask the assistant for work to be done in the note, typed or spoken, it acts: it adds, changes and runs code cells in that note, the way you would, until your request is done. It reads the note again at each step. It writes in the note’s text only when you ask, never touches cell notes or the outcome, stops when you tap Stop, and Undo puts back everything it changed.</p>
      <p>To know what a figure, chart or animation shows, the assistant sends that picture to a vision model on the same AI account, and keeps the few sentences it gets back with that run. When your request needs another of your notes, it reads that note (never changes it) and may send what it found to the AI with your question. Only your own notes: never anyone else’s. It can propose a change to another note, but nothing changes there until you tap Apply.</p>
      <h2>Search by meaning</h2>
      <p>So the assistant can find a related note even when it uses other words, Benchjot keeps a search index of your notes: lists of numbers worked out from each note’s text by a small model that runs inside Benchjot’s database service (Supabase), not by an outside AI. Only your account can search yours, and a note’s index goes when the note is deleted for good.</p>
      <h2>What we count</h2>
      <p>Benchjot counts how many AI requests and runs each account makes. It keeps the numbers and times only, never the content. You see your own in Settings under Usage. No page in Benchjot shows them to anyone else.</p>
      <h2>Code you run</h2>
      <p>Browser runs stay in your browser. Server runs happen in an isolated sandbox (Modal) that is discarded afterwards, with network access limited to common dataset sites unless you ask for more.</p>
      <h2>In transit and at rest</h2>
      <p>Everything between your browser or phone and Benchjot travels encrypted (HTTPS). The database is encrypted on disk (Supabase, AES-256). Passwords are never stored: sign-in keeps only a one-way hash of yours, which can&apos;t be turned back into it.</p>
      <h2>Reporting a problem</h2>
      <p>If you find a security problem, email abdulcosman01@gmail.com with how to reproduce it. Please don&apos;t look at other people&apos;s data or share the problem publicly until it&apos;s fixed. You&apos;ll get an answer within a few days.</p>
      <h2>Questions</h2>
      <p>
        Email abdulcosman01@gmail.com. See also the <Link href="/privacy" className="underline underline-offset-4">privacy policy</Link>.
      </p>
    </LegalPage>
  );
}
