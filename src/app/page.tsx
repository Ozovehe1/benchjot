import Link from "next/link";
import { APP_NAME } from "@/config/app";
import { EntryList } from "@/components/entry-list";
import { Column } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase/server";

// Home: the list for signed-in users, a one-line landing page for everyone else.
export default async function Home() {
  const {
    data: { user },
  } = await (await serverSupabase()).auth.getUser();
  if (user) return <EntryList />;
  return (
    <Column className="max-w-[400px] pt-[18vh]">
      <h1 className="font-medium">{APP_NAME}</h1>
      <p className="mt-3 text-muted">Notes and code, nothing else.</p>
      <nav className="mt-10 flex gap-6 text-sm">
        <Link href="/login" className="min-h-11 py-3 underline underline-offset-4">
          Sign in
        </Link>
        <Link href="/login?mode=signup" className="min-h-11 py-3 text-muted hover:text-fg">
          Create account
        </Link>
      </nav>
    </Column>
  );
}
