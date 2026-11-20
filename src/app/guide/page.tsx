import Link from "next/link";
import { LegalPage } from "@/components/app/legal-page";

export const metadata = { title: "Guide" };

// A short getting-started guide: the note's loop, where code runs, AI, linking notes, sharing, Android.
export default function GuidePage() {
  return (
    <LegalPage title="Guide" updated="20 November 2026">
      <h2>1. One note per experiment</h2>
      <p>Write your question. Add a code cell, write what you expect above it, and run it. Write what happened below it, and mark the note Successful or Failed.</p>
      <p>Shift+Enter runs a cell. <strong>Run all</strong> runs them in order and stops at the first that fails. Pin a note from More to keep it at the top. Deleted notes wait 30 days in <strong>Recently deleted</strong>.</p>
      <h2>2. Where code runs</h2>
      <p>Python and R run in your browser, free and with nothing to install. Anything the browser can&apos;t run (PyTorch, TensorFlow, Julia, MATLAB, C, C++, Fortran) goes to the server by itself, with a GPU when the code needs one: 10 GPU runs a day, up to an hour each. Code written for a GPU still runs without one, just slower.</p>
      <p>For gated or private Hugging Face models and datasets, tap <strong>Connect Hugging Face</strong> in Settings.</p>
      <h2>3. AI</h2>
      <p>Tap <strong>Connect AI</strong> in Settings and sign in to OpenRouter. It&apos;s free and takes a minute. Then <strong>Fix</strong> suggests a corrected program after an error, and the <strong>Assistant</strong> answers questions about your note or does the work in it, typed or spoken: it writes and runs code until it works. It reads the figures and animations your code draws, and it can look through your other notes, by words or by meaning, and ask them what they found. It never changes another note: it proposes, and you tap <strong>Apply</strong>. Stop ends it; Undo puts back everything it changed.</p>
      <h2>4. Link your experiments</h2>
      <p>Link notes with [[ ]], put notes under other notes, and start a <strong>New attempt</strong> from an earlier one. The <strong>Research map</strong> shows how they connect: hollow dots aren&apos;t marked yet, filled ones worked, red ones failed.</p>
      <h2>5. Share</h2>
      <p>Tap <strong>Share</strong> in a note. Add people by username, or make a link anyone can open without an account. You choose whether they see the code, and Stop sharing ends it at once.</p>
      <h2>6. Anywhere</h2>
      <p>The Android app has the same notes and works offline. Tap Android app on the home page to get it. More → <strong>Export note</strong> gives you a Jupyter notebook, a web page or Markdown.</p>
      <p>
        More: <Link href="/free" className="underline underline-offset-4">what&apos;s free</Link> · <Link href="/security" className="underline underline-offset-4">how keys are kept</Link>
      </p>
    </LegalPage>
  );
}
