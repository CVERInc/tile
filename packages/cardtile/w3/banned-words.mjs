// The owner's ruler #3 (2026-09-24): no engineering words on the editor surface, in any of the nine
// locales. Each entry is a RegExp tested against every string a catalogue can put on screen.
//
// NOT banned, by ruling: 牌 / "tile" / lane (the owner's own vocabulary), 抽屜 / drawer (a product
// word), and the bare view label "Markdown" (it names the file). What IS banned is a SENTENCE about
// markdown as a mode ("Markdown mode"), and every word below.
//
// 🔴 Word boundaries matter: en `raw` must not catch "drawer"; that is why it is \braw\b.
const COMMON = [
  /sandbox/i, /srcdoc/i, /iframe/i, /\bparams?\b/i, /render/i, /deploy/i, /publish/i,
  /practice mode/i, /markdown[\s-]*(mode|模式|モード|모드|modus)/i, /(mode|modo)\s+markdown/i,
];
export const BANNED = {
  en: [/\bpreview/i, /\bparameters?\b/i, /\braw\b/i],
  zh: [/沙盒/, /練習模式/, /預覽/, /參數/, /原始/, /渲染/, /部署/, /發[佈布]/],
  'zh-Hans': [/沙盒/, /练习模式/, /预览/, /参数/, /原始/, /渲染/, /部署/, /发布/],
  ja: [/サンドボックス/, /練習モード/, /プレビュー/, /パラメータ/, /生の/, /レンダ/, /デプロイ/],
  ko: [/샌드박스/, /연습 ?모드/, /미리 ?보기/, /매개변수/, /파라미터/, /원본/, /렌더/, /배포/, /게시/],
  de: [/übungsmodus/i, /vorschau/i, /parameter/i, /\broh/i, /veröffentlich/i],
  fr: [/bac à sable/i, /mode d.entraînement/i, /aperçu/i, /paramètre/i, /\bbrut/i, /déploy|déploi/i, /\bpubli(er|cation|é)/i],
  es: [/entorno de pruebas/i, /modo de práctica/i, /vista previa/i, /parámetro/i, /sin procesar|\bcrud[oa]s?\b/i, /renderiz/i, /despleg|desplieg/i, /\bpublica/i],
  pt: [/modo de prática/i, /pré-visualiza/i, /parâmetro/i, /\bbrut[oa]s?\b/i, /renderiz/i, /implant/i, /\bpublica/i],
};
for (const k of Object.keys(BANNED)) BANNED[k] = [...COMMON, ...BANNED[k]];

/** [{catalogue, key, locale, text, word}] for every hit. `tables` = {name: {locale: {key: string}}}. */
export function scanBanned(tables) {
  const hits = [];
  for (const [catalogue, byLocale] of Object.entries(tables)) {
    for (const [locale, table] of Object.entries(byLocale)) {
      const rules = BANNED[locale];
      if (!rules) throw new Error(`no banned list for locale ${locale}`);
      for (const [key, text] of Object.entries(table)) {
        if (typeof text !== 'string') continue;
        for (const re of rules) if (re.test(text)) hits.push({ catalogue, key, locale, text, word: String(re) });
      }
    }
  }
  return hits;
}
