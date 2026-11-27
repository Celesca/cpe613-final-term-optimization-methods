import "server-only";
import type { StreamEvent } from "./optimizer/types";

/** Run a long job and stream NDJSON progress lines, then one result (or error) line. */
export function ndjsonStream<T>(job: (emit: (stage: string, p: number) => Promise<void>) => Promise<T>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: StreamEvent<T>) => controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      let last = 0;
      const emit = async (stage: string, p: number) => {
        const now = Date.now();
        if (now - last < 80 && p < 1) return; // throttle progress lines
        last = now;
        send({ type: "progress", stage, p });
        await new Promise<void>((r) => setImmediate(r));
      };
      try {
        send({ type: "result", data: await job(emit) });
      } catch (err) {
        console.error(err);
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform" },
  });
}

export async function readJson(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { return {}; }
}
