import { LegalPage } from "@/components/legal-page";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="4 November 2026">
      <p>By using Benchjot you agree to these terms.</p>
      <h2>Your content</h2>
      <p>What you write and upload stays yours. You&apos;re responsible for it and for the code you run.</p>
      <h2>Fair use</h2>
      <p>Don&apos;t use Benchjot to break the law, attack other systems, mine cryptocurrency, or overload the service. Accounts that do may be suspended.</p>
      <h2>No warranty</h2>
      <p>Benchjot is provided as is. Keep your own copies of important work; we&apos;re not liable for lost data or downtime.</p>
      <h2>Changes</h2>
      <p>These terms may change; the date above shows the latest version.</p>
      <h2>Contact</h2>
      <p>abdulcosman01@gmail.com</p>
    </LegalPage>
  );
}
