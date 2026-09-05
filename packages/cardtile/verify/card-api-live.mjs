// The Card write API, against the REAL edge and the REAL store.
//
// 🩸 THIS USED TO BE THE ONE HARNESS THAT KEPT A REAL HANDLE, and the reasoning was wrong twice.
//
// It said these questions "need a row that actually exists in the live store", and concluded the
// fix was to PUT a permanent `specimen` row there — a write to production, parked as somebody
// else's decision. Neither half held up:
//
//   · The door checks need NO row. requireAuth runs before the handle is resolved, so a valid
//     token on a handle nobody owns answers 404 while a bad one answers 401. That difference IS
//     the "the secret is deployed" signal, and json() sets no-store on the 404 as well.
//   · The shape checks need a row that CARRIES ASSETS — a requirement for a row, not for a
//     customer. Section 4 already creates exactly that one, exercises it, and deletes it.
//
// So nothing permanent gets written and no creator is named. The part that actually mattered was
// never the reading: section 3 fired AUTHENTICATED PUTs at a creator's card, held off by a
// `dry_run` flag. One regressed flag from an outage on somebody's live page.
//
// The unit suite (serve/card-api.test.mjs) runs the same logic over a Map. What it CANNOT reach is
// everything this file exists for: whether the secret actually got deployed, whether KV reads back
// what was written, whether an edge cache sits in front of an unauthenticated request, and whether a
// creator's live card survives contact with the thing that is about to edit it.
//
//   node packages/cardtile/verify/card-api-live.mjs                       # the door only — no writes, no rows
//   node packages/cardtile/verify/card-api-live.mjs --write               # + lifecycle AND shape checks on a scratch row
//   node packages/cardtile/verify/card-api-live.mjs --base https://…      # a different deployment
//   node packages/cardtile/verify/card-api-live.mjs --write --card <h>    # 🔴 aim the shape checks at a REAL card
//                                                                         #    (reads + two dry-run PUTs on it)
//
// The bearer is read from the macOS Keychain (`cardtile-mcp-token`) and never printed — not in a log
// line, not in an error. 🔴 A failure here must not become the place a credential leaks.
import { execFileSync } from 'node:child_process';
import { usableConfig } from '../serve/wrangler-config.mjs';

const _cfg = usableConfig();
// 🔴 Refuse EARLY rather than at cleanup time. This harness writes to the live store, and a run that
// gets all the way to "remove the scratch row" and then finds it has no deploy config leaves that
// row behind on production. "I cannot clean up" has to be a reason not to start.
if (!_cfg.ok) { console.log(_cfg.why); process.exit(0); }
const WRANGLER_CFG = _cfg.path;


const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const BASE = arg('--base', 'https://card.feelreef.com');
const WRITE = process.argv.includes('--write');
// 🔴 A handle nobody's card could be. The write half creates and then deletes this row; pointing it
// at a real handle is how a verification script becomes an outage.
const SCRATCH = arg('--scratch', 'kitt-probe');
// 🔴 A handle nobody's card could be, that does NOT exist. The door checks below need a valid
// token to be distinguishable from an invalid one, and 404-vs-401 is that signal — requireAuth
// runs BEFORE the handle is resolved, so a good token on a missing row answers 404. No row needed.
const NOBODY = arg('--nobody', 'kitt-probe-absent');
// Opt-in ONLY. Passing --card aims the read half at a real creator's card, including two
// authenticated dry-run PUTs. That used to be the DEFAULT, pointed at a customer.
const LIVE_CARD = arg('--card', null);

let TOKEN;
try {
  TOKEN = execFileSync('security', ['find-generic-password', '-s', 'cardtile-mcp-token', '-w'], { encoding: 'utf8' }).trim();
} catch {
  // 🔴 SKIPPED, not failed — same reasoning as editor-save.mjs. This one WRITES to the live store,
  // so on a machine without the key there is nothing to check, and exiting non-zero would make
  // "no credential here" indistinguishable from "the live API is broken". That distinction is the
  // whole point of the inventory: a runner that cannot tell them apart reports rot that is not there.
  console.log('usage: needs a live credential — no `cardtile-mcp-token` in the Keychain, so nothing was checked');
  process.exit(0);
}

let bad = 0;
const ok = (m) => console.log(`   ✓ ${m}`);
const fail = (m) => { console.log(`   🔴 ${m}`); bad++; };
const check = (cond, m) => (cond ? ok(m) : fail(m));

/** 🔴 Never let a thrown error carry the request — an exception's own message would print headers. */
async function api(method, path, body, { token = TOKEN } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      // defeat the 60s edge cache on the unauthenticated paths — otherwise a stale answer from the
      // PREVIOUS deployment is what gets measured. That is not hypothetical: the first probe of this
      // endpoint returned the old build's 404 for exactly that reason (2026-07-30).
      'cache-control': 'no-cache',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* an HTML body is itself the finding */ }
  return { status: r.status, json, text, headers: r.headers };
}

// ── 1. the door ─────────────────────────────────────────────────────────────────────────────────
//
// 🩸 This used to ask the door about a REAL CREATOR'S CARD, because "does the deployed secret work"
// felt like it needed a row that exists. It does not. requireAuth runs before the handle is
// resolved, so the three answers separate cleanly on a handle nobody owns:
//
//     no token      → 401        wrong token → 401        RIGHT token → 404
//
// The 404 is the control the 200 used to be: it can only come from a token that was ACCEPTED and
// then found nothing. And `json()` sets Cache-Control: no-store on every response, 404 included,
// so the cacheability claim survives the change too.
console.log(`\n1. THE DOOR  (${BASE}, on the absent handle "${NOBODY}")\n`);
{
  const none = await api('GET', `/_api/card/${NOBODY}`, null, { token: null });
  const wrong = await api('GET', `/_api/card/${NOBODY}`, null, { token: 'not-the-token' });
  const right = await api('GET', `/_api/card/${NOBODY}`);
  check(none.status === 401, `no token → 401 (got ${none.status})`);
  check(wrong.status === 401, `wrong token → 401 (got ${wrong.status})`);
  // THE CONTROL. Without it a pair of 401s could equally mean "this route does not exist here".
  // 404 ≠ 401 is the whole signal: the secret is deployed and was accepted.
  check(right.status === 404, `the real token → 404, i.e. accepted then not found (got ${right.status})`);
  check(none.text === wrong.text, 'the two refusals are byte-identical — never say which way it failed');
  check(/no-store/.test(right.headers.get('cache-control') || ''), 'an authorised answer is not cacheable at the edge');
}

// ── 2/3 moved ───────────────────────────────────────────────────────────────────────────────────
//
// The shape checks (thin ≪ stored, assets_carried, the 409 on a stale base_version) used to run
// here, against a creator's live card, because they need a row that CARRIES ASSETS. That is a real
// requirement — and it is a requirement for a row, not for a customer. Section 4 builds exactly
// that row and then removes it, so they run there now.
//
// 🔴 The half that mattered was not the reading. Section 3 fired authenticated PUTs at a creator's
// card, held back only by a `dry_run` flag. This file's own comment says "pointing it at a real
// handle is how a verification script becomes an outage" — it was written about the scratch
// handle, and it was just as true of the live one. One regressed flag away.
//
// --card <handle> still aims them at a real card, deliberately, for the rare time that is the
// question. It is no longer what happens when you type nothing.

if (!WRITE) {
  console.log(`\n${bad ? `🔴 ${bad} failed` : '✅ all passed'}  —  that was the door only.`);
  console.log('   The shape checks need a row that carries an asset, so they run under --write,');
  console.log('   on the scratch row it creates and removes. Nothing permanent is written.\n');
  process.exit(bad ? 1 : 0);
}

// ── 4. the full lifecycle, on a scratch handle ──────────────────────────────────────────────────
//
// 🔴 Everything below WRITES. It writes to `SCRATCH` and nowhere else, and it deletes the row when
// it is done. A creator's card is never the specimen.
console.log(`\n4. LIFECYCLE  (scratch handle "${SCRATCH}" — created, exercised, removed)\n`);
{
  const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const seed = [
    '---', `card-page: ${SCRATCH}`, 'title: Probe', '---', '',
    '## grid', '',
    '- [ ] %% card: profile w=6 avatar="asset:pic" %% a scratch card',
    '- [ ] %% card: link w=3 %% [Example](https://example.com)',
    '',
  ].join('\n');

  const created = await api('PUT', `/_api/card/${SCRATCH}`, { markdown: seed });
  check(created.status === 200 && created.json.created === true, `created (${created.status})`);
  const v1 = created.json.version;

  // 🔴 READ BACK from the store, not from the response. The response is what we intended; the store
  // is what happened, and KV is eventually consistent enough for those to differ.
  const back = await api('GET', `/_api/card/${SCRATCH}`);
  check(back.json.version === v1, 'the version the store reports matches the one the save returned');

  const put = await api('PUT', `/_api/card/${SCRATCH}/asset/pic`, { base64: GIF, mime: 'image/gif' });
  check(put.status === 200, `put_asset (${put.status})`);
  check(put.json.version !== v1, 'adding bytes changed the version');

  // the thin↔fat claim, through the REAL edge: what an agent gets back must not contain the bytes,
  // and the public `.md` exit must.
  const thin = await api('GET', `/_api/card/${SCRATCH}`);
  const fat = await (await fetch(`${BASE}/${SCRATCH}.md`, { headers: { 'cache-control': 'no-cache' } })).text();
  check(!thin.json.markdown.includes(GIF), 'the thin exit withholds the bytes');
  check(fat.includes(GIF), 'the public .md exit carries them');
  check(fat.length > thin.json.markdown.length, `fat ${fat.length} B > thin ${thin.json.markdown.length} B`);

  // ── 2/3. the shape checks. SHAPE is the scratch row unless --card said otherwise.
  const SHAPE = LIVE_CARD || SCRATCH;
  if (LIVE_CARD) console.log(`\n   ⚠️  --card ${LIVE_CARD}: the checks below READ and send two DRY-RUN PUTs to a REAL card.\n`);

  // ── 2. get_card, on a row that carries an asset ───────────────────────────────────────────────
  console.log(`\n   2. GET_CARD  (${SCRATCH})\n`);
  const live = (await api('GET', `/_api/card/${SHAPE}`)).json;
  {
  check(!!live && !!live.markdown, 'a card came back');
  const b64ish = /[A-Za-z0-9+/]{200,}/.test(live.markdown || '');
  check(!b64ish, 'no base64 crossed the wire');
  check((live.markdown || '').length < live.total_bytes, `thin ${live.markdown.length} B ≪ stored ${live.total_bytes} B`);
  const unref = (live.assets || []).filter((a) => !a.referenced);
  ok(`${live.assets.length} assets, ${unref.length} unreferenced, version ${live.version}`);
  }

  // ── 3. the guards, WITHOUT writing ────────────────────────────────────────────────────────────
  console.log('\n   3. THE GUARDS  (dry runs — nothing is written)\n');
  {
  const unchanged = await api('PUT', `/_api/card/${SHAPE}`, {
    markdown: live.markdown, base_version: live.version, dry_run: true,
  });
  check(unchanged.status === 200 && unchanged.json.wouldChange === false,
    'round-tripping the live card unchanged would write the SAME bytes (wouldChange:false)');
  check(unchanged.json.assets_carried === live.assets.length,
    `all ${live.assets.length} assets would be carried back`);

  const stale = await api('PUT', `/_api/card/${SHAPE}`, {
    markdown: live.markdown, base_version: 'v1:0000000000000000',
  });
  check(stale.status === 409 && stale.json.current === live.version,
    `a stale base_version is refused, naming both sides (${stale.status})`);
  // CONTROL for the line above: the CORRECT version is accepted (as a dry run, so still no write).
  const fresh = await api('PUT', `/_api/card/${SHAPE}`, {
    markdown: live.markdown, base_version: live.version, dry_run: true,
  });
  check(fresh.status === 200, 'the correct base_version passes — so the 409 is about the version');

  const empty = await api('PUT', `/_api/card/${SHAPE}`, { markdown: '' });
  check(empty.status === 400, 'an empty card is refused — a save is not how a card gets deleted');
  }

  // 🔴 the save that would have blanked the picture: send the thin card back, unchanged
  const kept = await api('PUT', `/_api/card/${SCRATCH}`, { markdown: thin.json.markdown, base_version: thin.json.version });
  check(kept.status === 200, `a thin save round-trips (${kept.status})`);
  const afterKept = await (await fetch(`${BASE}/${SCRATCH}.md`, { headers: { 'cache-control': 'no-cache' } })).text();
  check(afterKept.includes(GIF), '🔴 the picture survived a thin save');
  check(afterKept === fat, 'and the stored bytes are byte-identical to before the save');

  // 🔴 THE CONTROL for byte-exactness. "The save wrote the same bytes" and "the probe cannot see a
  // difference" look identical from here — so make a one-character edit and require it to show up.
  // Without this, `afterKept === fat` would pass just as happily on a comparison that is blind.
  const edited = thin.json.markdown.replace('a scratch card', 'a scratched card');
  await api('PUT', `/_api/card/${SCRATCH}`, { markdown: edited });
  const afterEdit = await (await fetch(`${BASE}/${SCRATCH}.md`, { headers: { 'cache-control': 'no-cache' } })).text();
  check(afterEdit !== fat, 'CONTROL: a one-word edit DOES change the stored bytes');
  check(afterEdit.includes('a scratched card'), 'and it is the edit that changed them');
  check(afterEdit.includes(GIF), 'while the picture still survived');
  // put it back, so the assertions below measure the card they were written against
  await api('PUT', `/_api/card/${SCRATCH}`, { markdown: thin.json.markdown });

  // delete_asset refuses while referenced…
  const refused = await api('DELETE', `/_api/card/${SCRATCH}/asset/pic`);
  check(refused.status === 409 && refused.json.referenced === true, `delete refused while referenced (${refused.status})`);

  // …and the orphan report appears the moment the reference goes, WITHOUT collecting anything
  const noRef = thin.json.markdown.replace(' avatar="asset:pic"', '');
  const orphaned = await api('PUT', `/_api/card/${SCRATCH}`, { markdown: noRef });
  check(orphaned.status === 200 && orphaned.json.orphans.includes('pic'), 'the orphan is reported');
  const stillThere = await (await fetch(`${BASE}/${SCRATCH}.md`, { headers: { 'cache-control': 'no-cache' } })).text();
  check(stillThere.includes(GIF), '🔴 reporting an orphan did NOT collect it');

  // CONTROL: now that it is unreferenced, the delete goes through. So the 409 above was about the
  // reference and not about DELETE being broken.
  const deleted = await api('DELETE', `/_api/card/${SCRATCH}/asset/pic`);
  check(deleted.status === 200, `the same delete succeeds once unreferenced (${deleted.status})`);

  // preview_card: a URL that renders, is not indexed, and is not the card
  const pv = await api('POST', '/_api/preview', { handle: SCRATCH, markdown: thin.json.markdown });
  check(pv.status === 200 && /\/_preview\/[0-9a-f]{32}$/.test(pv.json.url || ''), `preview URL (${pv.status})`);
  const pvRes = await fetch(pv.json.url, { headers: { 'cache-control': 'no-cache' } });
  const pvHtml = await pvRes.text();
  check(pvRes.status === 200 && /<title>Probe<\/title>/.test(pvHtml), 'the preview renders the draft');
  check(/noindex/.test(pvRes.headers.get('x-robots-tag') || ''), '🔴 the preview is noindex on PRODUCTION');
  check(/no-store/.test(pvRes.headers.get('cache-control') || ''), 'the preview is not cached');

  // 🔴 A DIFFERENT token. `cver-cloudflare-token` deploys this Worker and cannot delete a KV key —
  // measured here, 2026-07-30: `Authentication error [code: 10000]`. 「一把≠每道門」, and the failure
  // arrives as an auth error rather than as a permission list, so the fix is to look up which key
  // opens THIS door rather than to conclude the door is shut. `cver-cf-kv` is the one that created
  // this namespace in the first place (see serve/wrangler.example.toml for the binding).
  console.log(`\n   cleanup: removing "${SCRATCH}"`);
  try {
    const kvToken = execFileSync('security', ['find-generic-password', '-s', 'cver-cf-kv', '-w'], { encoding: 'utf8' }).trim();
    execFileSync('npx', ['wrangler', 'kv', 'key', 'delete', '--remote', '--binding=CARDS', SCRATCH,
      '--config', WRANGLER_CFG, '--env', 'production'],
    { stdio: 'inherit', cwd: new URL('../serve/', import.meta.url).pathname, env: { ...process.env, CLOUDFLARE_API_TOKEN: kvToken } });
  } catch {
    // 🔴 the caught error is DISCARDED, not printed. execFileSync's message embeds the full argv and
    // the environment it was given — printing it is how a token ends up in a terminal scrollback.
    fail(`could not delete the scratch row "${SCRATCH}" — remove it by hand`);
  }
  const gone = await api('GET', `/_api/card/${SCRATCH}`);
  check(gone.status === 404, `the scratch card is gone (${gone.status})`);
}

console.log(`\n${bad ? `🔴 ${bad} failed` : '✅ all passed'}\n`);
process.exit(bad ? 1 : 0);
