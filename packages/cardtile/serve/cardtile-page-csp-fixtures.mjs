// The files cardtile-page-csp.test.mjs and verify/page-csp.mjs ask the cardtile worker for: one page that
// holds every tile type of GRAMMAR.md, and the shapes around it. Nobody's page: every host is a
// reserved name (RFC 2606) or a platform the renderer knows by name.
// every tile type, and every frontmatter key that writes a style or a script
export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const EVERY_TILE = ['---', 'title: Every tile', 'accent: "#c0392b"', 'theme: dark', 'backdrop: https://pictures.example/back.jpg', 'since: 2020',
  'powered-by: on', 'arrows: on', 'icons: mono', 'back: "#about"', '---', '', '## grid', '',
  '- [ ] %% card: profile w=6 avatar=https://pictures.example/me.png back=#about %% A bio.',
  `- [ ] %% card: feature w=6 img=${PNG} href="#about" %% A feature with a picture of its own.`,
  '- [ ] %% card: feature w=3 img=http://pictures.example/plain.jpg href=https://example.org/f %% A feature over http.',
  '- [ ] %% card: text %% Text with a [link](https://example.org/x) in it.',
  '- [ ] %% card: social w=6 %% [Instagram](https://instagram.com/example) icon=instagram',
  '\t[Website](https://example.org/) iconhost=example.com',
  '\t[Mail](mailto:someone@example.org)',
  '- [ ] %% card: video w=6 yt=vLAegkGGWrM %% A video',
  '- [ ] %% card: link w=3 %% [Shop](https://example.org/shop)',
  '- [ ] %% card: link w=3 iconimg=https://pictures.example/art.png %% [Art](https://example.org/art)',
  '- [ ] %% card: slides w=6 kind=slider images="https://pictures.example/1.png,https://pictures.example/2.png" %%',
  '- [ ] %% card: slides w=6 kind=bubbles images="https://pictures.example/3.png,https://pictures.example/4.png" %% pop',
  '', '', '## back: about | About', '',
  '- [ ] %% card: text %% Back text.',
  '- [ ] %% card: link w=6 %% [In the back](https://example.org/back)', ''].join('\n');
export const PLAIN = '---\ntitle: Plain\n---\n\n## grid\n\n- [ ] %% card: profile w=6 %% Public bio\n';
export const WITH_EMBED = '---\ntitle: With an embed\n---\n\n## grid\n\n- [ ] %% card: text %% Before.\n- [ ] %% card: embed w=6 %% <b id="t">x</b><script>t.textContent = "ran"</script>\n';
// what a person can aim at the boot line: every key the deck reads, each trying to close the script
export const HOSTILE_FRONT = '---\ntitle: </script><script>alert(1)</script>\nviews: stack list </script><script>alert(2)</script>\nview: list";alert(3);//\nback: "</script><script>alert(4)//"\n---\n\n## grid\n\n- [ ] %% card: text %% </script><script>alert(5)</script> \';alert(6);//\n';
export const long = (n, extra = '') => `---\ntitle: Long\n---\n\n## grid\n\n${Array.from({ length: n }, (_, i) => `- [ ] %% card: text %% Tile ${i}.`).join('\n')}\n${extra}`;

// tile#372 r1 — files where the word "embed" appears and no embed tile does: a page served in windows whose
// title says it (the review's case, 5,001 text tiles), and one whose text, a link address and an older
// slider spelled `embed kind=slider` say it (5,005 tiles, the words at tile 4,000)
export const proseNamingEmbed = (n) => long(n).replace('title: Long', 'title: How to embed a video');
export const wordsNamingEmbed = (n) => long(n)
  .replace('%% card: text %% Tile 4000.', '%% card: text %% I embedded a photo')
  .replace('%% card: text %% Tile 4001.', '%% card: link w=6 %% [Listen](https://open.spotify.com/embed/track/abc)')
  .replace('%% card: text %% Tile 4002.', '%% card: embed kind=slider w=6 images="https://pictures.example/1.png,https://pictures.example/2.png" %%');
// an embed on a back
export const EMBED_ON_BACK = '---\ntitle: An embed on a back\n---\n\n## grid\n\n- [ ] %% card: text back=#more %% Turn me over.\n\n## back: more | More\n\n- [ ] %% card: embed w=6 %% <p id="b">back</p><script>b.textContent = "ran on the back"</script>\n';
// somebody else's embed (an address made from it must not be answered under another handle)
export const OTHER_EMBED = '---\ntitle: Somebody else\n---\n\n## grid\n\n- [ ] %% card: embed w=6 %% <p>somebody else</p><script>document.title = "theirs"</script>\n';
