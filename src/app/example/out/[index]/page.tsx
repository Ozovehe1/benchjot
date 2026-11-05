import { SampleOutputViewer } from "@/components/sample-output-viewer";

// The landing's example note's outputs: public, read-only, static files.
export default async function SampleOutputPage({ params }: { params: Promise<{ index: string }> }) {
  const { index } = await params;
  return <SampleOutputViewer index={Number(index)} />;
}
