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

