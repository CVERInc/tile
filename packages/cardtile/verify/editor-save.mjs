// cardtile-w's fifth claim: the human editor writes to the live card, and offers the backup at the
// moment something can be lost.
//
//   5a. GATE     the save button appears only when this machine can actually save.
//   5b. BACKUP   「先存一份」 is PRE-TICKED, downloads the FAT card, and happens BEFORE the write.
//   5c. SAVE     the write lands, the pictures survive, and the version advances.
//   5d. LOCK     a stale base_version is refused in the editor, in the editor's own words.
//
// 🔴 Every one has a control, and the controls are the point: 「從沒看過它失敗的檢查」. A save button
// that is always visible and a save button that is correctly visible look the same in a screenshot.
//
//   node packages/cardtile/verify/editor-save.mjs            # against a scratch card on production
//   node packages/cardtile/verify/editor-save.mjs --keep     # leave the scratch card behind
//
// The bearer never enters the browser: it lives in the Keychain, serve.mjs reads it, and the page
// talks to 127.0.0.1. This script asserts that too — a page that could see the token would be the
// whole reason not to build this.
import { execFileSync } from 'node:child_process';

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLAYWRIGHT } from './paths.mjs';
import { createServer } from '../w/serve.mjs';
import { usableConfig } from '../serve/wrangler-config.mjs';

const _cfg = usableConfig();
// 🔴 Refuse EARLY rather than at cleanup time. This harness writes to the live store, and a run that
// gets all the way to "remove the scratch row" and then finds it has no deploy config leaves that
// row behind on production. "I cannot clean up" has to be a reason not to start.
if (!_cfg.ok) { console.log(_cfg.why); process.exit(0); }
const WRANGLER_CFG = _cfg.path;

const KEEP = process.argv.includes('--keep');
const SCRATCH = 'kitt-probe';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const API = 'https://card.feelreef.com';

let TOKEN;
try {
  TOKEN = execFileSync('security', ['find-generic-password', '-s', 'cardtile-mcp-token', '-w'], { encoding: 'utf8' }).trim();
} catch {
  // 🔴 SKIPPED, not failed. This harness WRITES to the live card store; without the credential there
  // is nothing it can check, and exiting non-zero would make "no key on this machine" look identical
  // to "the save path is broken". Exit 0 and say which is which.
  console.log('usage: needs a live credential — no `cardtile-mcp-token` in the Keychain, so nothing was checked');
  process.exit(0);
}

let bad = 0;
const ok = (m) => console.log(`   ✓ ${m}`);
const fail = (m) => { console.log(`   🔴 ${m}`); bad++; };
const check = (c, m) => (c ? ok(m) : fail(m));

const api = async (method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}), 'cache-control': 'no-cache' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// ── the specimen: a scratch card with a real picture on it ──────────────────────────────────────
const SEED = [
  '---', `card-page: ${SCRATCH}`, 'title: Probe', 'lang: zh-TW', '---', '',
  '## grid', '',
  '- [ ] %% card: profile w=6 avatar="asset:pic" %% 一句話',
  '- [ ] %% card: link w=6 %% [Example](https://example.com)',
  '',
].join('\n');

await api('PUT', `/_api/card/${SCRATCH}`, { markdown: SEED });
await api('PUT', `/_api/card/${SCRATCH}/asset/pic`, { base64: GIF, mime: 'image/gif' });
const seeded = (await api('GET', `/_api/card/${SCRATCH}`)).json;

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const url = (q = '') => `http://127.0.0.1:${PORT}/packages/cardtile/w/${q}`;

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
const downloads = mkdtempSync(join(tmpdir(), 'ctw-dl-'));
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
const saved = [];
page.on('download', async (d) => { const p = join(downloads, d.suggestedFilename()); await d.saveAs(p); saved.push(p); });

// ── 5a. the gate ────────────────────────────────────────────────────────────────────────────────
console.log('\n5a. THE GATE\n');
await page.goto(url(`?handle=${SCRATCH}`), { waitUntil: 'networkidle' });
{
  check(await page.isVisible('#publish'), 'the save button is there when the machine holds a token');
  const version = await page.evaluate(() => window.__cardtileW.baseVersion);
  check(version === seeded.version, `the editor read the card's version (${version})`);

  // 🔴 THE CONTROL. Same page, told it cannot save — the button must go. Without this, "visible"
  // proves only that a button exists in the HTML.
  await page.evaluate(() => { window.__cardtileW.canSave = false; });
  check(!(await page.isVisible('#publish')), 'CONTROL: with no token the button is not there at all');
  await page.evaluate(() => { window.__cardtileW.canSave = true; });
}

// 🔴 The credential must not be reachable from the page. This is the reason the bridge exists.
{
  const leaked = await page.evaluate(async () => {
    const html = document.documentElement.outerHTML;
    const src = await Promise.all(
      [...document.querySelectorAll('script[src]')].map((s) => fetch(s.src).then((r) => r.text()).catch(() => '')),
    );
    return html + src.join('');
  });
  check(!leaked.includes(TOKEN), '🔴 the bearer is nowhere in the page or its scripts');
  // CONTROL: the probe can find a token-shaped string when one IS present.
  check(`${leaked}${TOKEN}`.includes(TOKEN), 'CONTROL: the leak probe can see the token when it is there');
}

// ── 5b/5c. the backup, then the write ───────────────────────────────────────────────────────────
console.log('\n5b/5c. THE BACKUP, THEN THE WRITE\n');
{
  check(saved.length === 0, '🔴 opening a card downloaded NOTHING — the friction is not here');

  await page.evaluate(() => {
    const w = window.__cardtileW;
    w.commit(w.md.replace('一句話', '一句話介紹'));
  });
  await page.click('#publish');
  check(await page.isChecked('#pub-backup'), '🔴 「先存一份」 is PRE-ticked — an offered backup that must be sought is not offered');
  const what = await page.textContent('#pub-what');
  check(!/無法確認/.test(what), 'the card was read from the store, so the confirmation does not warn about an unguarded save');

  await page.click('#pub-go');
  await page.waitForFunction(() => /存好了|存不|改過/.test(document.querySelector('#pub-result')?.textContent || ''), null, { timeout: 20000 });
  const result = await page.textContent('#pub-result');
  check(/存好了/.test(result), `the editor reports a save (${result.split('\n')[0]})`);

  check(saved.length === 1, 'exactly one file was downloaded');
  const backup = saved[0] ? readFileSync(saved[0], 'utf8') : '';
  check(saved[0]?.endsWith(`${SCRATCH}.md`), `the backup is named after the card (${saved[0]?.split('/').pop()})`);
  // 🔴 THE FAT one. A backup missing the pictures is 99.7% missing on a real card.
  check(backup.includes(GIF), '🔴 the backup carries the PICTURES, not just the text');
  check(backup.includes('一句話介紹'), 'the backup is the state being SAVED, not the state on disk before it');

  const after = (await api('GET', `/_api/card/${SCRATCH}`)).json;
  // 🔴 the way OUT. Found by driving it: the dialog used to stay open with only a 取消 button, which
  // right after a completed save reads like it might undo one.
  check(await page.isHidden('#pub-go'), '🔴 after a save there is nothing left to press twice');
  check((await page.textContent('#pub-cancel')).trim() === '關閉', 'and the way out says 關閉, not 取消');
  await page.click('#pub-cancel');

  check(after.version !== seeded.version, 'the stored version advanced');
  check(after.markdown.includes('一句話介紹'), 'the edit is in the live card');
  const fat = await (await fetch(`${API}/${SCRATCH}.md`, { headers: { 'cache-control': 'no-cache' } })).text();
  check(fat.includes(GIF), '🔴 the picture survived a save made from the editor');

  // CONTROL: untick the backup and save again — nothing new is downloaded, so the tick is what
  // causes the download rather than the save doing it unconditionally.
  await page.evaluate(() => {
    const w = window.__cardtileW;
    w.commit(w.md.replace('一句話介紹', '一句話介紹自己'));
  });
  await page.click('#publish');
  await page.uncheck('#pub-backup');
  await page.click('#pub-go');
  await page.waitForFunction(() => /存好了/.test(document.querySelector('#pub-result')?.textContent || ''), null, { timeout: 20000 });
  check(saved.length === 1, 'CONTROL: unticking it downloads nothing — the tick is the cause');
  await page.click('#pub-cancel');

  // and the tick is not sticky: an opt-out must be re-asked every time
  await page.click('#publish');
  check(await page.isChecked('#pub-backup'), '🔴 the tick is re-ticked next time — opting out once is not forever');
  await page.click('#pub-cancel');
}

// ── 5d. the lock ────────────────────────────────────────────────────────────────────────────────
console.log('\n5d. THE LOCK\n');
{
  // Somebody else edits the card while this editor holds it open.
  const now = (await api('GET', `/_api/card/${SCRATCH}`)).json;
  await api('PUT', `/_api/card/${SCRATCH}`, { markdown: now.markdown.replace('Example', 'Elsewhere'), base_version: now.version });

  await page.evaluate(() => {
    const w = window.__cardtileW;
    w.commit(w.md.replace('一句話介紹自己', '被覆蓋掉的改動'));
  });
  await page.click('#publish');
  await page.click('#pub-go');
  await page.waitForFunction(() => (document.querySelector('#pub-result')?.textContent || '').length > 4, null, { timeout: 20000 });
  const msg = await page.textContent('#pub-result');
  check(/改過/.test(msg), `the editor refuses and says why (${msg.split('\n')[0]})`);
  // a REFUSED save leaves the 存 button, because there is still something to do here
  check(await page.isVisible('#pub-go'), 'a refusal leaves the save button — the work is not done');

  const stored = (await api('GET', `/_api/card/${SCRATCH}`)).json;
  check(stored.markdown.includes('Elsewhere'), "🔴 the other writer's change is still there");
  check(!stored.markdown.includes('被覆蓋掉的改動'), '🔴 the stale editor did NOT overwrite it');

  // CONTROL: re-read, redo, save — it goes through. So the 409 is about staleness, not about saving
  // being broken from here on.
  await page.click('#pub-cancel');
  await page.goto(url(`?handle=${SCRATCH}`), { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const w = window.__cardtileW;
    w.commit(w.md.replace('一句話介紹自己', '重做一次'));
  });
  await page.click('#publish');
  await page.uncheck('#pub-backup');
  await page.click('#pub-go');
  await page.waitForFunction(() => /存好了|改過/.test(document.querySelector('#pub-result')?.textContent || ''), null, { timeout: 20000 });
  check(/存好了/.test(await page.textContent('#pub-result')), 'CONTROL: re-opening and redoing the edit saves fine');
}

await browser.close();
await new Promise((r) => server.close(r));

if (!KEEP) {
  console.log(`\n   cleanup: removing "${SCRATCH}"`);
  try {
    // 🔴 A different token — `cver-cloudflare-token` deploys the Worker and cannot delete a KV key.
    const kv = execFileSync('security', ['find-generic-password', '-s', 'cver-cf-kv', '-w'], { encoding: 'utf8' }).trim();
    execFileSync('npx', ['wrangler', 'kv', 'key', 'delete', '--remote', '--binding=CARDS', SCRATCH,
      '--config', WRANGLER_CFG, '--env', 'production'],
    { stdio: 'ignore', cwd: new URL('../serve/', import.meta.url).pathname, env: { ...process.env, CLOUDFLARE_API_TOKEN: kv } });
  } catch {
    fail(`could not delete the scratch row "${SCRATCH}" — remove it by hand`);
  }
}

console.log(`\n${bad ? `🔴 ${bad} failed` : '✅ all passed'}  (downloads: ${downloads})\n`);
process.exit(bad ? 1 : 0);
