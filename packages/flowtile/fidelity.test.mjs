// flow-core FIDELITY — run: node --test packages/flowtile/fidelity.test.mjs
//
// Differential check: does flow-core behave EXACTLY like the inline script it was extracted from?
// The original is pasted verbatim below (from ejecta core/admin/server.mjs listPage), not
// paraphrased — a paraphrase would compare my extraction against my memory of the original.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GROUPS, filterPosts, facetItems } from './flow-core.js';

// ── ORIGINAL, verbatim ────────────────────────────────────────────────────────────────────────
const ORIG_GROUPS = [
  {key:'status',vals:p=>[p.status]},
  {key:'categories',vals:p=>p.categories||[]},
  {key:'tags',vals:p=>p.tags||[],cap:40},
  {key:'years',vals:p=>p.year?[p.year]:[]},
];
const origMatches = (p, q, active) => {
  if(q && !(p.title||'').toLowerCase().includes(q)) return false;
  for(const g of ORIG_GROUPS){const sel=active[g.key];if(sel&&sel.size){const pv=g.vals(p);if(!pv.some(v=>sel.has(v)))return false;}}
  return true;
};
const origFacet = (POSTS, g, facetSort) => {
  const counts={};POSTS.forEach(p=>g.vals(p).forEach(v=>{if(v)counts[v]=(counts[v]||0)+1;}));
  let items=Object.entries(counts);
  items.sort(facetSort==='name'?(a,b)=>String(a[0]).localeCompare(String(b[0]),'zh-Hant'):(a,b)=>b[1]-a[1]);
  if(g.cap)items=items.slice(0,g.cap);
  return items;
};

// ── a corpus wide enough to hit the edges ────────────────────────────────────────────────────
const TAGS=['臨床','雜談','一','二','三','x','y',''];
const CATS=['醫學','生活',''];
const STAT=['publish','draft',''];
const YEARS=['2024','2025','2026',''];
let seed=42; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const pick=(a)=>a[Math.floor(rnd()*a.length)];
const posts=Array.from({length:400},(_,i)=>({
  stem:'s'+i, title:pick(['外科訓練','值班日記','Surgery notes','',undefined,'混合 Mixed'])||'',
  status:pick(STAT), categories:rnd()<0.15?undefined:[pick(CATS)].filter(Boolean),
  tags:rnd()<0.15?undefined:Array.from({length:Math.floor(rnd()*3)},()=>pick(TAGS)).filter(Boolean),
  year:pick(YEARS),
}));

test('the extraction reproduces the inline original exactly', () => {
let checked=0, mismatch=0;
const queries=['','外科','surgery','混合','zzz'];
const actives=[{},{tags:new Set(['臨床'])},{tags:new Set(['臨床','雜談'])},
  {status:new Set(['draft'])},{tags:new Set(['臨床']),status:new Set(['publish'])},
  {categories:new Set(['醫學']),years:new Set(['2025','2026'])}];
for(const q of queries) for(const a of actives){
  const mine=filterPosts(posts,{query:q,active:a}).map(p=>p.stem);
  const orig=posts.filter(p=>origMatches(p,q,a)).map(p=>p.stem);
  checked++;
  if(JSON.stringify(mine)!==JSON.stringify(orig)){mismatch++;console.log('🔴 FILTER MISMATCH q=',JSON.stringify(q),'active=',a);}
}
for(const sort of ['name','count']) for(const g of GROUPS){
  const og=ORIG_GROUPS.find(x=>x.key===g.key);
  const mine=facetItems(posts,g,{sort}).map(i=>[i.value,i.count]);
  const orig=origFacet(posts,og,sort);
  checked++;
  if(JSON.stringify(mine)!==JSON.stringify(orig)){mismatch++;console.log('🔴 FACET MISMATCH',g.key,sort);console.log('  mine:',JSON.stringify(mine.slice(0,5)));console.log('  orig:',JSON.stringify(orig.slice(0,5)));}
}
console.log(`corpus 400 posts · ${checked} comparisons · ${mismatch} mismatch(es)`);
assert.equal(mismatch, 0, 'the extraction changed behaviour — see the mismatches above');
assert.ok(checked >= 30, `expected a broad sweep, only ran ${checked} comparisons`);
console.log('✅ EXTRACTION IS FAITHFUL — same results as the inline original');
});
