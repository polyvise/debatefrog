# Debatefrog

[Debatefrog.com](debatefrog.com) is a playful example implementation using the [Polyvise API](https://github.com/polyvise/polyvise-api) debate engine. It has a Next.js runtime, streaming debate updates, persistence adapters, model evaluations, and production deployment.

## Run locally

Debatefrog does not bundle the engine. Start the Polyvise API first; with no keys it answers from deterministic templates:

```bash
(cd ../polyvise-api && uv run uvicorn polyvise_api.main:app --port 8000)
```

```bash
npm ci
POLYVISE_API_URL=http://localhost:8000 npm run dev
```

Open `http://localhost:3001`. See `.env.example` for the settings; put an API key and other private values in an ignored `local.secrets.env` and run `./scripts/dev.sh`.

## Verify

```bash
npm run verify
```

## Ownership boundary

This repository owns Debatefrog-specific UI, routes, feedback, persistence, migrations, evaluations, and deployment. General debate behavior and portable contracts belong in the Polyvise API (`polyvise/polyvise-api`), which Debatefrog calls over HTTP; `src/server/polyvise-api.ts` is the only module that does, and `src/lib/polyvise-api/types.ts` mirrors its wire contracts.

Every change starts with the ownership check in [AGENTS.md](AGENTS.md). The API runs each debate as a background job and owns stage checkpoints, resumption, transport retries, truncation recovery, and the shared remaining-call budget. Debatefrog follows the job's event stream, stores the record and a private copy of the checkpoint, claims retry attempts atomically, and presents the retry control. Its product policy reaches the engine as data sent with each run: per-round model routing and age-10 prompt rules (`src/server/generation-policy.ts`). Evidence and reading-level checks cannot be data, so the API hands each model call back to `/api/llm` (`src/server/checked-generation.ts`), which makes the call through the API, checks the shared schema before product-specific validation, and honors the budget.

The final pre-split monorepo is preserved in `polyvise/polyvise-core` under the `monolith-final-2026-07-23` tag.

## Debatefrog generation policy

Reading level defaults to ages 9–11 (target age 10) and can be set to ages 12–14 (target age 13) beside the question. The choice is remembered in this browser and saved with each debate for retries and follow-ups. Both levels keep the eight-second minimum round pause.

The default uses everyday words, short sentences, and roughly 20–35 words per turn. Questions and verdicts are shorter. Completed rounds stay visible for at least 8 seconds, with extra reading time for longer statements. Length targets never justify truncating a sentence or inventing evidence.

Each model step allows at most three HTTP calls across initial generation and one output repair. Each generation allows at most two transport attempts, with a timeout of at most 45 seconds per call and a 1–5-second retry delay. The API's provider retries network errors, timeouts, invalid JSON, empty replies, HTTP 408/409/429, and server errors; authorization and other permanent HTTP errors stop immediately.

Debatefrog uses JSON-object mode and validates against the API's shared schemas, keeping its existing response format while using the API's bounded provider retries. The callback honors the engine's remaining-call allowance, including any product-specific repair. It needs `DEBATEFROG_CALLBACK_URL` (a URL the API can reach, whose host is in the API's `POLYVISE_API_CALLBACK_HOSTS`) and accepts only the API key this app uses; without it the API calls models directly and only the prompt rules apply. Repairs include the rejected output and specific validation failures. Optional style repairs get one call without transport retries; if that fails, the original usable answer is kept. Invalid structure or unsupported evidence still fails. Attempt counts, token usage, and cost include repairs. Browser POST requests are not automatically retried because they can create duplicate debates.

Failed runs offer “Try this step again.” Retrying keeps the original question, models, source set, and completed rounds, and asks the API to resume the job. If the API no longer holds it (a restart, or the job expired after an hour), Debatefrog starts a new job from the checkpoint it saved. A retry attempt number and conditional repository update prevent duplicate workers. Streams are scoped to the attempt so a different server instance cannot replay an old failure into the new attempt; an instance that did not start an attempt picks it up from the API and can store its outcome. Older records created before checkpoint support cannot be resumed.

Cloud Run deployments use `--no-cpu-throttling` because following the API job continues after the start/retry HTTP response, and the browser's event stream can reach another instance. Request-based CPU allocation can suspend that background work. This uses instance-based billing while instances are running; minimum instances remain zero. See [Cloud Run billing settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings). Checkpoint recovery still handles interrupted instances.
