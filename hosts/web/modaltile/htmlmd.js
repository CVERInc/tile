// htmlmd — minimal, faithful HTML<->markdown for editabilize (the WP-block subset a recast hits).
// Philosophy — fidelity is the north star: convert ONLY text-bearing blocks (p / h1-6 / lists / blockquote /
// inline a,strong,em,br) to clean markdown so marktile can edit them. Everything rich or unknown
// (figure/img with srcset, div, svg, script, iframe, embeds) is kept VERBATIM as an opaque raw-HTML
// block — lossless round-trip, decorations stay frozen. domToMd needs a DOM (runs in-browser during
// editabilize); mdToHtml is pure string (node + browser).

const BLOCK_RAW = new Set(['FIGURE', 'IMG', 'DIV', 'SVG', 'SCRIPT', 'IFRAME', 'TABLE', 'VIDEO', 'AUDIO', 'CANVAS', 'FORM']);

// WordPress replaces emoji characters with <img class="emoji" alt="😀" src=".../core/emoji/...">. Detect them
// so we can restore the actual character instead of carrying the image (ugly in the editor, wrong as a thumb).
const isEmojiImg = (el) => el && el.tagName === 'IMG' &&
  (/(^|\s)emoji(\s|$)/.test(el.getAttribute('class') || '') || /s\.w\.org\/images\/core\/emoji|wp-includes\/images\/[^"']*emoji/i.test(el.getAttribute('src') || ''));
// string form (for HTML we don't parse into a DOM — render passthrough, server meta): img -> its alt char.
export function cleanEmoji(html) {
  return String(html).replace(/<img\b[^>]*>/gi, (tag) =>
    (/class="[^"]*\bemoji\b|s\.w\.org\/images\/core\/emoji|wp-includes\/images\/[^"']*emoji/i.test(tag)
      ? ((tag.match(/\balt="([^"]*)"/i) || [, ''])[1]) : tag));
}

// --- DOM -> markdown -------------------------------------------------------
function inlineToMd(node) {
  let out = '';
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) { out += n.textContent.replace(/\s+/g, ' '); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === 'BR') { out += '\n'; return; }
    if (tag === 'A') { out += '[' + inlineToMd(n) + '](' + (n.getAttribute('href') || '') + ')'; return; }
    if (tag === 'STRONG' || tag === 'B') { out += '**' + inlineToMd(n) + '**'; return; }
    if (tag === 'EM' || tag === 'I') { out += '*' + inlineToMd(n) + '*'; return; }
    if (tag === 'CODE') { out += '`' + n.textContent + '`'; return; }
    if (isEmojiImg(n)) { out += (n.getAttribute('alt') || ''); return; }   // WP emoji <img> -> the actual char
    if (BLOCK_RAW.has(tag)) { out += n.outerHTML; return; }   // inline-level rich node, keep verbatim
    out += inlineToMd(n);
  });
  return out;
}

// element (e.g. .entry-content) -> markdown string
export function domToMd(root) {
  const parts = [];
  root.childNodes.forEach((n) => {
    if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) parts.push(t); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (isEmojiImg(n)) { const a = (n.getAttribute('alt') || '').trim(); if (a) parts.push(a); return; }   // WP emoji -> char
    if (BLOCK_RAW.has(tag)) { parts.push(n.outerHTML.trim()); return; }      // opaque: verbatim
    if (/^H[1-6]$/.test(tag)) { parts.push('#'.repeat(+tag[1]) + ' ' + inlineToMd(n).trim()); return; }
    if (tag === 'P') { const s = inlineToMd(n).trim(); if (s) parts.push(s); return; }
    if (tag === 'BLOCKQUOTE') { parts.push(inlineToMd(n).trim().split('\n').map((l) => '> ' + l).join('\n')); return; }
    if (tag === 'UL' || tag === 'OL') {
      const lines = [];
      n.querySelectorAll(':scope > li').forEach((li, i) => lines.push((tag === 'OL' ? (i + 1) + '. ' : '- ') + inlineToMd(li).trim()));
      parts.push(lines.join('\n')); return;
    }
    if (tag === 'HR') { parts.push('---'); return; }
    parts.push(n.outerHTML.trim());   // anything else: keep verbatim
  });
  return parts.filter(Boolean).join('\n\n') + '\n';
}

// --- markdown -> HTML ------------------------------------------------------
function inlineToHtml(s) {
  // images first (so the ! isn't eaten by link rule), then links, bold, italic, code, br.
  // ![[ref]] is the family-canonical image embed (same token Obsidian writes); the web resolves the ref to its
  // served upload path /media/uploads/<ref>. ![](url) is still accepted for legacy/explicit-URL content.
  return s
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, ref, alt) => '<img src="/media/uploads/' + ref.trim() + '" alt="' + (alt || '').trim() + '" />')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br />');
}

export function mdToHtml(md) {
  const blocks = String(md).replace(/\r\n/g, '\n').split(/\n{2,}/);
  const out = [];
  for (let raw of blocks) {
    const b = raw.trim();
    if (!b) continue;
    if (b[0] === '<') { out.push(b); continue; }                              // opaque raw-HTML block, verbatim
    const h = b.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const n = h[1].length; out.push(`<h${n}>` + inlineToHtml(h[2].trim()) + `</h${n}>`); continue; }
    if (/^>\s?/.test(b)) { out.push('<blockquote>' + inlineToHtml(b.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n')) + '</blockquote>'); continue; }
    if (/^---+$/.test(b)) { out.push('<hr />'); continue; }
    if (/^(\d+\.|-)\s/.test(b)) {
      const ol = /^\d+\.\s/.test(b);
      const items = b.split('\n').map((l) => '<li>' + inlineToHtml(l.replace(/^(\d+\.|-)\s+/, '').trim()) + '</li>').join('');
      out.push(ol ? '<ol>' + items + '</ol>' : '<ul>' + items + '</ul>'); continue;
    }
    out.push('<p>' + inlineToHtml(b) + '</p>');
  }
  return out.join('\n');
}
