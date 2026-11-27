import type { StreamEvent } from "./optimizer/types";

/** POST a JSON body and consume the NDJSON stream from /api/solve or /api/pareto. */
export async function postStream<T>(url: string, body: unknown, onProgress: (stage: string, p: number) => void): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as StreamEvent<T>;
      if (ev.type === "progress") onProgress(ev.stage, ev.p);
      else if (ev.type === "error") throw new Error(ev.message);
      else return ev.data;
    }
    if (done) throw new Error("Stream ended without a result (function timeout?)");
  }
}
