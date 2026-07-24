# Debatefrog

Debatefrog is the primary reference implementation for the [Polyvise](https://github.com/polyvise/polyvise-core) debate engine. It provides the playful `debatefrog.com` product, a Next.js runtime, streaming debate updates, persistence adapters, model evaluations, and production deployment.

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
