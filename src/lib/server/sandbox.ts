// Where server runs execute: the one module API routes call for them. Today each run is a Modal
// Sandbox (./modal.ts holds everything Modal-specific: images, volumes, network rules, GPUs).
// Another provider (a container service, a self-hosted pool) replaces modal.ts and keeps these
// names; the routes, the run rules (run-prep.ts) and the client don't change.
export {
  runOnModal as runAndWait, // run, and answer with the result (up to SYNC_MAX_TIMEOUT_SEC)
  startOnModal as startInBackground, // start; the run posts its result to /api/runs/<id>/complete
  liveStatus, // what a background run is doing now (its .status.json), or null
  sandboxRunning as isRunning, // whether a background run's sandbox still exists
  stopOnModal as stopRun, // stop a background run
} from "./modal";
