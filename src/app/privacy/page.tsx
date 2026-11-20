import { LegalPage } from "@/components/app/legal-page";

export const metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="20 November 2026">
      <p>Benchjot is a research notebook for notes and code. This page says what it stores and why.</p>
      <h2>What we store</h2>
      <p>Your email address, username and, if you sign in with Google, your Google account&apos;s email and name. Your notes, code, run output and projects. Accounts you choose to connect (OpenRouter for AI, Hugging Face): their keys are encrypted on our server, never shown again, and used only for your own requests. Counts of your AI requests and server runs (how many and when, never what was in them), which you can see in Settings under Usage. A search index of your notes (numbers worked out from their text, inside Supabase), so the assistant can find related notes; only you can search it. Short descriptions of the pictures your runs drew, when the assistant looked at them, kept with that run. Nothing else is collected.</p>
      <h2>How it&apos;s used</h2>
      <p>Only to run your account: signing you in, sending account emails such as confirmation links, and saving your work. We don&apos;t sell data, show ads, or share it with anyone except the services that run Benchjot: Supabase (database and sign-in), Vercel (hosting), Google (Gmail, which sends account emails such as confirmation links), Modal (server code runs you start), OpenRouter through the AI account you connected (Fix and the assistant, only for what you send to them: your note, the pictures it drew when the assistant looks at them, and what it found in your other notes when your request needs them), Hugging Face if you connected it (sign-in, and downloads in your server runs). Voice you speak to the assistant is turned into text by your browser or phone; Benchjot gets only the text.</p>
      <h2>Who can see your work</h2>
      <p>Only you, unless you share a note. Every note and code block is private to your account. When you share one, the people you add (by username) can read that note, and if you choose Anyone with the link, so can anyone you give the link to; they can’t change it. Shared pages show your username. A shared note isn’t listed by search engines unless you turn that on. Stop sharing ends everyone’s access at once. We count how many times a shared link is opened (a number, nothing about who).</p>
      <h2>Your rights</h2>
      <p>You can see, correct, copy and delete your data. Everything you write is in the app, where you can change it at any time. Export note gives you a copy of any note (Jupyter notebook, web page or Markdown). For a copy of everything in your account, to correct anything you can&apos;t change yourself, or to ask us to stop using your data in some way, email abdulcosman01@gmail.com; we answer within 30 days. If you think we got something wrong, you can also complain to your country&apos;s data protection authority.</p>
      <h2>How long it&apos;s kept</h2>
      <p>Your account and your notes are kept until you delete them. The assistant&apos;s conversation on a note is kept 30 days, then only a short summary of it, until you clear it. Counts of your AI requests are kept 30 days. A note’s search index and picture descriptions are removed with the note, and replaced whenever it changes.</p>
      <h2>Deleting your data</h2>
      <p>Delete notes in the app at any time. A deleted note stays in Recently deleted for 30 days, where you can restore it, then it is removed for good; Delete now there removes it at once. To delete your whole account, email abdulcosman01@gmail.com and it will be removed with everything in it.</p>
      <h2>Cookies</h2>
      <p>Benchjot uses only the cookies that keep you signed in, and one that remembers you&apos;ve passed the setup step. There are no advertising or tracking cookies and no analytics. When you open a shared note, your browser remembers that you opened it today, so the view is counted once; that stays in your browser. While the assistant works on a request, your browser (or phone) keeps where it has got to, so it can go on if you leave the note; that is removed when the request ends, and never leaves your device.</p>
      <h2>Where your data is</h2>
      <p>Your notes and account are stored in Ireland (Supabase, in the EU). The services that run Benchjot (Vercel, Modal, OpenRouter and Google) may process it in the United States and other countries, only to do what you asked: show a page, run your code, answer your AI request, send an account email.</p>
      <h2>Children</h2>
      <p>Benchjot isn&apos;t for children under 13 (or the minimum age in your country). We don&apos;t knowingly keep data from them; if you think a child has an account, email us and it will be deleted.</p>
      <h2>Changes to this page</h2>
      <p>When this page changes, the date at the top changes too. If a change affects what we do with your data, we&apos;ll tell you by email before it takes effect.</p>
      <h2>Contact</h2>
      <p>abdulcosman01@gmail.com</p>
    </LegalPage>
  );
}
