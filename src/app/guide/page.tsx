import Link from "next/link";
import { IconCpu, IconDatabase, IconImage, IconMap, IconPen, IconPhone, IconShare, IconSparkle, IconWrench } from "@/components/ui";
import { Folder, Folders, LegalPage } from "@/components/app/legal-page";

export const metadata = { title: "Guide" };

// Getting started, one folder per topic: its one-line summary is the gist; open it for the how.
export default function GuidePage() {
  return (
    <LegalPage path="/guide" title="Guide" updated="26 November 2026" lead="One note per experiment: what you expect, the code, and what happened.">
      <Folders title="Basics">
        <Folder icon={IconPen} title="Write a note" summary="Question, expectation, code, result." open>
          <p>Write your question. Add a code cell, write what you expect above it, and run it. Write what happened below it, and mark the note Successful or Failed.</p>
          <p>Shift+Enter runs a cell. <strong>Run all</strong> runs them in order and stops at the first that fails. Pin a note from More to keep it at the top. Deleted notes wait 30 days in <strong>Recently deleted</strong>.</p>
        </Folder>
        <Folder icon={IconCpu} title="Where code runs" summary="Your browser first; the server for the rest.">
          <p>Python and R run in your browser, free and with nothing to install. Anything the browser can&apos;t run (PyTorch, TensorFlow, Julia, MATLAB, C, C++, Fortran) goes to the server by itself, with a GPU when the code needs one: 10 GPU runs a day, up to an hour each. Code written for a GPU still runs without one, just slower.</p>
          <p>For gated or private Hugging Face models and datasets, tap <strong>Connect Hugging Face</strong> on the Data page, under Sources.</p>
        </Folder>
      </Folders>
      <Folders title="Data and results">
        <Folder icon={IconDatabase} title="Your data" summary="Keep datasets once; any cell opens them by name.">
          <p>The <strong>Data</strong> page keeps your datasets: upload a file, add one by its address, or search Hugging Face, Zenodo, OpenML, Harvard Dataverse and figshare at once. A cell opens a file by name, like <code>pd.read_csv(&quot;iris.csv&quot;)</code>, in the browser, on the phone and on the server. Up to 50 MB a file and 250 MB in all.</p>
          <p>A cell that downloads or builds data can keep it with <code>save_data(&quot;clean.csv&quot;)</code>; later cells, in any note, open it by that name.</p>
        </Folder>
        <Folder icon={IconImage} title="Track runs and find figures" summary="log() builds a Runs table; Figures gathers every plot.">
          <p>End a cell with <code>log(accuracy=acc, lr=lr)</code> and each run joins the note&apos;s <strong>Runs</strong> table and chart, side by side with the others. <strong>Figures</strong> in the sidebar shows every figure from all your notes, and a note&apos;s <strong>Contents</strong> lists its headings and cells to jump to.</p>
        </Folder>
      </Folders>
      <Folders title="AI">
        <Folder icon={IconSparkle} title="The assistant" summary="Ask about the note, or have it do the work.">
          <p>AI is built in, with nothing to connect. Choose its model under the chat box or in Settings. The <strong>Assistant</strong> answers questions about your note or does the work in it, typed or spoken: it writes and runs code until it works, finds and fetches real datasets, and reads the figures and animations your code draws.</p>
          <p>It can look through your other notes, by words or by meaning, and ask them what they found. It never changes another note: it proposes, and you tap <strong>Apply</strong>. Stop ends it; Undo puts back everything it changed.</p>
        </Folder>
        <Folder icon={IconWrench} title="Fix" summary="A corrected program after an error.">
          <p>When a cell fails, <strong>Suggest a fix</strong> shows the change side by side. Nothing changes until you accept it.</p>
        </Folder>
      </Folders>
      <Folders title="Connect and share">
        <Folder icon={IconMap} title="Link your experiments" summary="Links, sub-notes, attempts and the map.">
          <p>Link notes with [[ ]], put notes under other notes, and start a <strong>New attempt</strong> from an earlier one. The <strong>Research map</strong> shows how they connect: hollow dots aren&apos;t marked yet, filled ones worked, red ones failed.</p>
        </Folder>
        <Folder icon={IconShare} title="Share a note" summary="By username, or with a link.">
          <p>Tap <strong>Share</strong> in a note. Add people by username, or make a link anyone can open without an account. You choose whether they see the code, and Stop sharing ends it at once.</p>
        </Folder>
        <Folder icon={IconPhone} title="Android and export" summary="Same notes on your phone, offline too.">
          <p>The Android app has the same notes and works offline. Tap Android app on the home page to get it. More → <strong>Export note</strong> gives you a Jupyter notebook, a web page or Markdown.</p>
        </Folder>
      </Folders>
      <p className="text-sm text-muted">
        <Link href="/free" className="underline underline-offset-4">What&apos;s free</Link> · <Link href="/security" className="underline underline-offset-4">Security</Link>
      </p>
    </LegalPage>
  );
}
