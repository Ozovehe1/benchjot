// What a run logged with log(), under its output: name and value pairs, read like an instrument
// readout. The note's Runs table collects them across runs.
import type { Logged } from "@/lib/run/outputs";
import { formatLogged } from "@/lib/run/logged";

export function LoggedValues({ logged }: { logged: Logged }) {
  const entries = Object.entries(logged);
  if (!entries.length) return null;
  return (
    <section aria-label="Logged values" className="mt-3">
      <h3 className="eyebrow mb-1.5">Logged</h3>
      <dl className="flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[13px]">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-1.5">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular-nums text-fg">{formatLogged(v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
