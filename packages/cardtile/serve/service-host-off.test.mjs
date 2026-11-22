// With the service host's settings unset — or set to anything that is not exactly their one value —
// every answer is the one the cardtile worker gave before the settings existed.
//
// "Before" is a committed fixture, captured from the Worker that had no such code
// (gen-service-host-off-fixture.mjs): 3 stages of reef.cards × 7 hosts × 34 requests, each with its
// status, headers, body hash and store reads. This file asks THIS tree's Worker the same cases.
//
// And a wide grid beside it (wideCases: 2 deployments × 3 stages × 18 hosts × 18 paths × 6 methods =
// 11,664), for what the 714 never asked: the stand-ins' own hostnames, hosts spelled with another
// case, a port or a trailing dot, every method on every path, contradicting Host headers, and a
// deployment that is not production.
import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './card-worker.mjs';
import { gridCases, answerOf, answerDiff, atFixedClock, readFixture, GRID_STAGES, GRID_HOSTS, GRID_REQUESTS,
  wideCases, wideAnswerOf, WIDE_HOSTS, WIDE_PATHS, WIDE_METHODS, WIDE_DEPLOYMENTS, WIDE_STANDINS } from './gen-service-host-off-fixture.mjs';

const FIXTURE = readFixture();
const CASES = gridCases();

// tile#372: the page's policy is sent report-only by default, so this tree's people's pages carry one header
// the fixture's Worker did not send. That header is cardtile-page-csp.test.mjs's to check (where on the grid,
// and that it is the only difference); here it is the one header not compared.
const POLICY_HEADER = 'content-security-policy-report-only';
const withoutPolicy = (a) => ({ ...a, headers: a.headers.filter(([k]) => k !== POLICY_HEADER) });

/** every case under `extra` settings → the list of mismatches against the fixture */
async function mismatches(extra) {
  const out = [];
  await atFixedClock(async () => {
    for (const c of CASES) {
      const d = answerDiff(withoutPolicy(await answerOf(worker, c, extra)), FIXTURE.answers[c.key]);
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
  // not exactly the value: another case, a space around it, a line end after it
  ['upper case', { CARDS_SERVICE_HOST: 'CARDS.FEELREEF.COM' }],
  ['a space around it', { CARDS_SERVICE_HOST: ' cards.feelreef.com ' }],
  ['a line end after it', { CARDS_SERVICE_HOST: 'cards.feelreef.com\n' }],
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
      const got = withoutPolicy(await answerOf(worker, c, ON)), want = FIXTURE.answers[c.key];
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

// ── the wide grid ───────────────────────────────────────────────────────────────────────────────
const WIDE = wideCases();
const STANDIN_HOSTS = ['cards-staging.feelreef.com', 'card-staging.feelreef.com', 'staging.reef.cards'];

/** every wide case under `extra` settings → the list of mismatches against the fixture */
async function wideMismatches(extra) {
  const out = [];
  await atFixedClock(async () => {
    for (let i = 0; i < WIDE.length; i++) {
      const d = answerDiff(withoutPolicy(await wideAnswerOf(worker, WIDE[i], extra)), FIXTURE.wide[i]);
      if (d) out.push(`${WIDE[i].key}: ${d}`);
    }
  });
  return out;
}

test('CONTROL: the fixture holds the whole wide grid, and it asks the stand-ins\' own hostnames under every method', () => {
  assert.equal(WIDE.length, Object.keys(WIDE_DEPLOYMENTS).length * Object.keys(GRID_STAGES).length * WIDE_HOSTS.length * WIDE_PATHS.length * WIDE_METHODS.length);
  assert.equal(WIDE.length, 11664);
  assert.equal(FIXTURE.wide.length, WIDE.length, 'one answer per case');
  assert.ok(FIXTURE.wide.every((a) => a && Number.isInteger(a.status)), 'an index in the fixture names no answer');
  for (const h of STANDIN_HOSTS) {
    assert.ok(WIDE_HOSTS.includes(h), `${h} is not asked`);
    assert.ok(WIDE_STANDINS.split(' ').some((e) => e.split('=')[1] === h), `${h} is not in the stand-in list the grid sets`);
  }
  for (const m of ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS', 'PROPFIND']) assert.ok(WIDE_METHODS.includes(m), m);
  assert.deepEqual(Object.keys(WIDE_DEPLOYMENTS), ['production', 'preview']);
});

// "off" on the wide grid: unset, a value that is not exactly the setting's, and a stand-in list
// beside each of them — asked on the stand-ins' own hostnames too, in production and outside it
const WIDE_OFF = [
  ['unset', {}],
  ['upper case', { CARDS_SERVICE_HOST: 'CARDS.FEELREEF.COM' }],
  ['a space around it', { CARDS_SERVICE_HOST: ' cards.feelreef.com ' }],
  ['stand-ins alone', { CARDS_HOST_STANDINS: WIDE_STANDINS }],
  ['a typo, with stand-ins', { CARDS_SERVICE_HOST: 'typo', CARDS_HOST_STANDINS: WIDE_STANDINS }],
];
for (const [name, extra] of WIDE_OFF) {
  test(`off, wide grid (${name}): all 11,664 answers are the fixture's`, async () => {
    const bad = await wideMismatches(extra);
    console.log(`# service host off, wide grid (${name}): ${WIDE.length} answers compared, ${bad.length} mismatches`);
    assert.deepEqual(bad.slice(0, 20), [], `${bad.length} mismatches`);
  });
}

test('the wide comparison can fail — switched on, a stand-in answers as its role outside production; in production the list changes no answer', async () => {
  const ON = { CARDS_SERVICE_HOST: 'cards.feelreef.com' };
  const WITH = { ...ON, CARDS_HOST_STANDINS: WIDE_STANDINS };
  const moved = { production: new Set(), preview: new Set() };
  let asked = 0, differ = 0;
  await atFixedClock(async () => {
    for (let i = 0; i < WIDE.length; i++) {
      const c = WIDE[i];
      if (!STANDIN_HOSTS.includes(c.host)) continue;
      asked += 1;
      const withList = await wideAnswerOf(worker, c, WITH);
      // against the Worker that had no such setting
      if (answerDiff(withoutPolicy(withList), FIXTURE.wide[i])) moved[c.deployment].add(c.host);
      // against this Worker without the list: in production the list is not read at all
      if (c.deployment === 'production' && answerDiff(withList, await wideAnswerOf(worker, c, ON))) differ += 1;
    }
  });
  assert.equal(asked, 2 * 3 * STANDIN_HOSTS.length * WIDE_PATHS.length * WIDE_METHODS.length);
  for (const h of STANDIN_HOSTS) assert.ok(moved.preview.has(h), `${h}: a stand-in outside production changed nothing — the grid is not looking at it`);
  assert.equal(differ, 0, 'a stand-in list changed an answer in a production deployment');
});
