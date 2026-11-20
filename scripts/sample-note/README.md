# The landing's example note

The note on the signed-out landing page is a real Benchjot note, copied as it ran: "Do 4 layers beat
2? Balls vs handwritten digits", run on Benchjot's server on 2026-11-18 (`balls.py` on CPU, 7:16;
`digits.py` on a T4 GPU the server chose by itself, 10:11).

- `src/lib/sample-run.json`: each cell's code, its note before the run and its run record (printed
  output, the server's notes, the tables and the list of figures). The run's storage folder is
  replaced by a placeholder, so no account id is published.
- `public/sample-outputs/<cell>/`: the run's files, byte for byte, and `SHA256SUMS` listing them.
  `tests/note-preview.test.tsx` checks every file against it and that each code hash matches its code.
- `src/lib/sample-note.ts`: the note's title, body and notes after the run (written from the results).

A GPU run can't be repeated in CI, so the sample is frozen rather than rerun. To replace it: run a
note on the server, copy each cell's `last_run` (with the placeholder folder) and code into
`sample-run.json`, its files into `public/sample-outputs/<cell>/`, and regenerate `SHA256SUMS`
(`cd public/sample-outputs && sha256sum */* > SHA256SUMS`).
