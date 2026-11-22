// stageSite and links — nothing a site ships is followed, or copied as a link, at any step.
//
// A site's posts, books and media arrive as directories somebody else wrote: an export, a clone, an
// unpacked archive. A symbolic link in one of them used to be copied into the renderer as it was,
// and from there `astro build` reads through it — so `posts/leak.md -> ~/.npmrc` was a way to have
// the build machine's own files published under the site's address. These tests hold the rule that
// replaced that: a link is refused by name, wherever it points, and the copy itself never follows
// one — including one put there after the copy had already looked.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The namespace, not names: `copySiteTree` and `LINK_REFUSED` are what this file is here to hold,
// and a named import of something absent fails the whole file at load instead of one test each.
import * as stage from './stage.mjs';
import { buildSite, RENDERER_SUBPATH } from './index.mjs';

const { stageSite, listStaged, STASH_PREFIX, LOCK_NAME } = stage;

const SECRET = 'SECRET: this file is outside the site and must never be staged\n';
const PAGES = [{ path: 'home', markdown: '---\nsitetile-page: home\n---\nhello\n' }];
const THEMED = [{ path: '_site', markdown: '---\ntheme: kite\n---\n' }, ...PAGES];

const DEMO = {
  'content/demo.md': 'the renderer\'s own example page\n',
  'blog/a-demo-post.md': 'the renderer\'s own post\n',
  'pagetile/a-demo.book.md': 'the renderer\'s own book\n',
  'public/_redirects': '/feed /rss.xml 301\n',
  'public/img/mark.svg': '<svg/>\n',
  'src/themes/README.md': 'site themes are staged in and removed\n',
};

function makeRenderer(t, root) {
  const dir = root ?? mkdtempSync(join(tmpdir(), 'tile-build-renderer-'));
  if (!root) t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{ "name": "@tile/sitetile-astro-stub", "type": "module" }\n');
  for (const [rel, body] of Object.entries(DEMO)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

// A site directory with something real in it, and beside it the thing a link must never reach.
function makeBox(t) {
  const box = mkdtempSync(join(tmpdir(), 'tile-build-links-'));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const site = join(box, 'site');
  const outside = join(box, 'outside');
  mkdirSync(join(site, 'sub'), { recursive: true });
  mkdirSync(join(outside, 'dir'), { recursive: true });
  writeFileSync(join(site, 'real.md'), 'a real file of this site\n');
  writeFileSync(join(site, 'sub/inner.md'), 'a real nested file of this site\n');
  writeFileSync(join(outside, 'secret.txt'), SECRET);
  writeFileSync(join(outside, 'dir/inner.md'), SECRET);
  return { box, site, outside };
}

// Every entry under `dir`, WITHOUT following anything: [relative path, kind, body or link target].
function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = base ? `${base}/${name}` : name;
    const st = lstatSync(join(dir, name));
    if (st.isSymbolicLink()) out.push([rel, 'link']);
    else if (st.isDirectory()) out.push([rel, 'dir'], ...walk(join(dir, name), rel));
    else out.push([rel, 'file', readFileSync(join(dir, name), 'utf8')]);
  }
  return out;
}
const noStashLeft = (dir) => assert.deepEqual(
  readdirSync(dir).filter((n) => n.startsWith(STASH_PREFIX) || n === LOCK_NAME), [],
  'a stash or a lock survived — the renderer is not back to how it was found',
);
const nothingLeaked = (dir, why) => {
  for (const [rel, kind, body] of walk(dir)) {
    assert.notEqual(kind, 'link', `${why}: ${rel} is a link inside the staged tree`);
    if (kind === 'file') assert.equal(body.includes('SECRET'), false, `${why}: ${rel} holds the outside file`);
  }
};

// The three ways a site's own directory enters the renderer, and where each one lands.
const INLETS = [['blogDir', 'blog'], ['pagetileDir', 'pagetile'], ['assetsDir', 'public']];

// Stage `site` through every inlet in turn and require the same refusal each time: the link named,
// the renderer exactly as it was found, and nothing from outside anywhere in it.
async function refusedEverywhere(t, plant, named, { pattern = /symbolic link/ } = {}) {
  for (const [inlet, lands] of INLETS) {
    const astroDir = makeRenderer(t);
    const { site, outside, box } = makeBox(t);
    plant({ site, outside, box });
    const before = walk(astroDir);
    await assert.rejects(
      stageSite({ astroDir, pages: PAGES, [inlet]: site }),
      (err) => {
        assert.match(err.message, pattern, `${inlet}: ${err.message}`);
        assert.ok(err.message.includes(join(site, named)), `${inlet}: the refusal does not name ${named} — ${err.message}`);
        return true;
      },
      `${inlet}: a link under ${lands}/ was staged without complaint`,
    );
    assert.deepEqual(walk(astroDir), before, `${inlet}: the renderer is not how it was found`);
    noStashLeft(astroDir);
    nothingLeaked(astroDir, inlet);
  }
}

// ── the links a site can ship, one case each ────────────────────────────────────────────────────
test('a file link that leaves the site is refused by name, through every inlet', async (t) => {
  await refusedEverywhere(t, ({ site }) => symlinkSync('../outside/secret.txt', join(site, 'leak.md')), 'leak.md');
});

test('…and so is one spelled as an absolute path, or sitting in a nested directory', async (t) => {
  await refusedEverywhere(t, ({ site, outside }) => symlinkSync(join(outside, 'secret.txt'), join(site, 'leak.md')), 'leak.md');
  await refusedEverywhere(t, ({ site }) => symlinkSync('../../outside/secret.txt', join(site, 'sub/leak.md')), 'sub/leak.md');
});

test('a directory link that leaves the site is refused by name', async (t) => {
  await refusedEverywhere(t, ({ site }) => symlinkSync('../outside/dir', join(site, 'etcdir')), 'etcdir');
});

test('a chain of links is refused at its first link, wherever the chain ends', async (t) => {
  // inside the site all the way to the last hop, which is the one that leaves
  await refusedEverywhere(t, ({ site }) => {
    symlinkSync('b-hop.md', join(site, 'a-hop.md'));
    symlinkSync('../outside/secret.txt', join(site, 'b-hop.md'));
  }, 'a-hop.md');
  // out of the site at the first hop, through a link that is not the site's at all
  await refusedEverywhere(t, ({ site, outside }) => {
    symlinkSync('secret.txt', join(outside, 'hop'));
    symlinkSync('../outside/hop', join(site, 'chain.md'));
  }, 'chain.md');
});

test('a dangling link is refused, not skipped', async (t) => {
  await refusedEverywhere(t, ({ site }) => symlinkSync('nowhere/at-all.md', join(site, 'gone.md')), 'gone.md');
});

test('a link that stays inside the site is refused too — where it points is never asked', async (t) => {
  await refusedEverywhere(t, ({ site }) => symlinkSync('real.md', join(site, 'alias.md')), 'alias.md');
  await refusedEverywhere(t, ({ site }) => symlinkSync('sub', join(site, 'alias-dir')), 'alias-dir');
  // …which is also why a link to its own directory cannot send the copy round in circles
  await refusedEverywhere(t, ({ site }) => symlinkSync('.', join(site, 'loop')), 'loop');
});

test('the directory that was named is itself held to the rule; the way to it is the caller\'s', async (t) => {
  // <box>/linked -> site : the last step of what was named is a link, so it is refused
  for (const [inlet] of INLETS) {
    const astroDir = makeRenderer(t);
    const { box, site } = makeBox(t);
    symlinkSync('site', join(box, 'linked'));
    symlinkSync('nowhere', join(box, 'dangling'));
    const before = walk(astroDir);
    for (const name of ['linked', 'dangling']) {
      await assert.rejects(stageSite({ astroDir, pages: PAGES, [inlet]: join(box, name) }), (err) => {
        assert.match(err.message, /symbolic link/, `${inlet}: ${err.message}`);
        assert.ok(err.message.includes(join(box, name)), err.message);
        assert.equal(err.code, stage.LINK_REFUSED);
        return true;
      });
      assert.deepEqual(walk(astroDir), before);
      noStashLeft(astroDir);
    }
    // <box>/via -> . : a link ABOVE the named directory is how the caller chose to get there
    // (a mount point, a temp directory that is itself a link) and is resolved, once.
    symlinkSync('.', join(box, 'via'));
    const { restore } = await stageSite({ astroDir, pages: PAGES, [inlet]: join(box, 'via', 'site') });
    const landed = join(astroDir, INLETS.find(([i]) => i === inlet)[1]);
    assert.equal(readFileSync(join(landed, 'sub/inner.md'), 'utf8'), 'a real nested file of this site\n');
    assert.equal(readFileSync(join(site, 'real.md'), 'utf8'), readFileSync(join(landed, 'real.md'), 'utf8'));
    await restore();
    assert.deepEqual(walk(astroDir), before);
  }
});

test('the refusal carries a code, so a program need not parse the sentence', async (t) => {
  const astroDir = makeRenderer(t);
  const { site } = makeBox(t);
  symlinkSync('../outside/secret.txt', join(site, 'leak.md'));
  assert.equal(typeof stage.LINK_REFUSED, 'string');
  await assert.rejects(stageSite({ astroDir, pages: PAGES, blogDir: site }), { code: stage.LINK_REFUSED });
});

test('a theme file that is a link is refused, and nothing is left in the renderer\'s themes', async (t) => {
  const astroDir = makeRenderer(t);
  const { box } = makeBox(t);
  symlinkSync('outside/secret.txt', join(box, 'theme.css'));
  const before = walk(astroDir);
  await assert.rejects(stageSite({ astroDir, pages: THEMED, themeFile: join(box, 'theme.css') }), (err) => {
    assert.match(err.message, /symbolic link/);
    assert.ok(err.message.includes(join(box, 'theme.css')), err.message);
    return true;
  });
  assert.deepEqual(walk(astroDir), before);
  noStashLeft(astroDir);
});

test('a FIFO in a site directory is refused at once instead of being read for ever', { skip: process.platform === 'win32' }, async (t) => {
  const astroDir = makeRenderer(t);
  const { site } = makeBox(t);
  execFileSync('mkfifo', [join(site, 'pipe.md')]);
  const before = walk(astroDir);
  await assert.rejects(stageSite({ astroDir, pages: PAGES, assetsDir: site }), (err) => {
    assert.match(err.message, /neither a file nor a directory/);
    assert.ok(err.message.includes(join(site, 'pipe.md')), err.message);
    return true;
  });
  assert.deepEqual(walk(astroDir), before);
});

// ── what did NOT change: a tree without links is staged as it always was ────────────────────────
test('a tree with no links is copied exactly as the plain recursive copy did it', async (t) => {
  const { box, site } = makeBox(t);
  mkdirSync(join(site, 'empty/also-empty'), { recursive: true });
  mkdirSync(join(site, 'zh-tw/圖片'), { recursive: true });
  writeFileSync(join(site, '.well-known'), 'a dotfile\n');
  writeFileSync(join(site, 'zh-tw/圖片/風箏.svg'), '<svg id="風箏"/>\n');
  writeFileSync(join(site, 'nothing.txt'), '');
  writeFileSync(join(site, 'run.sh'), '#!/bin/sh\n');
  chmodSync(join(site, 'run.sh'), 0o755);
  writeFileSync(join(site, 'private.txt'), 'x\n');
  chmodSync(join(site, 'private.txt'), 0o600);
  // larger than any one read, and not text
  const big = Buffer.alloc(3 * 1024 * 1024 + 17);
  for (let i = 0; i < big.length; i += 1) big[i] = (i * 31 + (i >> 8)) & 0xff;
  writeFileSync(join(site, 'sub/big.bin'), big);

  const shape = (dir, base = '') => readdirSync(dir).sort().flatMap((name) => {
    const rel = base ? `${base}/${name}` : name;
    const st = statSync(join(dir, name));
    return st.isDirectory()
      ? [[rel, 'dir', st.mode & 0o777], ...shape(join(dir, name), rel)]
      : [[rel, 'file', st.mode & 0o777, readFileSync(join(dir, name)).toString('base64')]];
  });

  for (const anchor of [true, false]) {
    const [mine, theirs] = [join(box, `mine-${anchor}`), join(box, `theirs-${anchor}`)];
    // onto a destination that already holds something: one file to be replaced, one to be left
    for (const d of [mine, theirs]) {
      mkdirSync(join(d, 'sub'), { recursive: true });
      writeFileSync(join(d, 'real.md'), 'what was here before\n');
      writeFileSync(join(d, 'sub/kept.md'), 'not named by the site, so it stays\n');
    }
    await stage.copySiteTree(site, mine, { what: 'assets dir', anchor });
    await cp(site, theirs, { recursive: true, force: true });
    assert.deepEqual(shape(mine), shape(theirs), `anchor=${anchor}`);
    assert.equal(readFileSync(join(mine, 'real.md'), 'utf8'), 'a real file of this site\n');
  }
});

test('the overlay replaces a link the renderer ships in public/ rather than writing through it', async (t) => {
  const astroDir = makeRenderer(t);
  const { site } = makeBox(t);
  // the renderer's OWN link, to one of its own files
  symlinkSync('../src/themes/README.md', join(astroDir, 'public/real.md'));
  const before = walk(astroDir);
  const { restore } = await stageSite({ astroDir, pages: PAGES, assetsDir: site });
  assert.equal(lstatSync(join(astroDir, 'public/real.md')).isSymbolicLink(), false);
  assert.equal(readFileSync(join(astroDir, 'public/real.md'), 'utf8'), 'a real file of this site\n');
  assert.equal(readFileSync(join(astroDir, 'src/themes/README.md'), 'utf8'), DEMO['src/themes/README.md'],
    'the site\'s file was written THROUGH the renderer\'s link, into a file outside public/');
  await restore();
  assert.deepEqual(walk(astroDir), before, 'the renderer\'s own link did not come back');
});

// The same, for both ways the copy has of writing a file (see MODES below), and for a directory.
for (const anchor of process.platform === 'linux' ? [true, false] : [false]) {
  test(`a link already at the destination is replaced or refused, never written through (${anchor ? 'anchored' : 'by path'})`, async (t) => {
    const { box, site } = makeBox(t);
    const dest = join(box, 'dest');
    mkdirSync(dest);
    writeFileSync(join(box, 'elsewhere.txt'), 'not the site\'s to write\n');
    symlinkSync('../elsewhere.txt', join(dest, 'real.md'));
    await stage.copySiteTree(site, dest, { what: 'assets dir', anchor });
    assert.equal(lstatSync(join(dest, 'real.md')).isSymbolicLink(), false);
    assert.equal(readFileSync(join(dest, 'real.md'), 'utf8'), 'a real file of this site\n');
    assert.equal(readFileSync(join(box, 'elsewhere.txt'), 'utf8'), 'not the site\'s to write\n');

    // a link where one of the site's DIRECTORIES goes is not descended through
    const dest2 = join(box, 'dest2');
    mkdirSync(join(box, 'elsewhere-dir'));
    mkdirSync(dest2);
    symlinkSync('../elsewhere-dir', join(dest2, 'sub'));
    await assert.rejects(stage.copySiteTree(site, dest2, { what: 'assets dir', anchor }), { code: 'EEXIST' });
    assert.deepEqual(readdirSync(join(box, 'elsewhere-dir')), [], 'a file was written through the destination link');
  });
}

// ── a link put there AFTER the copy looked ──────────────────────────────────────────────────────
// `beforeOpen` is called once an entry has been looked at and found to be a plain file or directory,
// and before it is opened — the one instant in which swapping it for a link could matter. Both ways
// of holding a directory are driven: anchored to the open directory itself (Linux), and by path
// with the directory's identity re-checked (everywhere else).
const MODES = process.platform === 'linux' ? [true, false] : [false];
const modeName = (anchor) => (anchor ? 'anchored' : 'by path');

for (const anchor of MODES) {
  test(`a file swapped for a link after it was checked is not followed (${modeName(anchor)})`, async (t) => {
    const { box, site, outside } = makeBox(t);
    const dest = join(box, 'dest');
    let swapped = 0;
    await assert.rejects(stage.copySiteTree(site, dest, {
      what: 'blog dir',
      anchor,
      beforeOpen: (p) => {
        if (p !== join(site, 'real.md')) return;
        rmSync(join(site, 'real.md'));
        symlinkSync(join(outside, 'secret.txt'), join(site, 'real.md'));
        swapped += 1;
      },
    }), (err) => {
      assert.match(err.message, /symbolic link/);
      assert.ok(err.message.includes(join(site, 'real.md')), err.message);
      assert.equal(err.code, stage.LINK_REFUSED);
      return true;
    });
    assert.equal(swapped, 1, 'the swap never happened, so this proved nothing');
    assert.equal(existsSync(join(dest, 'real.md')), false, 'something was written for the swapped file');
    nothingLeaked(dest, 'file swap');
  });

  test(`a directory swapped for a link after it was checked is not entered (${modeName(anchor)})`, async (t) => {
    const { box, site, outside } = makeBox(t);
    const dest = join(box, 'dest');
    let swapped = 0;
    await assert.rejects(stage.copySiteTree(site, dest, {
      what: 'assets dir',
      anchor,
      beforeOpen: (p) => {
        if (p !== join(site, 'sub')) return;
        renameSync(join(site, 'sub'), join(box, 'sub-moved-away'));
        symlinkSync(join(outside, 'dir'), join(site, 'sub'));
        swapped += 1;
      },
    }), (err) => {
      assert.match(err.message, /symbolic link/);
      assert.ok(err.message.includes(join(site, 'sub')), err.message);
      return true;
    });
    assert.equal(swapped, 1, 'the swap never happened, so this proved nothing');
    nothingLeaked(dest, 'directory swap');
    assert.equal(existsSync(join(dest, 'sub/inner.md')), false);
  });

  // The hard one: the entry being opened is untouched, and a directory ABOVE it becomes a link to a
  // tree that has a file of the same name. A no-follow open only guards the last step of a path.
  test(`a parent directory swapped for a link mid-copy does not redirect what is read (${modeName(anchor)})`, async (t) => {
    const { box, site, outside } = makeBox(t);
    const dest = join(box, 'dest');
    let swapped = 0;
    const run = stage.copySiteTree(site, dest, {
      what: 'assets dir',
      anchor,
      beforeOpen: (p) => {
        if (p !== join(site, 'sub/inner.md')) return;
        renameSync(join(site, 'sub'), join(box, 'sub-moved-away'));
        symlinkSync(join(outside, 'dir'), join(site, 'sub'));   // outside/dir/inner.md is the secret
        swapped += 1;
      },
    });
    if (anchor) {
      // held by the open directory: the copy reads the file it looked at, whatever the path says now
      await run;
      assert.equal(readFileSync(join(dest, 'sub/inner.md'), 'utf8'), 'a real nested file of this site\n');
    } else {
      // held by path: the directory is no longer the one that was entered, so the copy stops
      await assert.rejects(run, (err) => {
        assert.match(err.message, /symbolic link|changed while/);
        assert.ok(err.message.includes(join(site, 'sub')), err.message);
        return true;
      });
      assert.equal(existsSync(join(dest, 'sub/inner.md')), false, 'the redirected file was written');
    }
    assert.equal(swapped, 1, 'the swap never happened, so this proved nothing');
    nothingLeaked(dest, 'parent swap');
  });

  // …and one level further up, where the directory being read from is reached THROUGH the link and
  // is itself an ordinary directory — just not the one that was entered. Only its identity says so.
  test(`a grandparent swapped for a link mid-copy does not redirect what is read (${modeName(anchor)})`, async (t) => {
    const { box, site, outside } = makeBox(t);
    mkdirSync(join(site, 'sub/deep'));
    writeFileSync(join(site, 'sub/deep/x.md'), 'the nested file this site really has\n');
    mkdirSync(join(outside, 'tree/deep'), { recursive: true });
    writeFileSync(join(outside, 'tree/deep/x.md'), SECRET);
    const dest = join(box, 'dest');
    let swapped = 0;
    const run = stage.copySiteTree(site, dest, {
      what: 'assets dir',
      anchor,
      beforeOpen: (p) => {
        if (p !== join(site, 'sub/deep/x.md')) return;
        renameSync(join(site, 'sub'), join(box, 'sub-moved-away'));
        symlinkSync(join(outside, 'tree'), join(site, 'sub'));
        swapped += 1;
      },
    });
    if (anchor) {
      await run;
      assert.equal(readFileSync(join(dest, 'sub/deep/x.md'), 'utf8'), 'the nested file this site really has\n');
    } else {
      await assert.rejects(run, (err) => {
        assert.match(err.message, /changed while/);
        assert.ok(err.message.includes(join(site, 'sub/deep')), err.message);
        return true;
      });
      assert.equal(existsSync(join(dest, 'sub/deep/x.md')), false, 'the redirected file was written');
    }
    assert.equal(swapped, 1, 'the swap never happened, so this proved nothing');
    nothingLeaked(dest, 'grandparent swap');
  });

  test(`a directory swapped for a file after it was checked is not read as one (${modeName(anchor)})`, async (t) => {
    const { box, site } = makeBox(t);
    const dest = join(box, 'dest');
    await assert.rejects(stage.copySiteTree(site, dest, {
      what: 'assets dir',
      anchor,
      beforeOpen: (p) => {
        if (p !== join(site, 'sub')) return;
        rmSync(join(site, 'sub'), { recursive: true });
        writeFileSync(join(site, 'sub'), 'a file now\n');
      },
    }), (err) => {
      assert.match(err.message, /changed while/, err.message);
      assert.ok(err.message.includes(join(site, 'sub')), err.message);
      return true;
    });
  });

  test(`a file swapped for a FIFO or a directory after it was checked is not copied (${modeName(anchor)})`, { skip: process.platform === 'win32' }, async (t) => {
    for (const into of ['fifo', 'dir']) {
      const { box, site } = makeBox(t);
      const dest = join(box, 'dest');
      await assert.rejects(stage.copySiteTree(site, dest, {
        what: 'assets dir',
        anchor,
        beforeOpen: (p) => {
          if (p !== join(site, 'real.md')) return;
          rmSync(join(site, 'real.md'));
          if (into === 'fifo') execFileSync('mkfifo', [join(site, 'real.md')]);
          else mkdirSync(join(site, 'real.md'));
        },
      }), (err) => {
        assert.match(err.message, /changed while/, `${into}: ${err.message}`);
        assert.ok(err.message.includes(join(site, 'real.md')), err.message);
        return true;
      });
      assert.equal(existsSync(join(dest, 'real.md')), false, `${into}: something was written`);
    }
  });
}

// ── buildSite's own inlet: <ir-dir>/posts is taken as the blog without being named by anybody ───
// A stub engine: buildSite only asks that the renderer has a package.json and a node_modules, and
// every case here must be refused before `astro build` would have been started.
function makeEngine(t) {
  const engine = mkdtempSync(join(tmpdir(), 'tile-build-engine-'));
  t.after(() => rmSync(engine, { recursive: true, force: true }));
  const astroDir = makeRenderer(t, join(engine, RENDERER_SUBPATH));
  mkdirSync(join(astroDir, 'node_modules'));
  return { engine, astroDir };
}

test('buildSite refuses an <ir-dir>/posts that is a link, whether or not it leads anywhere', async (t) => {
  for (const target of ['../outside/dir', 'nowhere']) {
    const { engine, astroDir } = makeEngine(t);
    const { box, site } = makeBox(t);
    writeFileSync(join(site, 'home.md'), PAGES[0].markdown);
    symlinkSync(target, join(site, 'posts'));
    const before = walk(astroDir);
    await assert.rejects(buildSite({
      irDir: site, engineDir: engine, outDir: join(box, 'out'), npxBin: join(box, 'no-such-runner'),
    }), (err) => {
      assert.match(err.message, /symbolic link/, `posts -> ${target}: ${err.message}`);
      assert.ok(err.message.includes(join(site, 'posts')), err.message);
      return true;
    }, `posts -> ${target} was not refused`);
    assert.deepEqual(walk(astroDir), before);
    noStashLeft(astroDir);
  }
});

test('buildSite refuses a link inside <ir-dir>/posts before any build is started', async (t) => {
  const { engine, astroDir } = makeEngine(t);
  const { box, site } = makeBox(t);
  writeFileSync(join(site, 'home.md'), PAGES[0].markdown);
  mkdirSync(join(site, 'posts'));
  symlinkSync('../../outside/secret.txt', join(site, 'posts/leak.md'));
  const before = walk(astroDir);
  await assert.rejects(buildSite({
    irDir: site, engineDir: engine, outDir: join(box, 'out'), npxBin: join(box, 'no-such-runner'),
  }), (err) => {
    assert.match(err.message, /symbolic link/);
    assert.ok(err.message.includes(join(site, 'posts/leak.md')), err.message);
    return true;
  });
  assert.deepEqual(walk(astroDir), before);
  noStashLeft(astroDir);
});
