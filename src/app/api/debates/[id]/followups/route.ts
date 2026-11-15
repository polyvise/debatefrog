import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { addFollowup } from "@/server/debate-store";

// The same bounds the Polyvise API applies to a follow-up question.
const followupRequestSchema = z.object({ question: z.string().trim().min(4).max(700) });

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { question } = followupRequestSchema.parse(await request.json());
    const exchange = await addFollowup(id, question);

    if (!exchange) {
      return Response.json(
        { error: "That debate is not ready for follow-ups yet." },
        { status: 404 }
      );
    }

    return Response.json({ followup: exchange }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: "That question needs a bit more shape.",
          issues: error.issues
        },
        { status: 400 }
      );
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to answer that follow-up." },
      { status: 500 }
    );
  }
}
