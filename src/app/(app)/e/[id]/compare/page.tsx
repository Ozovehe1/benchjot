import { CompareView } from "@/components/experiment/compare-view";

export const metadata = { title: "Compare runs" };

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { id } = await params;
  const { a, b } = await searchParams;
  return <CompareView experimentId={id} a={a ?? ""} b={b ?? ""} />;
}
