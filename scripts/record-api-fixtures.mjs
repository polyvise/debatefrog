// Records the Polyvise API responses the tests replay (tests/fixtures/polyvise-api.json).
//
// Run it against a local polyvise-api in its default mock mode, so the run is
// a deterministic template rather than paid model calls:
//
//   (cd ../polyvise-api && POLYVISE_EVIDENCE_PROVIDER=mock uv run uvicorn polyvise_api.main:app --port 8000)
//   node scripts/record-api-fixtures.mjs
//
// Re-record whenever the API's contracts change.
import { writeFile } from "node:fs/promises";

const api = (process.env.POLYVISE_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
const key = process.env.POLYVISE_API_KEY;

async function call(path, body) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(key ? { Authorization: `Bearer ${key}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} answered ${response.status}: ${await response.text()}`);
  return response;
}

const json = async (path, body) => (await call(path, body)).json();

const health = await json("/health");
if (!health.mockLlm) throw new Error("Record against an API in mock mode (POLYVISE_ENABLE_MOCK_LLM=true).");

const input = { subject: "Should homework be banned?", mode: "hybrid_council", evidence: "cited", councilSize: "duo" };
const { record, request } = await json("/v1/records", input);
await json("/v1/jobs", { request, debateId: record.id, options: { streamTurns: true, config: { maxRounds: 4 } } });
// Reading the stream to its end is also how we wait for the job to finish.
const events = await (await call(`/v1/jobs/${record.id}/events`)).text();
const job = await json(`/v1/jobs/${record.id}`);
if (job.status !== "complete") throw new Error(`The run ended ${job.status}.`);
const { checkpoint } = await json(`/v1/jobs/${record.id}/checkpoint`);
const { options } = await json("/v1/model-options?include=openai/gpt-4o-mini,openai/gpt-4.1");
const runtime = await json("/v1/config");

const fixtures = { apiVersion: health.version, record, request, events, job, checkpoint, modelOptions: options, runtime };
await writeFile(new URL("../tests/fixtures/polyvise-api.json", import.meta.url), `${JSON.stringify(fixtures)}\n`);
console.log(`Recorded a ${job.run.turns.length}-turn debate from polyvise-api ${health.version}.`);
