import { LegalPage } from "@/components/legal-page";

export const metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="4 November 2026">
      <p>Benchjot is a research notebook for notes and code. This page says what it stores and why.</p>
      <h2>What we store</h2>
      <p>Your email address, username and, if you sign in with Google, your Google account&apos;s email and name. Your notes, code, run output and projects. Nothing else is collected.</p>
      <h2>How it&apos;s used</h2>
      <p>Only to run your account: signing you in, sending account emails such as confirmation links, and saving your work. We don&apos;t sell data, show ads, or share it with anyone except the services that run Benchjot: Supabase (database and sign-in), Vercel (hosting), Brevo (account emails), Modal (server code runs you start) and Groq (the Fix feature, only for the code you send to it).</p>
      <h2>Who can see your work</h2>
      <p>Only you. Every note and code block is private to your account.</p>
      <h2>Deleting your data</h2>
      <p>Delete notes in the app at any time. To delete your whole account, email abdulcosman01@gmail.com and it will be removed with everything in it.</p>
      <h2>Contact</h2>
      <p>abdulcosman01@gmail.com</p>
    </LegalPage>
  );
}
