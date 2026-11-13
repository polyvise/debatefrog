import { z } from "zod";
import { retryDebate } from "@/server/debate-store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { id } = await context.params;
    const { attempt } = z.object({ attempt: z.number().int().nonnegative() }).parse(await request.json());
    const result = await retryDebate(id, attempt);
    if (!result) return Response.json({ error: "Debate not found." }, { status: 404 });
    return Response.json({ debate: result.debate, ...(!result.accepted ? {
      error: result.debate.recovery?.available
        ? "That attempt has ended. You can try this step again."
        : "This older debate has no saved steps. Choose New question to start again."
    } : {}) }, { status: result.accepted ? 202 : 409, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: "We couldn't reconnect. Your finished rounds are saved. Try again." }, {
      status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503
    });
  }
}
