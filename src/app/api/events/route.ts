import { syncStatus } from "@/lib/auto-sync";
import { subscribe } from "@/lib/live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How often an idle stream sends a comment, so proxies and browsers keep it open. */
const PING_MS = 25_000;

/**
 * Server-sent events for open pages (components/LiveRefresh): `change` when the database changed,
 * `sync` with the sync status. One stream per visible tab; the browser reconnects by itself.
 */
export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      write("retry: 3000\n\n");
      send("sync", syncStatus());
      const unsubscribe = subscribe((e) => send(e.type, e.type === "sync" ? e.status : {}));
      const ping = setInterval(() => write(": ping\n\n"), PING_MS);
      stop = () => {
        clearInterval(ping);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform keeps Next's compression from buffering the stream
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
