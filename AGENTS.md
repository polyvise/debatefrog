# Project instructions

Be concise and practical. Use plain, specific language and follow existing project conventions.

## Shared-library ownership check

Before every Debatefrog change, explicitly consider whether it belongs in this app or in the shared `@polyvise/core` library (`polyvise/polyvise-core`). Inspect the relevant shared implementation before adding or duplicating engine behavior here.

- Debatefrog owns its interface, frog presentation, age-12 writing policy, app routes, persistence adapters, and deployment.
- Polyvise Core owns reusable debate execution, stage retries and resumption, provider behavior, structured-output validation, and portable event/data contracts.
- Split changes across the boundary when needed: generic capabilities in Core, product-specific wiring and presentation here. Do not edit installed `node_modules` or silently maintain a second generic engine implementation in this app.
- State the ownership decision briefly when reporting the change. If an app-side workaround is necessary, document why and identify what should move upstream.

Run `npm run verify` for code changes, using focused tests during development.
