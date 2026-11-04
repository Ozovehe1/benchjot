"use client";
import { useEffect, useRef, useState } from "react";
import { drawChart, readTheme, type DrawnChart } from "@/lib/charts";
import type { ChartOutput } from "@/lib/run/outputs";
import { cn } from "@/lib/format";

/** A chart drawn from its saved spec (fetched from `specUrl`). Interactive in the viewer, still inline. */
export function ChartView({
  item,
  specUrl,
  interactive,
  className,
  onReady,
}: {
  item: ChartOutput;
  specUrl: string | undefined;
  interactive: boolean;
  className?: string;
  onReady?: (chart: DrawnChart | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    if (!specUrl || !el.current) return;
    let chart: DrawnChart | null = null;
    let cancelled = false;
    const host = el.current;
    (async () => {
      try {
        const spec = await (await fetch(specUrl)).json();
        if (cancelled) return;
        chart = await drawChart(host, item.lib, item.version, spec, { interactive, theme: readTheme(host) });
        if (cancelled) chart.dispose();
        else ready.current?.(chart);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      chart?.dispose();
      ready.current?.(null);
    };
  }, [specUrl, item.lib, item.version, interactive]);

  if (error) return <p className="py-3 font-mono text-xs text-muted">Couldn’t draw this chart: {error}</p>;
  return <div ref={el} role="img" aria-label={item.title || "Chart"} className={cn("w-full", item.lib === "bokeh" && "overflow-hidden", className)} />;
}
