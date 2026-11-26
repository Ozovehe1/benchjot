import { SampleOutputViewer } from "@/components/outputs/sample-output-viewer";

// The landing's example note's outputs: public, read-only, static files.
export default async function SampleOutputPage({ params }: { params: Promise<{ cell: string; index: string }> }) {
  const { cell, index } = await params;
  return <SampleOutputViewer cell={Number(cell)} index={Number(index)} />;
}
