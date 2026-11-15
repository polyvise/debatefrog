# Project instructions

Be concise and practical. Use plain, specific language and follow existing project conventions.

## Shared-engine ownership check

Before every Debatefrog change, explicitly consider whether it belongs in this app or in the shared Polyvise API (`polyvise/polyvise-api`), which runs the engine and which this app calls over HTTP. Inspect the relevant API implementation before adding or duplicating engine behavior here.

- Debatefrog owns its interface, frog presentation, age-10 writing policy, app routes, persistence adapters, and deployment.
- The Polyvise API owns reusable debate execution, stage retries and resumption, provider behavior, structured-output validation, and portable event/data contracts.
- Split changes across the boundary when needed: generic capabilities in the API, product-specific wiring and presentation here. Call the API only through `src/server/polyvise-api.ts`, keep `src/lib/polyvise-api/types.ts` in step with its contracts, and do not silently maintain a second generic engine implementation in this app.
- State the ownership decision briefly when reporting the change. If an app-side workaround is necessary, document why and identify what should move upstream.

Run `npm run verify` for code changes, using focused tests during development.
