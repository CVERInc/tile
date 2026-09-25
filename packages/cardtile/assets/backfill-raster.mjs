// Give EXISTING cards their avatar's raster copy (reef#1092).
//
//   node packages/cardtile/assets/backfill-raster.mjs <card.md> [<card.md> …]   # dry run (default)
//   node packages/cardtile/assets/backfill-raster.mjs --dir <dir>                # every *.card.md in it
//   … --write                                                                    # rewrite those FILES
//
// A card made before reef#1092 has a webp avatar and no PNG copy, so its link preview has no image
// and its home-screen icon is the badge (card-share.mjs, card-icon.mjs). New avatars get the copy at
// ingest; this makes the same copy (raster-copy.mjs — the same function embed.mjs uses) for the ones
// already stored, and says, per card, what it would add.
//
// 🔴 READ-ONLY UNLESS TOLD OTHERWISE. The default prints and touches nothing. `--write` rewrites the
// LOCAL files it was given, and that is all it can ever do: there is no store, KV or network code in
// here. Getting a card's bytes out of the store and back into it is a separate, deliberate step
// (cards/README.md), taken by whoever decides the backfill should happen — not a flag on this tool.
//
// 🔴 A file that does not come back byte-identical through parseCard→serializeCard is REFUSED even
// with --write: its rewrite would change more than the one asset line, and a backfill has no business
// normalising somebody's card as a side effect.
import fs from 'node:fs';
import { join } from 'node:path';
import { parseCard, serializeCard, rasterCopyId } from '../card-core.js';
import { rasterCopy, avatarAssetId } from './raster-copy.mjs';

/**
 * One card's markdown → what the backfill would do to it. Pure but for `sharp`.
 *   { status: 'add', avatar, mime, copyBytes, deltaBytes, md }   a copy would be added; md is the result
 *   { status: 'has-copy' | 'png-avatar' | 'no-own-avatar' | 'not-round-trip' | 'unreadable', … }
 */
export async function planBackfill(sharp, md) {
  const model = parseCard(md);
  const id = avatarAssetId(model);
  if (!id) return { status: 'no-own-avatar' };
  const a = model.assets[id];
  if (model.assets[rasterCopyId(id)]) return { status: 'has-copy', avatar: id, mime: a.mime };
  if (a.mime === 'image/png') return { status: 'png-avatar', avatar: id, mime: a.mime };
  if (serializeCard(model) !== md) return { status: 'not-round-trip', avatar: id, mime: a.mime };
  let png;
  try { png = await rasterCopy(sharp, Buffer.from(a.b64, 'base64')); } catch (e) {
    return { status: 'unreadable', avatar: id, mime: a.mime, why: String(e.message || e).slice(0, 80) };
  }
  model.assets[rasterCopyId(id)] = { mime: 'image/png', b64: png.toString('base64') };
  const out = serializeCard(model);
  return { status: 'add', avatar: id, mime: a.mime, copyBytes: png.length, deltaBytes: out.length - md.length, md: out };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) await cli(process.argv.slice(2));

async function cli(args) {
  const write = args.includes('--write');
  const d = args.indexOf('--dir');
  const files = d >= 0
    ? fs.readdirSync(args[d + 1]).filter((f) => f.endsWith('.card.md')).sort().map((f) => join(args[d + 1], f))
    : args.filter((a) => !a.startsWith('--'));
  if (!files.length) { console.error('usage: backfill-raster.mjs <card.md …> | --dir <dir>  [--write]'); process.exit(2); }
  const { loadSharp } = await import('./sharp.mjs');
  const sharp = await loadSharp();
  console.log(write ? '--write: the files listed as "add" WILL be rewritten (local files only)\n' : 'dry run — nothing is written\n');
  let n = 0, bytes = 0;
  for (const f of files) {
    const md = fs.readFileSync(f, 'utf8');
    const p = await planBackfill(sharp, md);
    const tail = p.status === 'add'
      ? `add ${p.avatar}.png  copy ${p.copyBytes} B · card +${p.deltaBytes} B (${md.length} → ${md.length + p.deltaBytes})`
      : p.status + (p.avatar ? `  ${p.avatar} (${p.mime})` : '') + (p.why ? `  ${p.why}` : '');
    console.log(`  ${f}\n      ${tail}`);
    if (p.status !== 'add') continue;
    n += 1; bytes += p.deltaBytes;
    if (write) fs.writeFileSync(f, p.md);
  }
  console.log(`\n${n} of ${files.length} card(s) ${write ? 'rewritten' : 'would change'}, +${bytes} B in total`);
}
