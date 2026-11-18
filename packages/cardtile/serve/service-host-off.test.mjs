// With the service host's settings unset — or set to anything that is not exactly their one value —
// every answer is the one the cardtile worker gave before the settings existed.
//
// "Before" is a committed fixture, captured from the Worker that had no such code
// (gen-service-host-off-fixture.mjs): 3 stages of reef.cards × 7 hosts × 34 requests, each with its
// status, headers, body hash and store reads. This file asks THIS tree's Worker the same cases.
import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './card-worker.mjs';
import { gridCases, answerOf, answerDiff, atFixedClock, readFixture, GRID_STAGES, GRID_HOSTS, GRID_REQUESTS } from './gen-service-host-off-fixture.mjs';

const FIXTURE = readFixture();
const CASES = gridCases();

/** every case under `extra` settings → the list of mismatches against the fixture */
async function mismatches(extra) {
  const out = [];
  await atFixedClock(async () => {
    for (const c of CASES) {
      const d = answerDiff(await answerOf(worker, c, extra), FIXTURE.answers[c.key]);
      if (d) out.push(`${c.key}: ${d}`);
    }
  });
  return out;
}

test('CONTROL: the fixture holds the whole grid, and the grid reaches every kind of answer', () => {
  assert.equal(CASES.length, Object.keys(GRID_STAGES).length * GRID_HOSTS.length * GRID_REQUESTS.length);
  assert.equal(CASES.length, 714);
  assert.equal(Object.keys(FIXTURE.answers).length, CASES.length, 'one answer per case');
  assert.match(FIXTURE.base, /^[0-9a-f]{40}$/);
  const statuses = new Set(Object.values(FIXTURE.answers).map((a) => a.status));
  for (const s of [200, 301, 400, 401, 404, 415]) assert.ok(statuses.has(s), `no ${s} in the grid`);
  // the three hosts of the ruling are in it, and so is the editor's page (the answer a renderer change moves)
  for (const h of ['reef.cards', 'card.feelreef.com', 'cards.feelreef.com']) assert.ok(GRID_HOSTS.includes(h));
  assert.ok(FIXTURE.answers['canonical card.feelreef.com GET /try/edit'].status === 301);
  assert.ok(FIXTURE.answers['dark card.feelreef.com GET /try/edit'].bytes > 100000);
});

test('unset: all 714 answers are the fixture\'s, byte for byte, headers and store reads included', async () => {
  const bad = await mismatches({});
  console.log(`# service host off (unset): ${CASES.length} answers compared, ${bad.length} mismatches`);
  assert.deepEqual(bad, []);
});

// a value that is not exactly the setting's one value is off; so is a stand-in list with the service host off
const OFF_VALUES = [
  ['empty', { CARDS_SERVICE_HOST: '' }],
  ['"true"', { CARDS_SERVICE_HOST: 'true' }],
  ['"1"', { CARDS_SERVICE_HOST: '1' }],
  ['the legacy host', { CARDS_SERVICE_HOST: 'card.feelreef.com' }],
  ['a typo', { CARDS_SERVICE_HOST: 'cards.feelreef.co' }],
  ['reef.cards', { CARDS_SERVICE_HOST: 'reef.cards' }],
  ['stand-ins alone', { CARDS_HOST_STANDINS: 'service=cards-staging.feelreef.com people=staging.reef.cards legacy=card-staging.feelreef.com' }],
  ['a malformed stand-in list', { CARDS_HOST_STANDINS: 'service=evil.example, people, =x, legacy=cards.feelreef.com' }],
];
for (const [name, extra] of OFF_VALUES) {
  test(`off (${name}): all 714 answers are the fixture's`, async () => {
    const bad = await mismatches(extra);
    console.log(`# service host off (${name}): ${CASES.length} answers compared, ${bad.length} mismatches`);
    assert.deepEqual(bad, []);
  });
}

test('CONTROL: the comparison can fail — with both settings on, answers differ from the fixture', async () => {
  const ON = { CARDS_SERVICE_HOST: 'cards.feelreef.com' };
  const bad = await mismatches(ON);
  assert.ok(bad.length > 0, 'the service host changed nothing: the grid is not looking at it');
  assert.ok(bad.some((b) => b.startsWith('canonical reef.cards GET /:')), 'reef.cards/ is not among the answers that moved');
  const movedIn = (stage) => [...new Set(bad.filter((b) => b.startsWith(`${stage} `)).map((b) => b.split(' ')[1]))].sort();
  // before the cutover ('open'): the service host itself, and nothing else anywhere
  assert.deepEqual(movedIn('dark'), ['cards.feelreef.com']);
  assert.deepEqual(movedIn('open'), ['cards.feelreef.com']);
  // with the cutover ('split'): on every host outside the three, the one thing that moves is the text
  // of a page (its "make your own" address, and the platform's own handle's canonical address) —
  // never a status, a header or a store read
  const ROLES = ['reef.cards', 'card.feelreef.com', 'cards.feelreef.com'];
  let pages = 0;
  await atFixedClock(async () => {
    for (const c of CASES.filter((x) => x.stage === 'canonical' && !ROLES.includes(x.host))) {
      const got = await answerOf(worker, c, ON), want = FIXTURE.answers[c.key];
      assert.equal(got.status, want.status, c.key);
      assert.deepEqual(got.headers, want.headers, c.key);
      assert.deepEqual(got.reads, want.reads, c.key);
      if (got.sha !== want.sha) {
        pages += 1;
        assert.match(String(got.headers.find(([k]) => k === 'content-type')?.[1]), /^text\/html/, `${c.key}: a body that is not a page moved`);
        assert.ok([1, 19].includes(got.bytes - want.bytes), `${c.key}: ${got.bytes - want.bytes} bytes longer`);
      }
    }
  });
  assert.ok(pages > 0, 'no page outside the three hosts carries the new address');
});
