import { getDebate, subscribeToDebate } from "@/server/debate-store";
import type { DebateLiveEvent } from "@polyvise/core/debate/types";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const debate = await getDebate(id);

  if (!debate) {
    return Response.json({ error: "Debate not found." }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let teardown: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe = () => {};

      const closeStream = () => {
        if (closed) return;
        closed = true;
        if (heartbeat !== null) clearInterval(heartbeat);
        unsubscribe();
        _request.signal.removeEventListener("abort", closeStream);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      teardown = closeStream;
      _request.signal.addEventListener("abort", closeStream, { once: true });

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closeStream();
        }
      };

      const writeEvent = (event: DebateLiveEvent) => {
        safeEnqueue(encoder.encode(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`));
        if (event.kind === "complete" || event.kind === "error") {
          closeStream();
        }
      };

      const subscription = subscribeToDebate(id, writeEvent);
      unsubscribe = subscription.unsubscribe;
      if (_request.signal.aborted) closeStream();

      if (subscription.terminal || closed) {
        unsubscribe();
        safeEnqueue(encoder.encode(`event: closed\ndata: {}\n\n`));
        closeStream();
        return;
      }

      heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`: ping\n\n`));
      }, 15000);

    },
    cancel() {
      teardown?.();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
