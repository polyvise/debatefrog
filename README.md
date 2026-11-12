# Debatefrog

[Debatefrog.com](debatefrog.com) is a playful example implementation using the [Polyvise](https://github.com/polyvise/polyvise-core) debate engine. It has a Next.js runtime, streaming debate updates, persistence adapters, model evaluations, and production deployment.

## Run locally

```bash
npm ci
npm run dev
```

Open `http://localhost:3001`.

For live provider keys, create an ignored `local.secrets.env` file and run:

```bash
./scripts/dev.sh
```

## Verify

```bash
npm run verify
```

## Ownership boundary

This repository owns Debatefrog-specific UI, routes, feedback, persistence, migrations, evaluations, and deployment. General debate behavior and portable contracts belong in `@polyvise/core`.

Every change starts with the ownership check in [AGENTS.md](AGENTS.md). Stage checkpoints and resumption live in Core; Debatefrog stores checkpoints privately, claims retry attempts atomically, and presents the retry control. The existing app-side provider retry/validation wrapper is a compatibility workaround for Core's nested retry behavior; its reusable machinery should move upstream when Core exposes a configurable retry budget. The age-12 language policy stays here.

The final pre-split monorepo is preserved in `polyvise/polyvise-core` under the `monolith-final-2026-07-23` tag.

## Debatefrog generation policy

Visible text targets 12-year-olds: everyday words, short sentences, and roughly 25–45 words per turn. Questions and verdicts are shorter. Length targets never justify truncating a sentence or inventing evidence.

Each model step allows at most three HTTP calls across initial generation and one output repair. Each generation allows at most two transport attempts, with a timeout of at most 45 seconds per call and a 1–5-second retry delay. The shared provider retries network errors, timeouts, invalid JSON, empty replies, HTTP 408/409/429, and server errors; authorization and other permanent HTTP errors stop immediately.

Debatefrog uses JSON-object mode with local validation against the shared schemas, avoiding the provider's additional strict-schema fallback retry loop. Repairs include the rejected output and specific validation failures. Optional style repairs get one call without transport retries; if that fails, the original usable answer is kept. Invalid structure or unsupported evidence still fails. Attempt counts, token usage, and cost include repairs. Browser POST requests are not automatically retried because they can create duplicate debates.

Failed runs offer “Try this step again.” Retrying keeps the original question, models, source set, and completed rounds, and asks Core to resume from its saved checkpoint. A retry attempt number and conditional repository update prevent duplicate workers. Streams are scoped to the attempt so a different server instance cannot replay an old failure into the new attempt. Older records created before checkpoint support cannot be resumed.

Cloud Run deployments use `--no-cpu-throttling` because the debate worker continues after the start/retry HTTP response, and the browser's event stream can reach another instance. Request-based CPU allocation can suspend that background work. This uses instance-based billing while instances are running; minimum instances remain zero. See [Cloud Run billing settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings). Checkpoint recovery still handles interrupted instances.
