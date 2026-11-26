import { IconChild, IconClock, IconCookie, IconDatabase, IconEye, IconGlobe, IconMail, IconScale, IconTrash, IconUsers } from "@/components/ui";
import { Folder, Folders, Glance, LegalPage } from "@/components/app/legal-page";

export const metadata = { title: "Privacy policy" };

// What Benchjot stores and why: the answer up front, each topic in full in its folder.
export default function PrivacyPage() {
  return (
    <LegalPage path="/privacy" title="Privacy policy" updated="26 November 2026" lead="We keep what runs your account, and nothing to sell.">
      <Glance
        items={[
          { value: "No ads", label: "and no tracking or analytics" },
          { value: "Never sold", label: "your data, to anyone" },
          { value: "EU", label: "where notes are stored" },
          { value: "30 days", label: "to restore a deleted note" },
        ]}
      />
      <Folders title="Your data">
        <Folder icon={IconDatabase} title="What we store" summary="Your account, your notes, and usage counts.">
          <p>Your email address, username and, if you sign in with Google, your Google account&apos;s email and name. Your notes, code, run output and projects, the values your runs log for the Runs table, and the files you keep in your Data library (only you can read them).</p>
          <p>Hugging Face, if you choose to connect it: its key is encrypted on our server, never shown again, and used only for your own requests.</p>
          <p>Counts of your AI requests (how many, when and what each cost in credits) and server runs, never what was in them, which you can see in Settings under Usage. A search index of your notes (numbers worked out from their text, inside Supabase), so the assistant can find related notes; only you can search it. Short descriptions of the pictures your runs drew, when the assistant looked at them, kept with that run. Nothing else is collected.</p>
        </Folder>
        <Folder icon={IconUsers} title="How it's used" summary="Only to run your account. Shared with no one else.">
          <p>Only to run your account: signing you in, sending account emails such as confirmation links, and saving your work. We don&apos;t sell data, show ads, or share it with anyone except the services that run Benchjot:</p>
          <ul>
            <li>Supabase (database and sign-in)</li>
            <li>Vercel (hosting)</li>
            <li>Google (Gmail, which sends account emails such as confirmation links)</li>
            <li>Modal (server code runs you start)</li>
            <li>Our AI provider, currently Anthropic (for Fix and the assistant, only for what you send to them: your note, the pictures it drew when the assistant looks at them, and what it found in your other notes when your request needs them)</li>
            <li>Hugging Face if you connected it (sign-in, and downloads in your server runs)</li>
          </ul>
          <p>Voice you speak to the assistant is turned into text by your browser or phone; Benchjot gets only the text.</p>
        </Folder>
        <Folder icon={IconEye} title="Who can see your work" summary="Only you, unless you share a note.">
          <p>Only you, unless you share a note. Every note and code block is private to your account. When you share one, the people you add (by username) can read that note, and if you choose Anyone with the link, so can anyone you give the link to; they can’t change it. Shared pages show your username. A shared note isn’t listed by search engines unless you turn that on. Stop sharing ends everyone’s access at once. We count how many times a shared link is opened (a number, nothing about who).</p>
        </Folder>
        <Folder icon={IconGlobe} title="Where your data is" summary="Stored in Ireland (EU).">
          <p>Your notes and account are stored in Ireland (Supabase, in the EU). The services that run Benchjot (Vercel, Modal, Anthropic and Google) may process it in the United States and other countries, only to do what you asked: show a page, run your code, answer your AI request, send an account email.</p>
        </Folder>
      </Folders>
      <Folders title="Your control">
        <Folder icon={IconScale} title="Your rights" summary="See, correct, copy or delete it. We answer within 30 days.">
          <p>You can see, correct, copy and delete your data. Everything you write is in the app, where you can change it at any time. Export note gives you a copy of any note (Jupyter notebook, web page or Markdown). For a copy of everything in your account, to correct anything you can&apos;t change yourself, or to ask us to stop using your data in some way, email abdulcosman01@gmail.com; we answer within 30 days. If you think we got something wrong, you can also complain to your country&apos;s data protection authority.</p>
        </Folder>
        <Folder icon={IconClock} title="How long it's kept" summary="Until you delete it; AI conversations 30 days.">
          <p>Your account and your notes are kept until you delete them. The assistant&apos;s conversation on a note is kept 30 days, then only a short summary of it, until you clear it. Counts of your AI requests are kept until the month after next. A note’s search index and picture descriptions are removed with the note, and replaced whenever it changes.</p>
        </Folder>
        <Folder icon={IconTrash} title="Deleting your data" summary="Notes in the app; your whole account by email.">
          <p>Delete notes in the app at any time. A deleted note stays in Recently deleted for 30 days, where you can restore it, then it is removed for good; Delete now there removes it at once. To delete your whole account, email abdulcosman01@gmail.com and it will be removed with everything in it.</p>
        </Folder>
        <Folder icon={IconCookie} title="Cookies" summary="Only to keep you signed in.">
          <p>Benchjot uses only the cookies that keep you signed in. There are no advertising or tracking cookies and no analytics. When you open a shared note, your browser remembers that you opened it today, so the view is counted once; that stays in your browser. While the assistant works on a request, your browser (or phone) keeps where it has got to, so it can go on if you leave the note; that is removed when the request ends, and never leaves your device.</p>
        </Folder>
      </Folders>
      <Folders title="More">
        <Folder icon={IconChild} title="Children" summary="Not for children under 13.">
          <p>Benchjot isn&apos;t for children under 13 (or the minimum age in your country). We don&apos;t knowingly keep data from them; if you think a child has an account, email us and it will be deleted.</p>
        </Folder>
        <Folder icon={IconMail} title="Changes and contact" summary="We email you before changes that affect your data.">
          <p>When this page changes, the date at the top changes too. If a change affects what we do with your data, we&apos;ll tell you by email before it takes effect.</p>
          <p>Contact: abdulcosman01@gmail.com</p>
        </Folder>
      </Folders>
    </LegalPage>
  );
}
