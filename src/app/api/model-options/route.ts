import { loadDebateRuntimeConfig, modelOptionsFromConfig } from "@polyvise/core/debate/config";
import { getKnownModel } from "@polyvise/core/models/catalog";
import {
  debateStepModelKeys,
  resolveDebateStepModelDefaults
} from "@/lib/debate-step-models";

export async function GET() {
  const coreOptions = modelOptionsFromConfig(loadDebateRuntimeConfig());
  const defaults = resolveDebateStepModelDefaults();
  const optionById = new Map(coreOptions.options.map((option) => [option.id, option]));

  for (const key of debateStepModelKeys) {
    const id = defaults[key];
    if (optionById.has(id)) continue;
    optionById.set(id, { id, label: getKnownModel(id)?.label ?? id });
  }

  return Response.json(
    {
      defaults,
      options: [...optionById.values()],
      dev: {
        liveApiToggleAvailable: process.env.NODE_ENV !== "production",
        hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
        hasTavilyKey: Boolean(process.env.TAVILY_API_KEY)
      }
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
