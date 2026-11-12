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

The final pre-split monorepo is preserved in `polyvise/polyvise-core` under the `monolith-final-2026-07-23` tag.

## Debatefrog generation policy

Visible text targets 12-year-olds: everyday words, short sentences, and roughly 25–45 words per turn. Questions and verdicts are shorter. Length targets never justify truncating a sentence or inventing evidence.

Each model step allows at most three HTTP calls across initial generation and one output repair. Each generation allows at most two transport attempts, with a timeout of at most 45 seconds per call and a 1–5-second retry delay. The shared provider retries network errors, timeouts, invalid JSON, empty replies, HTTP 408/409/429, and server errors; authorization and other permanent HTTP errors stop immediately.

Debatefrog uses JSON-object mode with local validation against the shared schemas, avoiding the provider's additional strict-schema fallback retry loop. Repairs include the rejected output and specific validation failures. Optional style repairs get one call without transport retries; if that fails, the original usable answer is kept. Invalid structure or unsupported evidence still fails. Attempt counts, token usage, and cost include repairs. Browser POST requests are not automatically retried because they can create duplicate debates.
