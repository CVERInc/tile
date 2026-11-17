// The root of the Cards host: the home deck (`reef.cards/`) and the referral deck
// (`reef.cards/?ref=<handle>`), as cardtile files. card-worker.mjs renders them with the renderer and
// the deck every Cards page gets, so the home is made of the product it shows.
//
// Behind a switch, default OFF: `CARDS_HOME_DECK` is the exact string `on` (card-worker homeDeckOn).
// Unset or any other value, the Worker answers exactly as it did before this file existed — and never
// loads this file.
//
// 🔴 ONLY card-worker's homeDeckAnswer imports this module, and by `import()`: a static import from
// card-worker.mjs, or from anything else the editor's entry (w3/edit3.mjs) reaches, puts these words
// in the sandbox's bundle on every host, switch or no switch. For the same reason nothing the home
// needs is added to the renderer or to w3/deck-page.mjs: the deck's home-only parts are written here,
// onto the page withDeck returns (deckOurs).
//
// What is here, and nothing else:
//   the words        HOME_DECK_WORDS — zh (Traditional) is the SOURCE: the product owner's sentences,
//                    word for word. Another locale is supplied through the TRANSLATED block below and
//                    until then is listed in HOME_DECK_MISSING. A page is one language: a locale
//                    that does not have every key gets the source page whole (the nothing-here page's
//                    rule, card-worker NOT_FOUND_WORDS), never a page in two languages.
//   the drafts       HOME_DECK_DRAFTS — the keys whose wording no ruling has fixed. They are drawn,
//                    behind the same switch, so the product owner can read them in place.
//   the two files    homeDeckSource / referralDeckSource — ordinary cardtile files (GRAMMAR.md).
//   the page's own   homeDeckPage — the deck (the one every Cards page gets, plus what only the home
//                    has: its mark on <html>, the way back, the kept ref), the footer (the one place
//                    that says "Powered by feelreef") and the referrer's name and picture, written
//                    into the rendered page as text.
//
// 🔴 Pure string work: no store, no clock but the footer's year, no request. The Worker decides who the
// referrer is (card-worker homeDeckAnswer); this file only ever receives a handle that already passed
// the handle grammar, and checks it again at each place it writes one.
import { LOCALE_KEYS, SANDBOX_LOCALES } from '../w/sandbox-i18n.mjs';
import { withDeck, DECK_TRY_URL } from '../w3/deck-page.mjs';

/** the visitor's sessionStorage key the ref is kept under (deckOurs writes it; nothing in this repository reads it yet) */
export const REF_STORAGE_KEY = 'cards-ref';
/** the handle grammar (card-api VALID_HANDLE), kept here so this file imports nothing that reads a store */
const HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const HOME_DECK_SOURCE = 'zh';
export const HOME_DECK_TITLE = 'REEF with Cards';   // the product's name: the same in every language

// The words written here by hand. `{name}` is the referrer's name, filled in by homeDeckPage.
const WRITTEN = {
  zh: {
    // the back of the first tile — one back, shared by the two decks
    whatTitle: '這是什麼？',
    what1: '一個網站、一疊名片、一副卡牌、一份簡報⋯⋯',
    what2: '怎麼用，都可以；有深度，可把玩。',
    what3: '免費註冊，不插廣告，不綁住你。',
    whatBrand: 'REEF — Rise, Emerge, Evolve, Flourish, with Cards.',
    // why
    why: '認識一個人，不必先加入同一個平台。',
    whyBack1: '帳號會被停，觸及由演算法決定。',
    whyBack2: '這裡給你一個自己的地址。',
    whyBack3: '地址不會過期。',
    // try it
    views: '三種看法',
    viewsBack1: '疊、攤、磚，預設三種全開。',
    viewsBack2: '可以只留想給的，至少一種。',
    viewsBack3: '訪客的選擇記在自己的瀏覽器。',
    say: '一句話就能改',
    sayBack: '接上慣用的 AI，用說的改；免費網頁版 ChatGPT、Claude 都可以',
    clock: '貼進來的時鐘',
    // it does not hold you
    fileTitle: '檔案屬於你',
    fileText: '你做的，都在一個檔案裡，隨時帶得走。',
    fileBack: '搬家、換平台，帶著它走就好。',
    domainTitle: '自己的網址',
    domainBack: 'REEF with Domain 有賣，也能免費接你已經有的網域。',
    // free
    freeTitle: '真的，這些免費。',
    freeText: '一個地址、兩種語言、各種玩法。',
    freeBackTitle: '你的 Cards，比想像中能裝。',
    freeCap1: '共 25 MB',
    freeCap2: '約 870 萬字',
    freeCap3: '約 60 張圖',
    freeSmall: '做成一疊純文字卡牌，每張 70 字以內，就能超過十萬張。',
    // the referral deck
    refLine: '{name}的那一頁，就是用這個做的。',
    refFree: '免費，不用註冊就能試。',
    refTry: '歡迎試玩，免註冊，滿意再存起來。',
    refTryBack: '改字、換圖、拖拉排序；存的時候留 email、不用密碼，改的跟著走',
    refSay: '說得好聽不夠，還要說得好看。',
    refSayBack: '接上慣用的 AI，用說的改；免費網頁版 ChatGPT、Claude 都可以',
    refOthers: '看看別人做了什麼。',
    refOthersBack: '隨機探索，遇見沒想過的人。',
  },
};

// The keys whose wording is not fixed by a ruling: each is the latest draft, made of the ruling's own
// words where it only gave the gist. Everything not listed here is a ruled sentence, word for word.
export const HOME_DECK_DRAFTS = Object.freeze([
  'whyBack1', 'whyBack2',                    // the back of "why": the ruling gives its points, not its sentences
  'viewsBack1', 'viewsBack2', 'viewsBack3',  // the back of "three views": likewise
  'sayBack',                                 // on the home: the referral deck's ruled back (refSayBack), reused
  'domainTitle',                             // the front of the address tile ("as it was": the ruling quotes no words)
  'freeSmall',                               // the small print about "free"
]);

// The words a translator supplied, one object per locale, keys in the source's order. Strict JSON
// between the two marker lines, so the translation step can read the block and rewrite it whole (the
// shape of w3/deck-i18n.mjs). A locale is used only when it has EVERY key.
// <translated>
const TRANSLATED = {};
// </translated>

export const HOME_DECK_WORDS = Object.fromEntries(LOCALE_KEYS
  .filter((k) => WRITTEN[k] || TRANSLATED[k])
  .map((k) => [k, { ...(TRANSLATED[k] || {}), ...(WRITTEN[k] || {}) }]));

export const HOME_DECK_KEYS = Object.keys(HOME_DECK_WORDS[HOME_DECK_SOURCE]);

/** every (locale, key) with no words of its own — the list a translator works from */
export const HOME_DECK_MISSING = Object.fromEntries(LOCALE_KEYS.filter((k) => k !== HOME_DECK_SOURCE)
  .map((k) => [k, HOME_DECK_KEYS.filter((key) => !(HOME_DECK_WORDS[k] && key in HOME_DECK_WORDS[k]))])
  .filter(([, keys]) => keys.length));

/** the locale a page for `locale` is written in: its own when complete, else the source */
export const homeDeckLocale = (locale) =>
  (Object.hasOwn(HOME_DECK_WORDS, locale) && !HOME_DECK_MISSING[locale] ? locale : HOME_DECK_SOURCE);

// A cardtile line is one line and its marker is `%%`: a word that would break either is cut to what
// cannot (a translator's block is JSON, and JSON can hold both).
const BREAKS = new RegExp(`[${String.fromCharCode(10, 13, 0x2028, 0x2029)}]+`, "g");   // every line break, the two Unicode ones included
const line = (s) => String(s == null ? "" : s).replace(BREAKS, " ").replace(/%%/g, "%").trim();
const wordsOf = (locale) => {
  const key = homeDeckLocale(locale);
  const W = Object.fromEntries(HOME_DECK_KEYS.map((k) => [k, line(HOME_DECK_WORDS[key][k])]));
  return { W, lang: SANDBOX_LOCALES[key].lang };
};
const fence = (lang) => ['---', `title: ${HOME_DECK_TITLE}`, `lang: ${lang}`, 'theme: dark', 'view: stack', '---', '', '## grid', ''];
/** a tile whose body is several lines (a heading, then text): tab-indented under its item, as a saved file carries it */
const tile = (head, lines) => [`- [ ] %% card: ${head} %%`, ...lines.map((l) => `\t${l}`)];
const back = (id, title, lines) => ['', `## back: ${id}${title ? ` | ${title}` : ''}`, '', ...tile('text', lines)];
const whatBack = (W) => back('what', W.whatTitle, [W.what1, W.what2, W.what3, W.whatBrand]);

// "The pasted clock": the tile is the thing it names — a few lines of HTML in an `embed` tile, which
// the renderer puts in a sandboxed frame like anybody's pasted HTML. Its one sentence is the tile's name.
const clockHtml = (caption) => '<style>html,body{height:100%;margin:0}body{display:grid;place-content:center;gap:.6em;text-align:center;'
  + 'font-family:system-ui,sans-serif;color:var(--cp-ink)}time{font:600 15vw/1 ui-monospace,monospace;font-variant-numeric:tabular-nums}'
  + 'p{margin:0;font-size:5vw;color:var(--cp-muted)}</style>'
  + `<time id="t"></time><p>${caption.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`
  + '<script>var t=document.getElementById("t");function k(){var d=new Date(),p=function(n){return String(n).padStart(2,"0")};'
  + 't.textContent=p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds())}k();setInterval(k,1000)</script>';

/**
 * The home deck, as a cardtile file in the page's one language. Its order is the ruled one: what it
 * is → why → try it → it does not hold you → free. The closing card is the deck's own (w3/deck.js,
 * `data-reef-home`), so it is not a line here.
 */
export function homeDeckSource(locale) {
  const { W, lang } = wordsOf(locale);
  return [
    ...fence(lang),
    '- [ ] %% card: profile w=6 back=#what %%',
    `- [ ] %% card: text w=6 back=#why %% # ${W.why}`,
    `- [ ] %% card: text w=6 back=#views %% # ${W.views}`,
    `- [ ] %% card: text w=6 back=#say %% # ${W.say}`,
    `- [ ] %% card: embed w=6 %% ${clockHtml(W.clock)}`,
    ...tile('text w=6 back=#file', [`# ${W.fileTitle}`, W.fileText]),
    `- [ ] %% card: text w=6 back=#domain %% # ${W.domainTitle}`,
    ...tile('text w=6 back=#free', [`# ${W.freeTitle}`, W.freeText]),
    ...whatBack(W),
    ...back('why', '', [W.whyBack1, W.whyBack2, W.whyBack3]),
    ...back('views', W.views, [W.viewsBack1, W.viewsBack2, W.viewsBack3]),
    ...back('say', W.say, [W.sayBack]),
    ...back('file', W.fileTitle, [W.fileBack]),
    ...back('domain', W.domainTitle, [W.domainBack]),
    ...back('free', W.freeBackTitle, [W.freeCap1, W.freeCap2, W.freeCap3]),
    ...tile('text', [W.freeSmall]),
    '',
  ].join('\n');
}

// Where the referrer goes in the rendered page. Letters only (an underscore is Markdown), so the
// renderer carries them through as text; homeDeckPage replaces them in the body only, in one pass.
const NAME_AT = 'CARDTILEREFNAMEAT';
const AVATAR_AT = 'CARDTILEREFAVATARAT';

/**
 * The referral deck — four tiles for a visitor who came from somebody's page. `tryUrl` is the sandbox
 * (the Worker's, by stage); a value that is not an https address draws the second tile without a link.
 */
export function referralDeckSource(locale, { tryUrl = '' } = {}) {
  const { W, lang } = wordsOf(locale);
  const at = W.refLine.includes('{name}') ? W.refLine.replace('{name}', `${AVATAR_AT}${NAME_AT}`) : `${AVATAR_AT}${NAME_AT} ${W.refLine}`;
  const sandbox = /^https:\/\/[a-z0-9.-]+\/[\w/.-]*$/.test(tryUrl) ? tryUrl : '';
  return [
    ...fence(lang),
    ...tile('text w=6 back=#what', [`# ${HOME_DECK_TITLE}`, at, W.refFree]),
    sandbox ? `- [ ] %% card: link w=6 back=#try %% [${W.refTry.replace(/[[\]]/g, '')}](${sandbox})`
      : `- [ ] %% card: text w=6 back=#try %% # ${W.refTry}`,
    `- [ ] %% card: text w=6 back=#say %% # ${W.refSay}`,
    `- [ ] %% card: text w=6 back=#others %% # ${W.refOthers}`,
    ...whatBack(W),
    ...back('try', '', [W.refTryBack]),
    ...back('say', '', [W.refSayBack]),
    ...back('others', '', [W.refOthersBack]),
    '',
  ].join('\n');
}

// ── the deck of the Cards host's own root ─────────────────────────────────────────────────────────
// withDeck (w3/deck-page.mjs) makes the deck every Cards page gets and knows nothing about the home.
// What only the home has is written onto its result, at the two places withDeck itself wrote:
//
//   <html data-view=… data-views=… data-reef-home>
//                                     the home deck: deck.js closes the pile with its own last card
//   <html data-view=… data-views=… data-reef-ref data-back-href="/<handle>">
//                                     the referral deck: no closing card, and the way back to the
//                                     page the visitor came from
//   <script>try{sessionStorage.setItem(REF_STORAGE_KEY,<handle>);}catch(e){}window.__cardFront=…
//                                     the ref the visitor arrived with, kept for the tab; before
//                                     deck.js, so a deck that fails still keeps it
//   window.__deckTry                  the sandbox where THIS stage serves it, in place of DECK_TRY_URL
//
// 🔴 `kind` and `ref` are CALLER-supplied and only homeDeckAnswer supplies them: no frontmatter key,
// query or header reaches here, so no guest's page can call itself ours. The ref is checked against
// the handle grammar HERE, at the sink, whatever the caller checked.
const OURS_KINDS = { home: 'data-reef-home', ref: 'data-reef-ref' };
// JSON that is safe inside an inline <script>: no `</script>`, no `<!--` (deck-page's own rule)
const scriptJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const ROOT_AT = /^<html data-view="[a-z]*" data-views="[a-z ]*"/;
const BOOT_AT = '<script>window.__cardFront=';

function deckOurs(flat, source, { kind = '', ref = '', tryUrl = '' } = {}) {
  const lang = (/^lang: (.+)$/m.exec(source) || [])[1] || '';
  const page = withDeck(flat, source, { lang });
  if (!Object.hasOwn(OURS_KINDS, kind)) return page;
  const r = page.indexOf('<html');
  const root = r < 0 ? null : ROOT_AT.exec(page.slice(r, r + 200));
  const t = page.lastIndexOf(BOOT_AT);
  if (!root || t < r) return page;   // withDeck made no deck of it (not the renderer's page): nothing of ours either
  const handle = HANDLE.test(String(ref ?? '')) ? String(ref) : '';
  const mine = ` ${OURS_KINDS[kind]}${kind === 'ref' && handle ? ` data-back-href="/${handle}"` : ''}`;
  const keep = handle ? `try{sessionStorage.setItem(${scriptJson(REF_STORAGE_KEY)},${scriptJson(handle)});}catch(e){}` : '';
  let tail = page.slice(t + '<script>'.length);
  if (tryUrl) {
    const was = `window.__deckTry=${scriptJson(DECK_TRY_URL)};`;
    const w = tail.lastIndexOf(was);
    if (w >= 0) tail = `${tail.slice(0, w)}window.__deckTry=${scriptJson(String(tryUrl))};${tail.slice(w + was.length)}`;
  }
  const end = r + root[0].length;
  return `${page.slice(0, end)}${mine}${page.slice(end, t)}<script>${keep}${tail}`;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** how much of a referrer's title the sentence carries (code points) */
export const REF_NAME_MAX = 80;
const shortName = (s) => {
  const cps = [...String(s == null ? '' : s).replace(/\s+/g, ' ').trim()];
  return cps.length <= REF_NAME_MAX ? cps.join('') : `${cps.slice(0, REF_NAME_MAX - 1).join('').trimEnd()}…`;
};

/**
 * homeDeckPage: the renderer's FLAT page (`deck: false`) of `source` → the page as served. Three
 * things the renderer does not do for a guest's page and the home needs:
 *
 *   the deck      deckOurs above: `kind` ('home' | 'ref'), `ref` and `tryUrl` (the sandbox of this
 *                 stage). With no `source` the page is taken as it is.
 *   the footer    `© <year> CVER Inc.  |  Powered by feelreef` — the home is the only page that says
 *                 it. Its link carries the referrer on (`?ref=<handle>`) when the visitor came with
 *                 one, because the sign-up page is on another origin and cannot read this origin's
 *                 sessionStorage; with none it says where the visitor came from: reef.cards.
 *   the referrer  { handle, name, avatar } — the name as TEXT (escaped here, never read as Markdown or
 *                 HTML: it is somebody's title) and, when they have one, their picture at their own
 *                 avatar address. Only in the body, and only where referralDeckSource left a mark.
 *
 * `ref` is the handle to carry on; `referrer.handle` the one drawn. Both are re-checked against the
 * handle grammar here: this is the last place before the bytes leave.
 */
export function homeDeckPage(flat, { source = '', kind = '', ref = '', referrer = null, tryUrl = '', year = new Date().getFullYear() } = {}) {
  const html = source ? deckOurs(flat, source, { kind, ref, tryUrl }) : flat;
  const carried = HANDLE.test(ref) ? ref : 'reef.cards';
  const footer = `<footer class="st-footer"><div><a href="/">&copy; ${Number(year)} CVER Inc.</a>&nbsp;&nbsp;|&nbsp;&nbsp;`
    + `<a href="https://feelreef.com/?ref=${carried}">Powered by feelreef</a></div></footer>`;
  const f = html.lastIndexOf('<footer class="st-footer">');
  const fe = f < 0 ? -1 : html.indexOf('</footer>', f);
  let page = fe < 0 ? html : html.slice(0, f) + footer + html.slice(fe + '</footer>'.length);
  const b = page.indexOf('<body');
  if (b < 0) return page;
  const who = referrer && HANDLE.test(referrer.handle) ? referrer : null;
  // The name may break ANYWHERE: a name that is one unbroken word — a 63-character handle whose file
  // has no title is enough — otherwise runs past the tile's edge and is cut there in every view, and
  // with scripts off the page scrolls sideways (seen in a browser, 390 and 1280 wide). The rule is on
  // the element, like the picture's size: no stylesheet rule reaches a text tile's sentence.
  const name = who ? `<span class="ref-name" style="overflow-wrap:anywhere">${esc(shortName(who.name) || who.handle)}</span>` : '';
  // 28 px beside the sentence: the size is on the element, since no stylesheet rule reaches a text tile's picture
  const avatar = who && who.avatar
    ? `<img class="ref-av" src="/${who.handle}/avatar" alt="" width="28" height="28" style="width:28px;height:28px;border-radius:50%;object-fit:cover;vertical-align:-8px;margin-right:8px">`
    : '';
  // one pass, so nothing a name holds is looked at again
  const body = page.slice(b).replace(new RegExp(`${AVATAR_AT}|${NAME_AT}`, 'g'), (m) => (m === NAME_AT ? name : avatar));
  page = page.slice(0, b) + body;
  return page;
}
