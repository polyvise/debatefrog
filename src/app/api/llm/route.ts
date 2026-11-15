import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DEFAULT_READING_LEVEL, isReadingLevel } from "@/lib/reading-level";
import { generateChecked, GenerationFailure } from "@/server/checked-generation";
import { polyviseApiKey } from "@/server/polyvise-api";

export const dynamic = "force-dynamic";
// Up to three model calls of 45 seconds each, plus retry delays.
export const maxDuration = 300;

const callSchema = z.object({
  role: z.string().min(1),
  schemaName: z.string().min(1),
  prompt: z.string().min(1),
  jsonSchema: z.record(z.string(), z.unknown()).optional(),
  fallback: z.unknown().optional(),
  sessionId: z.string().optional(),
  model: z.string().optional(),
  maxAttempts: z.number().int().positive().optional()
});

/** Only the Polyvise API may call this: it presents the key this app uses to call it. */
function authorized(request: Request): boolean {
  const key = polyviseApiKey();
  if (!key) return process.env.NODE_ENV !== "production";
  const presented = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${key}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/**
 * The Polyvise API's callback provider: one model call of a Debatefrog run.
 * Answers `{data, snapshot}`, or a non-2xx `{error, snapshot?}`.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Not authorized." }, { status: 401 });
  }
  const parsed = callSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid model call." }, { status: 400 });
  }
  const params = new URL(request.url).searchParams;
  const level = params.get("level");
  try {
    const result = await generateChecked(
      parsed.data,
      isReadingLevel(level) ? level : DEFAULT_READING_LEVEL,
      params.get("live") === "1"
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "The model call failed.",
        ...(error instanceof GenerationFailure && error.snapshot ? { snapshot: error.snapshot } : {})
      },
      { status: 502 }
    );
  }
}
