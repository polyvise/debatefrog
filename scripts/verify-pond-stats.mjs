// Compare rendered stats with the independent, aggregate-only Firestore audit.
// Usage: node scripts/verify-pond-stats.mjs /tmp/stats-audit.json https://preview.debatefrog.com/stats
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const [auditPath, url] = process.argv.slice(2);
if (!auditPath || !url) throw new Error('Provide aggregate audit JSON and a stats URL.');
const audit = JSON.parse(await readFile(auditPath, 'utf8'));
for (const key of ['missingRecordJson', 'duplicateIds', 'invalidDates', 'futureCreatedDates', 'missingUpdatedAtField', 'completeWithoutRun']) assert.equal(audit[key], 0, key);
assert.deepEqual(audit.statusRunMismatch, []);
const response = await fetch(url);
assert.equal(response.status, 200);
const document = new JSDOM(await response.text()).window.document;
assert.ok(document.querySelector('main.pond-stats-page'), 'Pond theme is deployed');
// Streamed HTML can contain both the loading cards and the finished cards.
const results = document.querySelector('#pond-stats-results');
assert.ok(results, 'Pond stats finished loading');
const format = value => new Intl.NumberFormat('en-US', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
const text = node => node?.textContent.trim();
const panel = title => [...results.querySelectorAll('section')].find(node => text(node.querySelector(':scope > h2')) === title);
const values = node => [...node.children].map(item => text(item.firstElementChild));
const totals = results.querySelector('section[aria-label="Pond activity totals"]');
assert.deepEqual(values(totals), [format(audit.parsedCount), `${audit.completionPercent}%`, format(audit.recent7Days), format(audit.feedbackCount)]);
assert.ok(totals.textContent.includes(`${format(audit.statusCounts.complete ?? 0)} debate`));
assert.ok(totals.textContent.includes(`${format(audit.recent30Days)} in 30 days`));
const outcomes = panel('Debate outcomes');
let outcomeSum = 0;
for (const row of outcomes.querySelector('div.space-y-3').children) {
  const spans = row.querySelectorAll('span');
  const status = text(spans[0]).toLowerCase();
  const count = audit.statusCounts[status] ?? 0;
  assert.equal(text(spans[1]), format(count), `${status} count`);
  outcomeSum += count;
}
assert.equal(outcomeSum, audit.parsedCount);
assert.ok(outcomes.textContent.includes(`${audit.unfinished.length} without a final result`));
assert.ok(!document.body.textContent.includes('currently active'));
const dayBars = panel('Debates over the last 14 days').querySelectorAll('[title]');
assert.equal(dayBars.length, 14);
for (const [index, [date, count]] of Object.entries(audit.dailyActivity).entries()) {
  const label = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'UTC'});
  assert.equal(dayBars[index].getAttribute('title'), `${label}: ${count}`);
}
const expectedModels = Object.entries(audit.modelUsage).sort(([a, av], [b, bv]) => bv - av || a.localeCompare(b)).slice(0, 10);
const modelRows = panel('Models in the pond').querySelector('div.space-y-3')?.children ?? [];
assert.equal(modelRows.length, expectedModels.length);
for (let i = 0; i < expectedModels.length; i++) {
  const [model, count] = expectedModels[i];
  const spans = modelRows[i].querySelectorAll('span');
  assert.equal(text(spans[0]), model.split('/').pop().replace(/[-_]+/g, ' '));
  assert.equal(text(spans[1]), format(count));
}
assert.deepEqual(values(panel('What the frogs produced').querySelector('div.grid')), [audit.totalSources, audit.totalTurns, audit.totalFollowups, audit.promptTokens + audit.completionTokens].map(format));
assert.ok(panel('What the frogs produced').textContent.includes("Aggregate counts from DebateFrog's database"));
assert.ok(results.textContent.includes('Day counts use UTC and include today.'));
if (audit.lastUpdatedAt) {
  const latest = new Date(audit.lastUpdatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  assert.ok(results.textContent.includes(`Latest activity ${latest} UTC`));
}
console.log(JSON.stringify({url, result:'PASS', checkedAgainst:audit.checkedAt, total:audit.parsedCount, completed:audit.statusCounts.complete ?? 0, failed:audit.statusCounts.failed ?? 0, unfinished:audit.unfinished.length, checks:['outcomes reconcile','completion percentage','7/30-day totals','14 daily buckets','model counts','source/turn/follow-up/token totals','feedback count','pond theme']}, null, 2));
