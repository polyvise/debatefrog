import {
  debateStepModelKeys,
  resolveDebateStepModelDefaults
} from "@/lib/debate-step-models";
import { getModelOptions, getRuntime } from "@/server/polyvise-api";

export async function GET() {
  const defaults = resolveDebateStepModelDefaults();
  const defaultIds = [...new Set(debateStepModelKeys.map((key) => defaults[key]))];
  // The engine's choices and its provider keys live on the Polyvise API.
  const [options, runtime] = await Promise.all([
    getModelOptions(defaultIds).catch(() => defaultIds.map((id) => ({ id, label: id }))),
    getRuntime().catch(() => null)
  ]);

  return Response.json(
    {
      defaults,
      options,
      dev: {
        liveApiToggleAvailable: process.env.NODE_ENV !== "production" && runtime !== null && !runtime.production,
        hasOpenRouterKey: Boolean(runtime?.providers.openrouter),
        hasTavilyKey: Boolean(runtime?.providers.tavily)
      }
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
