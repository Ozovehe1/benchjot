import { IconMail, IconNote, IconScale, IconShield } from "@/components/ui";
import { Folder, Folders, LegalPage } from "@/components/app/legal-page";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage path="/terms" title="Terms" updated="4 November 2026" lead="By using Benchjot you agree to these terms.">
      <Folders>
        <Folder icon={IconNote} title="Your content" summary="It stays yours.">
          <p>What you write and upload stays yours. You&apos;re responsible for it and for the code you run.</p>
        </Folder>
        <Folder icon={IconScale} title="Fair use" summary="No abuse, attacks or crypto mining.">
          <p>Don&apos;t use Benchjot to break the law, attack other systems, mine cryptocurrency, or overload the service. Accounts that do may be suspended.</p>
        </Folder>
        <Folder icon={IconShield} title="No warranty" summary="Keep your own copies of important work.">
          <p>Benchjot is provided as is. Keep your own copies of important work; we&apos;re not liable for lost data or downtime.</p>
        </Folder>
        <Folder icon={IconMail} title="Changes and contact" summary="The date above shows the latest version.">
          <p>These terms may change; the date above shows the latest version.</p>
          <p>Contact: abdulcosman01@gmail.com</p>
        </Folder>
      </Folders>
    </LegalPage>
  );
}
