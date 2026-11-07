// A stand-in for the browser's Worker in runner tests: records what runner.ts sends and
// replies as public/workers/python.js would. Install with vi.stubGlobal("Worker", FakeWorker).
export type Sent = { id: number; render?: { data: Uint8Array; format: string; matplotlib?: string }; code?: string };

export class FakeWorker extends EventTarget {
  static last: FakeWorker | null = null;
  sent: Sent[] = [];
  terminated = false;
  constructor(public url: string) {
    super();
    FakeWorker.last = this;
  }
  postMessage(m: Sent) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: object) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}
