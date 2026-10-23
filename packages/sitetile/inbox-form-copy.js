// The `action=inbox` form's copy table (+ the default page language), ONE source.
//
// Lives at the top level of packages/sitetile so site-core.js can import it from its own directory
// (the reef vendor closure copies site-core's siblings); astro/src/packages/lingo/locale.mjs
// re-exports from here, so Form.astro and every existing importer keep their path. CVERInc/reef#1933.

/**
 * The language a page declares when its site does not say.
 *
 * 🩸 measured on a live site: `/` said zh-Hant and `/blog/`, every post and the 404 all
 * said en-US — one site, one build, two languages, because SiteLayout and PageView defaulted to
 * 'zh-Hant' while BlogIndexView, ArchiveView, PostView, search, preview and 404.astro defaulted to
 * 'en-US'. Nobody chose that; it is nine copies of a literal that drifted apart. A screen reader
 * switches voice halfway through the site and a search engine files the blog as English.
 *
 * It surfaced as "the 404 page is in English", which is the one page a visitor happens to notice —
 * and reads like a translation gap. It is not: Lingo renders that page perfectly. It
 * was a fallback disagreeing with a fallback.
 *
 * So: ONE default, named, imported. Aligned to the shell's value, which already governs the home
 * page, so no site changes what it says on the page people actually land on.
 */
export const DEFAULT_LANG = 'zh-Hant';

/**
 * Copy for the `form` coral's `action=inbox` path — required-field validation and the
 * "what happens next" success line (2026-09-03 cold-read findings #9/#10), plus the post-submit
 * feedback states (submitting / success card / inline retry error — owner ruling 2026-09-03,
 * "the standard pattern"): a same-size paragraph under a form that STAYS is too weak a signal,
 * measured as visitors resubmitting because nothing told them it had already worked.
 *
 * Deliberately its OWN small table, not folded into `LINGO_UI`/`_canon`: those recognise exactly
 * Lingo's four SITE locales (en-US/ja-JP/zh-TW/ko-KR — zh-Hant, never a genuine Simplified
 * variant), because every other consumer of them — the locale picker, hreflang, the suggestion
 * banner — enumerates that fixed set. This is a DIFFERENT question ("what script is the page's
 * own `lang` written in"), asked of the site's raw `lang:` frontmatter rather than a Lingo data
 * code, and it distinguishes Simplified (zh-Hans/zh-CN) from Traditional — which finding #15's
 * `square-shop` fix needs too. Widening `_canon` itself to a 5th locale would be a bigger, riskier
 * change than either fix calls for.
 *
 * `errorNetwork` vs `errorServer`: the AJAX enhancement in Form.astro can tell "the fetch itself
 * never completed" (offline, DNS, timeout — a `fetch()` rejection) from "the request reached the
 * forwarder and it said no" (any non-`sent` `?inbox=` outcome) — two different things a visitor
 * can act on differently (check your connection vs. just try again), so two different sentences.
 *
 * `errorNotClaimed` (reef#2204): the forwarder's `not_claimed` outcome — the OWNER never pressed
 * "claim Inbox", so every submit to this site fails until they do. Not transient, and nothing the
 * visitor can fix, so this sentence states the fact and asks for nothing: no "try again" in any
 * locale (the copy test enforces it). Explanation-class copy, no promise. Measured 2026-10-19 on
 * tniop.tw: the generic retry sentence sent an agent hunting a platform bug for a whole session.
 *
 * `errorInboxStorageFull` (reef#2357): the inbox cannot store new messages. State only,
 * with no retry instruction or promise of when capacity will return.
 *
 * `sentWithEmail` vs `sentWithEmailGeneric`: build time cannot know what a visitor will TYPE, only
 * whether the `{email}` field is guaranteed filled (`required`) — so the server-rendered fallback
 * (what a no-JS visitor sees after the real POST/303 round trip) uses the generic phrasing. The
 * AJAX enhancement captures the actual typed address from `FormData` at submit time and has
 * something build time never could, so it fills `sentWithEmail`'s `{email}` placeholder with it —
 * literally what the owner asked for ("確認信已寄到 <email>"). `{email}` is a literal token this
 * table defines and Form.astro's inline script substitutes; it is not printf/template-string syntax.
 *
 * `sendAnother` (2026-09-04, a customer's production report): the success card's own escape hatch —
 * without it, a reload / back button / shared URL kept showing 「送信しました」 with the form gone
 * and nothing on the card to press. It labels a plain `<a>` back to the form's own clean path
 * (works with zero JS); the AJAX enhancement intercepts the same click to reset and re-show the
 * form in place instead of navigating.
 */
const INBOX_FORM_LOCALE = {
  ja: {
    fieldRequired: 'この項目は必須です。',
    sentWithEmail: '確認メールを {email} にお送りしました。店主からの返信も同じメールアドレスに届きます。',
    sentWithEmailGeneric: '確認メールをお送りしました。店主からの返信も同じメールアドレスに届きます。',
    sentNoEmail: '店主が確認次第対応します。返信をご希望の場合はメールアドレスをご記入ください。',
    submitting: '送信中…',
    successHeading: '送信しました',
    backHome: 'ホームに戻る',
    errorNetwork: 'ネット接続が不安定なようです。確認してもう一度お試しください。',
    errorServer: '送信できませんでした。もう一度お試しください。',
    errorNotClaimed: 'このサイトは現在メッセージを受け付けていません。',
    errorInboxStorageFull: 'このサイトの受信箱はいっぱいで、現在新しいメッセージを受け取れません。',
    sendAnother: 'もう一度送る',
  },
  'zh-tw': {
    fieldRequired: '這是必填欄位。',
    sentWithEmail: '確認信已寄到 {email}；店家的回覆也會寄到同一個信箱。',
    sentWithEmailGeneric: '確認信已寄到您的信箱；店家的回覆也會寄到同一個信箱。',
    sentNoEmail: '店家會盡快處理；如需回信請留 email。',
    submitting: '送出中…',
    successHeading: '已送出',
    backHome: '回首頁',
    errorNetwork: '網路連線好像不穩，請檢查後再試一次。',
    errorServer: '暫時無法送出，請再試一次。',
    errorNotClaimed: '這個網站目前沒有開放留言。',
    errorInboxStorageFull: '這個網站的收件匣已滿，目前無法接收新訊息。',
    sendAnother: '再送一則',
  },
  'zh-cn': {
    fieldRequired: '这是必填字段。',
    sentWithEmail: '确认信已发送到 {email}；店家的回复也会发送到同一个邮箱。',
    sentWithEmailGeneric: '确认信已发送到您的邮箱；店家的回复也会发送到同一个邮箱。',
    sentNoEmail: '店家会尽快处理；如需回复请留 email。',
    submitting: '发送中…',
    successHeading: '已发送',
    backHome: '返回首页',
    errorNetwork: '网络连接好像不稳定，请检查后再试一次。',
    errorServer: '暂时无法发送，请再试一次。',
    errorNotClaimed: '这个网站目前没有开放留言。',
    errorInboxStorageFull: '这个网站的收件箱已满，目前无法接收新消息。',
    sendAnother: '再发一条',
  },
  ko: {
    fieldRequired: '필수 입력 항목입니다.',
    sentWithEmail: '확인 메일을 {email}(으)로 보냈습니다. 담당자의 답변도 같은 메일 주소로 전달됩니다.',
    sentWithEmailGeneric: '확인 메일을 보냈습니다. 담당자의 답변도 같은 메일 주소로 전달됩니다.',
    sentNoEmail: '담당자가 곧 확인합니다. 답변을 받고 싶다면 이메일을 남겨 주세요.',
    submitting: '전송 중…',
    successHeading: '전송 완료',
    backHome: '홈으로 돌아가기',
    errorNetwork: '네트워크 연결이 불안정한 것 같습니다. 확인 후 다시 시도해 주세요.',
    errorServer: '전송하지 못했습니다. 다시 시도해 주세요.',
    errorNotClaimed: '이 사이트는 현재 메시지를 받지 않고 있습니다.',
    errorInboxStorageFull: '이 사이트의 받은편지함이 가득 차서 현재 새 메시지를 받을 수 없습니다.',
    sendAnother: '다시 보내기',
  },
  en: {
    fieldRequired: 'This field is required.',
    sentWithEmail: "We've sent a confirmation to {email} — the owner's reply will go to the same address.",
    sentWithEmailGeneric: "We've sent a confirmation to your email — the owner's reply will go to the same address.",
    sentNoEmail: "The owner will get to this soon. Leave an email if you'd like a reply.",
    submitting: 'Sending…',
    successHeading: 'Sent',
    backHome: 'Back to homepage',
    errorNetwork: 'Your connection seems to be having trouble — check it and try again.',
    errorServer: "Couldn't send that — please try again.",
    errorNotClaimed: "This site isn't taking messages right now.",
    errorInboxStorageFull: "This site's inbox is full and can't take new messages right now.",
    sendAnother: 'Send another',
  },
};
/** A site's raw `lang:` (BCP-47-ish, whatever an author wrote) → one of the table's keys. */
function inboxFormLocaleKey(lang) {
  const tag = String(lang || '').toLowerCase();
  const primary = tag.split('-')[0];
  if (primary === 'ja') return 'ja';
  if (primary === 'ko') return 'ko';
  if (primary === 'zh') return /hans|-cn\b|-sg\b/.test(tag) ? 'zh-cn' : 'zh-tw';
  return 'en';
}
export function inboxFormCopy(lang) {
  return INBOX_FORM_LOCALE[inboxFormLocaleKey(lang)];
}
