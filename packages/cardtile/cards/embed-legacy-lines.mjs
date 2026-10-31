// The legacy `embed` lines whose rendering must not change across reef#2725 — shared by the golden's
// generator and embed-html.test.mjs, so both are about the same inputs.
//
// The carousels any card ever showed, AND the boundary: every way a `kind` token can be written
// (empty, quoted-empty, valueless, `-kind`, a space before `=`, an unknown kind, a `kind=` lookalike
// inside a quoted value). A line here that the old renderer drew as nothing must still draw nothing.
export const LEGACY_EMBED_LINES = [
  '%% card: embed w=6 kind=slider images="https://i.example/1.png,https://i.example/2.png,https://i.example/3.png" %%',
  '%% card: embed w=6 kind=slider images="https://i.example/1.png" %%',
  '%% card: embed bleed kind=bubbles images="https://i.example/1.png,https://i.example/2.png" origin="10% 20%" narrow="30% 40%" bg=https://i.example/bg.png %%',
  '%% card: embed kind=bubbles images=https://i.example/1.png origin-narrow="1% 2%" %%',
  '%% card: embed kind=slider images="https://example.com/a.png" note="keep kind=slider" %%',
  '%% card: embed -kind=slider images="https://example.com/a.png" %%',
  // drew NOTHING before — and must still draw nothing (an explicit empty kind is not "unset")
  '%% card: embed kind="" images="https://example.com/a.png" %%',
  '%% card: embed kind= images="https://example.com/a.png" %% <b>legacy body</b>',
  '%% card: embed kind =slider images="https://example.com/a.png" %% <b>legacy body</b>',
  '%% card: embed kind=video channel=UCabc w=6 %% Latest',
  '%% card: embed kind=slider %%',
];

export const legacyCard = (line) => ['---', 'title: T', '---', '', '## grid', '', `- [ ] ${line}`, ''].join('\n');

/**
 * the card's cells — what sits inside `.st-card` after the renderer's own stylesheet, up to `</main>`.
 * Not the page: its footer carries the year (red every January) and its shared stylesheet changes for
 * reasons that have nothing to do with an embed.
 */
export function gridOf(html) {
  const card = html.indexOf('<div class="st-card">');
  if (card < 0) throw new Error('no .st-card in the page — the layout moved');
  const css = html.indexOf('</style>', card);
  const end = html.indexOf('</main>', css);
  if (css < 0 || end < 0) throw new Error('the card has no leading stylesheet or no </main> — the layout moved');
  return html.slice(css + '</style>'.length, end);
}
