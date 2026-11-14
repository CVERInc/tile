// deck.js — a Card page as a deck of cards: stack (one on top of another), list (one row, scrolled
// sideways) and wall (the page as it is, every tile in place). Runs on every Card page, after the
// engine's own markup; nothing here changes the card file.
//
// ONE SET OF NODES, THREE VIEWS. The tiles the engine rendered are the cards in every view: no view
// removes one, re-creates one or reloads the page to get to another. What a switch does:
//   stack ⇄ list   a class on the root (html.list) and the stylesheet; the cards glide (FLIP)
//   wall ⇄ either  classes on the root (html.deck) and the stylesheet, AND each tile moves between
//                  its two homes — its place in the engine's grid (wall) and the front of its card
//                  (stack / list). So do a back that a tile names, and the footer.
// 🔴 Why the wall is not a class alone. A pile is drawn in DOM order (the top card is the last
// sibling; a card in flight is moved at its apex — see order() and flight()), and a card has two
// faces. The wall is the engine's own markup, whose rules are written against the engine's own
// parents (grid sections, full-bleed text, runs of links). One tile cannot be a child of both, so
// it has two homes and is moved between them — the same node, never out of the document, with
// Element.moveBefore where the browser has it (a frame inside a tile keeps its document; without
// it, a frame that is moved loads again). The pile is built ONCE, the first time a pile view is
// entered, and kept; a tile's card is made when the pile first reaches that tile, and until then
// the tile stays where the engine put it (in the page, not drawn).
//
// What is still done by script, and why: the pile's order (DOM order is paint order), the window of
// cards around the top one in a long Card (a card outside it waits on a bench that is not drawn),
// the cards made from the lines of a card file (text only: made and dropped as the window moves),
// and the move between the two homes above. Nothing else changes the page's structure.
//
// What the page hands it (packages/cardtile/w3/deck-page.mjs writes all of these):
//   <html data-view data-views>  the view this page opens on and the views the file offers; the
//                         page's head script has already applied a visitor's last pick and set the
//                         root's classes, before the first paint. data-view-pin: the view was named
//                         for this page (the editor's preview) — no stored pick is read or written.
//   window.__cardFront    the card file's frontmatter only (`views:`, `view:`, `back:`)
//   window.__deckStrings  the visitor-facing words, in the card's own language (w3/deck-i18n.mjs)
//   window.__deckRef      the card's handle, for the reef.cards link's ?ref= (absent: no ref)
//   window.__pool         true when these Cards are in the card pool; absent, false or anything else: out
// A page may instead carry a whole card file as its items (data-card-src, or window.__cardMd).
(function(){
  const root=document.documentElement;
  // ---- two homes: a node that sits in one place on the wall and in another in a pile ----
  // lodge(n) leaves a marker (a comment) where the engine put n; settled(n) notes where the pile put it. rehome() moves every
  // such node to the one or the other. The marker stays where it is for good, so the wall gets its own markup back exactly.
  const twoHomes=new Map();
  let ON=false;   // a pile view is showing. On the wall the pile is still there, hidden, and must not answer the page's scroll, keys or taps
  // 🔴 A deck that does not come up leaves the page as the wall. html.deck is on the root before the first paint and the
  // stylesheet does not draw the engine's grid under it, so a script that throws — at its first line or half-way through
  // building the pile — would otherwise leave an empty table. fail() sends every tile home (plain insertBefore: whatever
  // threw may be what moveBefore needed), stops the pile answering, and says so on the root: data-deck-off, under which the
  // stylesheet draws none of the deck's own parts (a switcher that does nothing is worse than none).
  // window.__deckBoot is the word the page's head script waits for (deck-page.mjs): 'pending' | 'ready' | 'failed'.
  const fail=e=>{ ON=false; window.__deckBoot='failed';
    try{ twoHomes.forEach((h,n)=>{ const p=h.mark.parentNode; if(p&&(n.parentNode!==p||n.previousSibling!==h.mark)) p.insertBefore(n,h.mark.nextSibling); }); }catch(_){}
    root.classList.remove('deck','list','open','fan','fan-closing','moving','list-away','swipe'); root.dataset.view='wall'; root.setAttribute('data-deck-off','');
    try{history.scrollRestoration='auto';}catch(_){}
    for(const k of ['__deckSetMode','__deckView','__deckLayout','__deckListHome','__deckFanToggle','__deckFan','__deckJump','__deckRiffle','__deckCount','__deckCur']) delete window[k];
    try{console.error('deck: did not come up, the page is the wall',e);}catch(_){} };
  const main=()=>{ try{ boot(); window.__deckBoot='ready'; }catch(e){ fail(e); } };
  // a page may carry its items as a card file instead of cells (data-card-src): fetch it, then boot with it
  const SRC=root.dataset.cardSrc;
  if(SRC&&window.__cardMd==null){ window.__deckBoot='pending'; fetch(SRC).then(r=>{ if(!r.ok)throw new Error('HTTP '+r.status); return r.text(); }).then(t=>{ window.__cardMd=t; main(); }).catch(e=>fail(new Error('card file '+SRC+': '+(e&&e.message)))); return; }
  main();
  function boot(){
  const LS='reef-card-layout';
  const I={deck:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.65 7.65a2 2 0 012.629-1.046l5.51 2.374a2 2 0 011.046 2.628l-3.957 9.184a2 2 0 01-2.628 1.046l-5.51-2.374a2 2 0 01-1.046-2.628z"/><path d="M18 7.777V4a2 2 0 00-2-2h-6a2 2 0 00-2 2v10a2 2 0 001.137 1.805"/><path d="m8 4.389-4.364.809a2 2 0 00-1.602 2.33l1.822 9.833a2 2 0 002.331 1.602l2.542-.47"/></svg>',
           grid:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 9v6"/><path d="M16 15v6"/><path d="M16 3v6"/><path d="M3 15h18"/><path d="M3 9h18"/><path d="M8 15v6"/><path d="M8 3v6"/></svg>',
           list:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3v18" /><rect width="12" height="18" x="6" y="3" rx="2" /><path d="M22 3v18" /></svg>',
           fan:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.65 7.65a2 2 0 012.629-1.046l5.51 2.374a2 2 0 011.046 2.628l-3.957 9.184a2 2 0 01-2.628 1.046l-5.51-2.374a2 2 0 01-1.046-2.628z"/><path d="M18 7.777V4a2 2 0 00-2-2h-6a2 2 0 00-2 2v10a2 2 0 001.137 1.805"/><path d="m8 4.389-4.364.809a2 2 0 00-1.602 2.33l1.822 9.833a2 2 0 002.331 1.602l2.542-.47"/></svg>'};
  const HOME=document.documentElement.hasAttribute('data-reef-home');   // reef.cards home: our own cards on the sea
  const DRAW=document.documentElement.hasAttribute('data-reef-draw');   // reef.cards/draw: a hand dealt from every public Card
  const REF=document.documentElement.hasAttribute('data-reef-ref');     // reef.cards for a visitor who came from someone's page
  const OURS=HOME||DRAW||REF;
  const S=window.__deckStrings||{}; const say=k=>(S[k]!=null?String(S[k]):'');
  const escA=t=>String(t).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const REFQ=window.__deckRef?'?ref='+encodeURIComponent(String(window.__deckRef)):'';
  const mk=(tag,cls,html)=>{const e=document.createElement(tag);e.className=cls;if(html!=null)e.innerHTML=html;return e;};
  // ---- items from a card file: one per `- [ ] %% card: … %% text` line. Kept as text; a card is built only when it is near view ----
  // The marker has two spellings, `%% card:` and `%% cardtile:` (card-core.js RE_CARD_MARKER); k is the length of the one this line uses.
  // `## back: id` lanes are the backs: an item names one with `back=#id`. Items are only read from the first lane.
  const mdTexts=[], backAt=new Map(), backs=new Map(); { const MD=window.__cardMd; if(MD){ let a=0; const L=MD.length; if(MD.startsWith('---\n')){ const e=MD.indexOf('\n---\n',4); a=e<0?0:e+5; }
      // one id rule for both ends (`back=#x%y` and `## back: a|b` used to be cut differently and never matched)
      let cur=null, k=0; const ID=/^[^\s%|]+/, BK=/(?:^|\s)back=#([^\s%|]+)/;
      while(a<L){ let b=MD.indexOf('\n',a); if(b<0)b=L; const e=MD.charCodeAt(b-1)===13?b-1:b;   // CRLF: drop the \r
        if(MD.startsWith('## ',a)){ const m=/^back:\s*(.*)$/.exec(MD.slice(a+3,e)); const id=m&&ID.exec(m[1]); cur=id?[]:null; if(id)backs.set(id[0],cur); }
        else if(MD.startsWith('- [ ] %% card',a)&&(k=MD.charCodeAt(a+13)===58?14:MD.startsWith('tile:',a+13)?18:0)){ const t=MD.indexOf('%% ',a+k); const txt=t>=0&&t<e?MD.slice(t+3,e):'';
          if(cur){ if(txt)cur.push(txt); } else { const m=BK.exec(MD.slice(a+k,t>=0&&t<e?t:e)); if(m)backAt.set(mdTexts.length,m[1]); mdTexts.push(txt); } }   // items from every lane that is not a back
        else if(cur&&MD.charCodeAt(a)===9){ cur.push(MD.slice(a+1,e)); }
        a=b+1; } } }
  const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const numFmt=t=>/^\d+$/.test(t)?(+t).toLocaleString('en-US'):t;
  const CAP=15e6;   // browsers cap an element's height (Chrome ~33.5M px, Firefox ~17.9M); a long deck's scroll range is capped and mapped to the index
  // the author's choice (frontmatter): `views: stack list wall` = which of stack/list/wall a visitor may switch between,
  // `view: list` = which one opens. The file says the names people see; inside, the modes keep their old names. A visitor's own last pick wins only when it is one the author offers.
  const FM={}; { const M=window.__cardMd||window.__cardFront||''; if(M.startsWith('---\n')){ const e=M.indexOf('\n---\n',4); (e<0?'':M.slice(4,e)).split('\n').forEach(l=>{ const k=/^([\w-]+):\s*(.*)$/.exec(l); if(k)FM[k[1]]=k[2].trim(); }); } }
  const V2M={stack:'deck',list:'list',wall:'spread'}, M2V={deck:'stack',list:'list',spread:'wall'}; const VIEWS=String(FM.views||'stack list wall').split(/[\s,]+/).map(v=>V2M[v]).filter(Boolean); if(!VIEWS.length)VIEWS.push('deck');
  // The view the page opens on. A page made by deck-page.mjs says it on the root, with a visitor's last pick already applied
  // by its head script: that is taken as it stands. A page that says nothing (one not made there) is decided here, by the
  // same rule (w3/deck-views.test.mjs runs both over one matrix).
  const PIN=root.hasAttribute('data-view-pin');
  let mode=V2M[root.dataset.view]; if(!VIEWS.includes(mode)){ mode=VIEWS.includes(V2M[FM.view])?V2M[FM.view]:VIEWS[0]; if(!PIN){ try{ const s=localStorage.getItem(LS); if(VIEWS.includes(s))mode=s; }catch(_){} } }
  const paintRoot=()=>{ root.dataset.view=M2V[mode]; root.classList.toggle('deck',mode!=='spread'); root.classList.toggle('list',mode==='list'); };
  paintRoot();
  const seg=mk('div','deck-seg','<button type="button" data-m="deck" aria-label="'+escA(say('viewStack'))+'" title="'+escA(say('viewStack'))+'"><span class="ic-a">'+I.deck+'</span><span class="ic-b"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="12" height="18" x="6" y="3" rx="2"/></svg></span></button><button type="button" data-m="list" aria-label="'+escA(say('viewList'))+'" title="'+escA(say('viewList'))+'"><span class="ic-a">'+I.list+'</span><span class="ic-b"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7v10" /><path d="M6 5v14" /><rect width="12" height="18" x="10" y="3" rx="2" /></svg></span></button><button type="button" data-m="spread" aria-label="'+escA(say('viewWall'))+'" title="'+escA(say('viewWall'))+'">'+I.grid+'</button>');
  // the two homes (twoHomes, above): lodge / settled / rehome
  const lodge=n=>{ if(twoHomes.has(n)||!n.parentNode)return; const mark=document.createComment('deck'); n.parentNode.insertBefore(mark,n); twoHomes.set(n,{mark,to:null,next:null}); };
  const settled=n=>{ const h=twoHomes.get(n); if(h){ h.to=n.parentNode; h.next=n.nextSibling; } };
  const mv=(p,n,ref)=>{ if(!p||(n.parentNode===p&&n.nextSibling===ref))return; if(p.moveBefore&&n.isConnected&&p.isConnected){ try{ p.moveBefore(n,ref); return; }catch(_){} } p.insertBefore(n,ref); };
  const rehome=wall=>twoHomes.forEach((h,n)=>{ if(wall) mv(h.mark.parentNode,n,h.mark.nextSibling); else mv(h.to,n,h.next); });
  // the tiles that are cards: every tile of the card itself — in a grid, in a run of links, or set full-bleed (a text tile).
  // Not a back's tiles (a back is in its drawer on the wall and on its card in a pile), and not the file wall's own cover.
  const tiles=()=>[...document.querySelectorAll('main .st-cells > .st-cell, main .st-cells > .st-run > .st-cell, main .st-bleed > .st-cell')].filter(c=>!c.closest('.dc-drawer,.deck-table')&&!c.classList.contains('vb-cover'));
  // where you are on the wall: the tile under the middle of the window (null at the very top), so a pile opens on that card
  const wallAt=()=>{ if(scrollY<=2)return null; const mid=innerHeight/2; let best=null, far=Infinity; for(const c of tiles()){ const r=c.getBoundingClientRect(); if(!r.height)continue; const d=r.top<=mid&&r.bottom>=mid?0:Math.min(Math.abs(r.top-mid),Math.abs(r.bottom-mid)); if(d<far){far=d;best=c;} } return best; };
  // …and back: the tile of the card you were on, in the middle of the window (the first card is the top of the page)
  const wallEnter=c=>{ try{history.scrollRestoration='auto';}catch(_){} if(mdTexts.length){ virtualBrick(); scrollTo({top:0,behavior:'instant'}); return; } if(c&&c.isConnected&&c!==tiles()[0]) c.scrollIntoView({block:'center',behavior:'instant'}); else scrollTo({top:0,behavior:'instant'}); };
  let deck=null;   // the pile and all it needs: built the first time a pile view is entered (buildDeck), then kept
  // The switch. Never a reload: stack ⇄ list is the pile re-arranging itself; to or from the wall the tiles change homes.
  // Focus stays on the switcher (its buttons are never moved), and the place you were reading carries over.
  // o.quiet: a view somebody else names (the editor's preview) is not this visitor's pick, so it is not remembered.
  const setMode=(m,o)=>{ if(!VIEWS.includes(m))return false; if(m===mode)return true;
    if(!PIN&&!(o&&o.quiet)){ try{localStorage.setItem(LS,m);}catch(_){} }
    const held=seg.contains(document.activeElement)?document.activeElement:null;
    if(mode==='spread'){ const at=wallAt(); mode=m; paintRoot(); if(deck) deck.enter(at); else deck=buildDeck(at); }
    else if(m==='spread'){ const at=deck.leave(); mode=m; paintRoot(); wallEnter(at); }
    else { deck.layout(m); mode=m; paintRoot(); }
    seg.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.m===mode)));
    if(held&&document.activeElement!==held) held.focus({preventScroll:true});
    return true; };
  window.__deckSetMode=setMode;
  window.__deckView=v=>setMode(V2M[v],{quiet:true});   // by the name people see ('stack' | 'list' | 'wall'); true when the page now shows it
  seg.querySelectorAll('button').forEach(b=>{ if(!VIEWS.includes(b.dataset.m))b.remove(); }); if(VIEWS.length<2)seg.style.display='none';   // one view = nothing to switch
  seg.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.m===mode)); b.onclick=()=>{ if(b.dataset.m!==mode){setMode(b.dataset.m);return;} if(b.dataset.m==='deck'&&window.__deckFanToggle) window.__deckFanToggle(); if(b.dataset.m==='list'&&window.__deckListHome) window.__deckListHome(); };});
  // spread mode = an ordinary one-page site; the exchange shows as one footer line, same href as the deck's last card
  const GLYPH='<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M 39.5 78.2 C 39.6 62 39.8 46 40 29.3"/><path d="M 40 29.3 C 37.7 29.2 33.4 28.1 30.7 22.5"/><path d="M 40 29.3 C 42.3 29.2 46.6 28.1 49.3 22.1"/><path d="M 39.5 62 C 33.3 61.6 28.8 59.8 26.5 56.5 C 24.8 54 23.8 50.8 23.7 47.5"/><path d="M 39.7 53.8 C 44.1 49.5 49.6 46.1 55.6 44.1 C 62 41.9 69.5 41.6 76.8 44.1"/><path d="M 62.6 42.2 C 64.1 40.7 66.4 37.3 64.8 31.8"/></svg>';
  // the footer is site chrome: identical in every view
  // footer = two zones: the owner's © is a link to this card; the right-hand segment, whole, is the exchange link. No underline; hover = accent.
  // In the card pool (reef#2913): the PLATFORM's switch, never the file's. On, these Cards can be drawn at reef.cards and swim on
  // the home page, and in return the last card and the footer link to reef.cards; off, none of that. The editor's preview
  // passes it as window.__pool. Only `true` is in: a page without it (or with false, or any other value) is OUT, so an
  // unknown or missing switch never opts a Card into the pool. The engine's own `powered-by` footer link is the same
  // promise, so it folds into this switch and the file's key no longer decides anything.
  const POOL=window.__pool===true;
  if(!OURS){ const fd=document.querySelector('footer.st-footer > div'); if(fd){ const own=fd.querySelector('span'); if(own&&fd.querySelector('a[href*="feelreef.com/signup"]')) while(own.nextSibling) own.nextSibling.remove(); if(own&&location.protocol!=='about:'){ const a=document.createElement('a'); a.href=location.pathname||'/'; a.innerHTML=own.innerHTML; own.replaceWith(a); } if(POOL) fd.insertAdjacentHTML('beforeend','&nbsp;&nbsp;|&nbsp;&nbsp;<a href="https://reef.cards/'+REFQ+'" target="_blank" rel="noopener noreferrer">reef.cards</a>'); } }
  // the bar: the switcher, and (in a pile) the close button and the way back. One bar in every view, so the switcher is the
  // same element wherever you are; on the wall the stylesheet shows the switcher alone.
  const bar=mk('div','deck-bar'); const left=mk('div',''); const closeBtn=mk('button','deck-close','✕'); closeBtn.type='button'; closeBtn.setAttribute('aria-label',say('putBack')); closeBtn.onclick=()=>{ if(deck)deck.close(); }; left.append(closeBtn);
  if(DRAW){ const home=mk('a','deck-home','← reef.cards'); home.href='reefcards.html'; const where=mk('span','deck-where',esc(say('drawWhere'))); left.append(home,where); }
  { const d=document.documentElement.dataset; if(d.backHref){ const b=mk('a','deck-home',d.backLabel||'←'); b.href=d.backHref; left.append(b); } }   // top-left = back to where you came from
  bar.append(left,seg); document.body.appendChild(bar);
  // wall: a back opens as the engine's own flipped card (st-back-door / data-back-url);
  // nothing here turns a tile over, and a link with no back= is just a link.
  let vb=null;   // the file wall, once it is set up (virtualBrick)
  if(mode==='spread'){ if(mdTexts.length) virtualBrick(); } else deck=buildDeck(null);
  // wall over a card file: only the rows on screen exist. The scroll range is capped (CAP) and mapped to rows, so ~850,000 items are one page.
  // Set up once; the tiles it stands in for stay in the page (the stylesheet hides them under .vb), so a pile can still deal them.
  function virtualBrick(){
    if(vb){ vb.api(); vb.layout(); return; }
    const box=document.querySelector('main .st-cells'); if(!box)return; box.classList.add('vb');
    const tpl=document.getElementById('md-cover'); if(tpl){ const c=tpl.content.firstElementChild.cloneNode(true); const r=c.querySelector('[data-range]'); if(r) r.textContent=numFmt(mdTexts[0])+' – '+numFmt(mdTexts[mdTexts.length-1]); c.classList.add('vb-cover'); box.appendChild(c); }
    const COLS=6, GAP=12, M=mdTexts.length, rows=Math.ceil(M/COLS); const space=mk('div','vb-space'), win=mk('div','vb-win'); space.appendChild(win); box.appendChild(space);
    let rowH=100, scale=1, hit=-1, FULL=0, SH=0, VIEW=0; const pool=[];
    // scroll y ↔ virtual y. A straight ratio (vy=y·scale) only reaches the last row once the whole space has scrolled past,
    // which the page never allows: the last rows were cut off . Map the scrollable span [0, SH−VIEW] onto [0, FULL−VIEW]
    // instead, and past it move 1:1 so the rows stay attached to the space.
    const toV=y=>{ if(scale<=1)return y; const a=SH-VIEW, b=FULL-VIEW; return y<=a?y*b/a:b+(y-a); };
    const toY=v=>{ if(scale<=1)return v; const a=SH-VIEW, b=FULL-VIEW; return v<=b?v*a/b:a+(v-b); };
    const layout=()=>{ const W=space.clientWidth||box.clientWidth; const tile=(W-(COLS-1)*GAP)/COLS; rowH=tile+GAP; win.style.setProperty('--vb-tile',tile.toFixed(1)+'px'); const full=rows*rowH; const H=Math.min(full,CAP); scale=full/H; FULL=full; SH=H; VIEW=innerHeight; space.style.height=H+'px'; render(); };
    const render=()=>{ const top=space.getBoundingClientRect().top; const y=Math.max(0,-top); const vy=toV(y);
      const r0=Math.max(0,Math.floor(vy/rowH)-2), r1=Math.min(rows-1,Math.ceil((vy+innerHeight)/rowH)+2); const need=(r1-r0+1)*COLS;
      while(pool.length<need){ const t=mk('div','vb-tile'); win.appendChild(t); pool.push(t); }
      for(let k=0;k<pool.length;k++){ const i=r0*COLS+k, t=pool[k]; if(k<need&&i<M){ t.hidden=false; if(t._i!==i){ t._i=i; t.textContent=mdTexts[i]; } t.classList.toggle('vb-hit',i===hit); } else t.hidden=true; }
      win.style.transform='translateY('+(y-(vy-r0*rowH)).toFixed(1)+'px)'; };
    addEventListener('scroll',()=>{ if(mode==='spread')render(); },{passive:true}); addEventListener('resize',()=>{ if(mode==='spread')layout(); }); layout();
    // the dice: item a (0 = the cover) → scroll its row to the middle and mark it
    const api=()=>{ window.__mdFirst=1; window.__mdCount=M; window.__deckCount=()=>M+1;
      window.__deckJump=(i)=>{ i=(i|0)-1; if(i<0){ scrollTo({top:0,behavior:'instant'}); return; } hit=Math.min(M-1,i); const r=Math.floor(hit/COLS); const spaceTop=space.getBoundingClientRect().top+scrollY; scrollTo({top:Math.max(0,spaceTop+toY(Math.max(0,r*rowH-innerHeight/2+rowH/2))),behavior:'instant'}); render(); }; };
    api(); vb={api,layout};
  }
  // ---- the pile (stack and list). Built once; `at` is the tile to open on (null: the first card). ----
  function buildDeck(at){
  ON=true;
  let LIST=mode==='list';   // the deck engine, laid out one card under another with ordinary scrolling (Safari tab view); no pile physics


  // reef.cards home: every public Card's first card, shuffled on each visit (random draw is a game we play at our place only); bottom card = make your own
  const cells=tiles();   /* a text tile is set full-bleed, outside the grid — it is still a card. Grid-only lost every text tile from stack/list, and a card of only text had no grid at all. A run of full-width links is a wrapper inside the grid: its tiles are cards too (they used to be left out, and stack / list silently had fewer cards than the wall). A back lane sets its text tiles full-bleed too: those are backs, not cards */
  if(DRAW){ for(let i=cells.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [cells[i],cells[j]]=[cells[j],cells[i]]; } const box=cells[0]&&cells[0].parentElement; if(box) cells.forEach(c=>box.appendChild(c)); }
  const drawers={}; document.querySelectorAll('.dc-drawer').forEach(d=>drawers[d.id]=d.querySelector('.dc-drawer-body'));
  const hero=document.querySelector('main .st-hero');
  const owner={name:(hero&&hero.querySelector('.st-figure')||{}).dataset?.name||document.title, url:(hero&&hero.querySelector('.st-figure')||{}).dataset?.url||location.origin, av:hero&&hero.querySelector('.cp-icon')?.src};
  if(OURS){ owner.name='reef.cards'; owner.url='https://reef.cards'; owner.handle='reef.cards'; owner.av='reef-badge.png'; }
  const shade=mk('div','deck-shade'); shade.addEventListener('click',e=>{e.stopPropagation();close();}); const gshadow=mk('div','deck-gshadow'); const veil=mk('div','deck-veil'); veil.addEventListener('click',e=>{e.stopPropagation();close();});   /* the click that closes must not also reach the table (it fanned the deck and the closing card vanished) */ const table=mk('div','deck-table'); const stack=mk('div','deck-stack'); stack.appendChild(gshadow); table.appendChild(stack);
  // The table is in the page from the start, and so is the bench beside the pile: a card that is not in the window around the
  // top card waits there (not drawn), instead of leaving the document. A tile is therefore in the document in every view,
  // however long the Card. Same stacking context as the footer (below), so z 5 really sits under the cards.
  const bench=mk('div','deck-bench'); table.appendChild(bench);
  const host=document.querySelector('main .st-card')||document.body; host.appendChild(veil); host.appendChild(table);
  // hover is tracked by hand (not :hover): after the pile reorders under a still mouse, Safari does not re-evaluate :hover until the
  // mouse moves, so the peek would vanish and a same-spot click would hit the new top card. We re-evaluate from the last pointer position.
  let hx=-1,hy=-1; const hovEval=()=>{ if(hx<0)return; const r=stack.getBoundingClientRect(); const within=(b,px)=>hx>=b.left-px&&hx<=b.right+px&&hy>=b.top-10&&hy<=b.bottom+20;
    // a neighbour's hit region is wide: from where it rests to where it reaches when fully revealed (the fan's tall column, turned sideways)
    const reveal=Math.max(34,Math.min(r.width*0.4,(innerWidth-r.width)/2-16,260)); const band=reveal+12;   // same numbers as the CSS --reveal clamp (custom properties do not compute to px)
    const next=cards.find(k=>k.classList.contains('is-next1')), prev=cards.find(k=>k.classList.contains('is-prev1'));
    const onRight=hy>=r.top-10&&hy<=r.bottom+20&&hx>r.right-30&&hx<=r.right+band, onLeft=hy>=r.top-10&&hy<=r.bottom+20&&hx<r.left+30&&hx>=r.left-band;
    const inStack=within(r,0)||onRight||onLeft; stack.classList.toggle('hov',inStack);
    const el=document.elementFromPoint(hx,hy); const c=el&&el.closest('.deck-card'); const want=onRight&&next?next:onLeft&&prev?prev:(c&&!c.classList.contains('is-top')?c:null);
    cards.forEach(k=>k.classList.toggle('hovc',inStack&&k===want)); };   // the box is inflated by the peek distance: the peek only exists while hovering, so hovering must not depend on the peek
  if(matchMedia('(hover:hover)').matches){ document.addEventListener('pointermove',e=>{ if(!ON||LIST||e.pointerType!=='mouse')return; hx=e.clientX; hy=e.clientY; hovEval(); },{passive:true}); document.addEventListener('pointerleave',()=>{hx=-1;stack.classList.remove('hov');}); }
  // horizontal drag on the top card: it follows the pointer; released past 30% of its width it is flung to the next (left) / previous (right)
  let drag=null;
  stack.addEventListener('pointerdown',e=>{ if(LIST||openCard||fanned||running)return; const c=e.target.closest('.deck-card'); if(!c||!c.classList.contains('is-top'))return; if(e.target.closest('a,button,input,select,textarea,.cp-icon,#qr-holder'))return; drag={id:e.pointerId,x0:e.clientX,y0:e.clientY,dx:0,card:c,moved:false}; },true);
  document.addEventListener('pointermove',e=>{ if(!drag||e.pointerId!==drag.id)return; const dx=e.clientX-drag.x0, dy=e.clientY-drag.y0; if(!drag.moved){ if(Math.abs(dx)<8&&Math.abs(dy)<8)return; if(Math.abs(dy)>Math.abs(dx)){drag=null;return;} drag.moved=true; drag.card.classList.add('dragging'); try{drag.card.setPointerCapture(e.pointerId);}catch(_){} } drag.dx=dx; drag.card.style.setProperty('--dragx',(dx>0&&cur===0?dx*0.28:dx)+'px'); e.preventDefault(); },{passive:false});
  const dragEnd=e=>{ if(!drag||(e&&e.pointerId!==drag.id))return; const d=drag; drag=null; if(!d.moved)return; const w=d.card.getBoundingClientRect().width; d.card.classList.remove('dragging'); d.card.style.removeProperty('--dragx');
    const n=N; const ph=pageH();
    if(SWIPE&&d.dx<-w*0.3&&cur===n-1){ endFlip('drag'); }   /* past the last card it turns over to its back (the try-it button on our own pages); it used to wrap to the first card, and a tester swiped round and round without ever finding the button */
    else if(d.dx<-w*0.3){ flingDir=1; scrollTo({top:cur<n-1?(cur+1)*ph:0,behavior:'instant'}); }
    else if(d.dx>w*0.3&&cur>0){ flingDir=-1; scrollTo({top:(cur-1)*ph,behavior:'instant'}); }
    setTimeout(()=>{ const c=d.card; c.addEventListener('click',ev=>{ev.stopPropagation();ev.preventDefault();},{capture:true,once:true}); setTimeout(()=>c.removeEventListener('click',()=>{},true),0); },0); };
  document.addEventListener('pointerup',dragEnd,true); document.addEventListener('pointercancel',dragEnd,true);
  let flingDir=0;
  // a card that is not the top card, wherever and however it shows, is a button to itself (next → +1 page, previous → −1)
  stack.addEventListener('click',e=>{ if(!e.isTrusted)return; /* the QR borrow clicks the avatar programmatically; that is not a person choosing a card */ if(openCard||fanned||document.documentElement.classList.contains('fan-closing'))return; const c=e.target.closest('.deck-card'); if(!c||c.classList.contains('is-top'))return; const dir=c.classList.contains('is-next1')?1:c.classList.contains('is-prev1')?-1:0; if(!dir)return; e.stopPropagation(); e.preventDefault(); const ph=pageH(); flingDir=dir; scrollTo({top:c.classList.contains('wrap')?0:(cur+dir)*ph,behavior:'instant'}); },true);   // same sideways flight as a drag; under the last card is the first: clicking it goes back to the top
  const cards=[]; let openCard=null;   // cards = the cards that exist right now (the window around cur), in index order
  // all items: pre (cells written in the page) · md (the card file, built on demand) · post (our own last card)
  const pre=[], post=[], lazy=new Map(); let P=0, M=0, N=0, addingPost=false;
  const idx=c=>+c.dataset.i;
  const register=c=>{ if(!addingPost){ c.dataset.i=String(pre.length); pre.push(c); } else { c.dataset.i=String(P+M+post.length); post.push(c); } return c; };
  const card=i=>{ if(i<P)return pre[i]||dealt(i); if(i<P+M){ let c=lazy.get(i); if(!c){ const t=esc(mdTexts[i-P]); const lines=backs.get(backAt.get(i-P)); c=buildCard(mk('div','st-cell deck-ours md-text','<h2>'+t+'</h2>'),lines?mk('div','md-back md-rare','<p class="rare-h">'+esc(lines[0]||'')+'</p>'+lines.slice(1).map(l=>'<p class="rare-d">'+esc(l)+'</p>').join('')):mk('div','md-back md-plain','<h2>'+t+'</h2><code>- [ ] %% card: text %% '+t+'</code><p>'+(i-P+1).toLocaleString('en-US')+' of '+M.toLocaleString('en-US')+'</p>')); c.dataset.i=String(i); lazy.set(i,c); } return c; } return post[i-P-M]; };
  const WIN=24, FANMAX=41, SNAPMAX=400, JUMP=12;   // a deck of up to 2·WIN+3 cards lives whole, as before; beyond that only the window does
  const syncWin=()=>{ const want=new Set(); if(N<=2*WIN+3){ for(let i=0;i<N;i++)want.add(i); } else { for(let i=Math.max(0,cur-WIN);i<=Math.min(N-1,cur+WIN);i++)want.add(i); want.add((cur+1)%N); want.add((cur+2)%N); }
    if(openCard)want.add(idx(openCard)); stack.querySelectorAll('.deck-card.travel').forEach(c=>want.add(idx(c)));
    for(const c of cards) if(!want.has(idx(c))) away(c);
    cards.length=0; [...want].sort((a,b)=>a-b).forEach(i=>cards.push(card(i))); };
  // a card that leaves the window: one built from the page (a tile, our own last card) goes to the bench and comes back as it
  // was; one built from a line of a card file is text and nothing else, so it is dropped and built again when it is needed
  // (a file can hold ~850,000 of them)
  const away=c=>{ const i=idx(c); if(i>=P&&i<P+M){ c.remove(); lazy.delete(i); } else bench.appendChild(c); };
  let pushed=false; addEventListener('popstate',()=>{ if(openCard){pushed=false; close();} });
  const docksInert=on=>document.querySelectorAll('dc-dock').forEach(d=>{ d.inert=on; });   /* the dice was tappable through the frosted glass */
  const open=card=>{docksInert(true);ensureQr();openCard=card;card.classList.add('is-open');lastFocus=document.activeElement;try{history.pushState({deck:'open'},'');pushed=true;}catch(_){}card.classList.remove('flipping-close');void card.offsetWidth;card.classList.add('flipping-open','flipped');card.dispatchEvent(new CustomEvent('deck:open',{bubbles:true}));card.addEventListener('animationend',function h(e){if(e.animationName!=='deck-pick')return;card.removeEventListener('animationend',h);card.classList.remove('flipping-open');});document.documentElement.classList.add('open');const bk=card.querySelector('.deck-back');bk&&setTimeout(()=>{ if(openCard===card) bk.focus({preventScroll:true}); },620);};   /* only while it is still held: a card put back before the turn ends (a view switch does that) must not take focus to a face nobody sees */
  let lastFocus=null;
  const close=()=>{if(!openCard)return;const c=openCard;if(pushed){pushed=false;try{history.back();}catch(_){}}c.classList.remove('is-open');c.classList.remove('flipping-open');void c.offsetWidth;c.classList.add('flipping-close');c.addEventListener('animationend',function h(e){if(e.animationName!=='deck-put')return;c.removeEventListener('animationend',h);c.classList.remove('flipped');});/* flipping-close stays: its fill IS the rest pose, so nothing re-animates after the end; the next open() removes it */openCard=null;document.documentElement.classList.remove('open');docksInert(false);if(lastFocus&&lastFocus.focus){lastFocus.focus();lastFocus=null;}};
  const addCard=(frontNode,backNode,opts={})=>register(buildCard(frontNode,backNode,{...opts,seated:true}));
  // seated: the card goes on the bench BEFORE its faces are filled, so a tile moves from the page into a card that is already
  // in the page — it is never outside the document, not even while its card is being put together
  function buildCard(frontNode,backNode,opts={}){
    const card=mk('div','deck-card'); if(opts.seated) bench.appendChild(card); if(frontNode&&frontNode.dataset&&frontNode.dataset.theme) card.style.cssText=frontNode.dataset.theme; const front=mk('div','deck-face deck-front'); card.appendChild(front); if(opts.seated) mv(front,frontNode,null); else front.appendChild(frontNode);
    if(backNode){card.classList.add('can-flip'); const back=mk('div','deck-face deck-back'); back.tabIndex=-1; const sc=mk('div','deck-back-scroll'); back.appendChild(sc); card.appendChild(back); if(opts.seated) mv(sc,backNode,null); else sc.appendChild(backNode);
      front.addEventListener('click',e=>{ if(e.target.closest('a,button,input,.cp-icon,#qr-holder'))return; if(String(getSelection()).length)return; if((LIST||card.classList.contains('is-top'))&&!openCard) open(card); });
      let hadSel=false; back.addEventListener('pointerdown',()=>{ hadSel=String(getSelection()).length>0; });   /* a drag that selects text, or the tap that clears a selection, is not a close */
      back.addEventListener('click',e=>{ if(e.target.closest('a,button,input,select,textarea,label'))return; if(hadSel||String(getSelection()).length){hadSel=false;return;} if(openCard===card) close(); });}
    if(opts.onTap){card.classList.add('can-flip'); front.addEventListener('click',e=>{ if(card.classList.contains('is-top')&&!openCard) opts.onTap(e); });}
    return card;
  }
  // business-card back (name, handle, QR) for cards that have no content of their own
  const heroIcon=hero&&hero.querySelector('.cp-icon');
  const qrWaiters=[]; let qrStarted=false; const ensureQr=()=>{ if(qrStarted)return; qrStarted=true; borrowQr().then(g=>qrWaiters.forEach(f=>f(g))); };
  let qrGrid=null; // the coral's drawing, borrowed (the coral draws it on demand; the deck clones it)
  const borrowQr=()=>new Promise(res=>{ if(qrGrid||!heroIcon){res(qrGrid);return;}
    const st=document.createElement('style'); st.textContent='#qr-overlay,#qr-group,#qr-overlay *,#qr-group *,#qr-holder .qr-grid{opacity:0!important;transition:none!important;animation:none!important;pointer-events:none!important}'; document.head.appendChild(st);
    heroIcon.click();
    const tryGrab=(n)=>{const g=document.querySelector('.qr-grid'); if(g){ setTimeout(()=>{ qrGrid=g.cloneNode(true); qrGrid.style.width='';qrGrid.style.height='';qrGrid.style.aspectRatio='1';
          window._qrClose&&window._qrClose();
          setTimeout(()=>{ const card=g.parentElement; if(card){card.style.transform='translate(-50%,-50%) scale(0)';card.style.opacity='0';card.style.pointerEvents='none';} heroIcon.addEventListener('click',()=>st.remove(),{capture:true,once:true}); res(qrGrid); },900); },450); }
      else if(n<40) setTimeout(()=>tryGrab(n+1),50); else {window._qrClose&&window._qrClose(); st.remove(); res(null);} };
    tryGrab(0); });
  const bcard=()=>{const b=mk('div','deck-bcard','<div><div class="nm">'+owner.name+'</div></div><div class="qr"></div><div class="hd">'+(/^https?:/.test(owner.url)?owner.url:'').replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/$/,'')+'</div>');
    const slot=b.querySelector('.qr'); slot.setAttribute('role','button'); slot.setAttribute('aria-label',say('zoomQr')); slot.addEventListener('click',e=>{e.stopPropagation(); e.preventDefault(); heroIcon&&heroIcon.click();}); qrWaiters.push(g=>{ if(g){const c=g.cloneNode(true); const av2=slot.ownerDocument.createElement('img'); av2.className='qr-av'; av2.src=owner.av||''; slot.append(c,av2);} else slot.remove(); });
    return b;};
  const goBack=(href,label,sameTab,note)=>{let dom=href; try{const u=new URL(href,location.href); dom=u.hostname.replace(/^www\./,''); if(/(^|\.)(feelreef\.com|reef\.cards)$/.test(u.hostname)&&u.pathname!=='/') dom+=u.pathname.replace(/\/$/,''); }catch(_){}   // our own domains: the path is the identity (card.feelreef.com/wtg); elsewhere the host is enough
    return mk('div','deck-go',(note?'<p class="note">'+note+'</p>':'')+'<a class="btn" '+(sameTab?'':'target="_blank" rel="noopener noreferrer" ')+'href="'+href+'">'+(label||dom)+' <span class="arr">↗</span></a>');};
  /* the default back — frontmatter `back: "#id"` names one back lane, the same pointer a tile's back=#id is, for the whole Cards. Every tile without a back of its own (and not a link or a video) gets a copy */
  const DEFB=String(FM.back||'').replace(/^["']|["']$/g,'').replace(/^#/,''); const defBack=()=>DEFB&&drawers[DEFB]?drawers[DEFB].cloneNode(true):bcard();
  // A tile's card is made when the window around the top card first reaches it (card(i) → dealt(i)), not all at once: a long
  // Card opens in the time its first cards take, and a tile nobody has reached yet is still where the engine put it — in the
  // page, not drawn (the stylesheet does not draw the grid in a pile). Once made, a card is kept.
  // A tile takes its seat: its place on the wall is marked first, and where it sits in its card is noted after.
  const usedBack=new Set();
  const seat=(c,b,named)=>{ lodge(c); if(named)lodge(b); const k=buildCard(c,b,{seated:true}); settled(c); if(named)settled(b); return k; };
  const dealt=i=>{ const k=tileCard(cells[i]); k.dataset.i=String(i); pre[i]=k; mat(k); return k; };
  for(let i=0;i<cells.length;i++) pre.push(null);
  function tileCard(c){
    if(c.classList.contains('st-embed-video')){
      const btn=c.querySelector('.st-embed-video-btn'); const yt=btn&&btn.dataset.yt;
      btn&&btn.addEventListener('click',e=>{ if(!ON)return; /* on the wall the engine's own player answers */ e.preventDefault();e.stopPropagation(); const p=mk('div','deck-player','<iframe src="https://www.youtube-nocookie.com/embed/'+yt+'?autoplay=1&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>'); p.addEventListener('click',ev=>{if(ev.target===p)p.remove();}); document.body.appendChild(p);});
      return seat(c,yt?goBack('https://www.youtube.com/watch?v='+yt):null);
    }
    const link=c.querySelector('a.st-gal-link, a.st-cell-link'); /* a picture's link or a link tile: both turn over to the address */ const trig=c.querySelector('[data-drawer]');
    if(trig&&drawers[trig.dataset.drawer]){ const id=trig.dataset.drawer, first=!usedBack.has(id); usedBack.add(id); return seat(c,first?drawers[id]:drawers[id].cloneNode(true),first); }   /* the back a tile names is the drawer's own body: on its card in a pile, in its drawer on the wall — one node, two homes. A second tile naming the same back gets a copy (it used to take the node away from the first, whose back was then empty). The engine's door (a whole-tile <a href="#id">) stays in the tile, for the wall; in a pile the card itself turns over and the stylesheet takes the door out (html.deck .st-back-door) — left tappable, the tap followed it (in the editor's preview frame #id resolves to the editor's own address and the frame loaded the editor inside itself) and the card never turned */
    if(link&&(/^https?:/.test(link.getAttribute('href')||'')||'same' in link.dataset||'blank' in link.dataset)){ return seat(c,goBack(link.href,link.dataset.pill,'same' in link.dataset,link.dataset.note)); }
    return seat(c,'noback' in c.dataset?null:defBack()); // hero, social, anything else: the default back — the owner's business card unless the file names one
  }
  if(mdTexts.length){ const tpl=document.getElementById('md-cover'); if(tpl){ const c=tpl.content.firstElementChild.cloneNode(true); const r=c.querySelector('[data-range]'); if(r) r.textContent=numFmt(mdTexts[0])+' – '+numFmt(mdTexts[mdTexts.length-1]); addCard(c,null); } }
  P=pre.length; M=mdTexts.length; addingPost=true; window.__mdFirst=P; window.__mdCount=M;
  // reef's own card at the end of the pile: a plain link card like any other. front = glyph, back = one button.
  const reefFront=mk('div','deck-reef','<div class="mark" aria-hidden="true"><svg width="48" height="48" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"><path d="M 39.5 78.2 C 39.6 62 39.8 46 40 29.3"/><path d="M 40 29.3 C 37.7 29.2 33.4 28.1 30.7 22.5"/><path d="M 40 29.3 C 42.3 29.2 46.6 28.1 49.3 22.1"/><path d="M 39.5 62 C 33.3 61.6 28.8 59.8 26.5 56.5 C 24.8 54 23.8 50.8 23.7 47.5"/><path d="M 39.7 53.8 C 44.1 49.5 49.6 46.1 55.6 44.1 C 62 41.9 69.5 41.6 76.8 44.1"/><path d="M 62.6 42.2 C 64.1 40.7 66.4 37.3 64.8 31.8"/></svg></div>');
const FILEDECK=document.documentElement.hasAttribute('data-card-src');   /* the capacity demo: simple English, its own ending */
  if(HOME&&FILEDECK){ reefFront.className='deck-ours deck-ours-cta'; reefFront.insertAdjacentHTML('beforeend','<h2>That\'s all.</h2><p>'+(window.__mdCount||0).toLocaleString('en-US')+' in one file.</p>'); }
  else if(HOME){ reefFront.className='deck-ours deck-ours-cta'; reefFront.insertAdjacentHTML('beforeend','<h2>'+esc(say('homeCtaTitle'))+'</h2><p>'+esc(say('homeCtaText'))+'</p>'); }
  if(DRAW){ reefFront.className='deck-ours deck-ours-cta'; reefFront.insertAdjacentHTML('beforeend','<h2>'+esc(say('drawCtaTitle'))+'</h2><p>'+esc(say('drawCtaText'))+'</p>'); }
  const reefBack=DRAW?null:(HOME&&FILEDECK)?goBack('https://card.feelreef.com/try/edit','Make your own',false,'One file. Under 25 MB.'):HOME?(b=>{b.insertAdjacentHTML('beforeend','<a class="try" href="https://card.feelreef.com/try/edit" target="_blank" rel="noopener">'+esc(say('tryNow'))+' <span class="arr">↗</span></a>');return b;})(bcard()):goBack('https://reef.cards/'+REFQ);
  if(!REF&&(OURS||POOL)) addCard(reefFront,reefBack,DRAW?{onTap:()=>location.reload()}:{});   // home: the badge is the last card's back, where a card you were handed would be scanned
  N=P+M+post.length;
  // ---- edge-colour mat: a picture whose border is one colour sits on a mat of that colour ----
  const edgeMode=img=>{try{const N=48,cv=document.createElement('canvas');cv.width=cv.height=N;const g=cv.getContext('2d',{willReadFrequently:true});const w=img.naturalWidth,h=img.naturalHeight;if(!w||!h)return null;const s=Math.min(N/w,N/h),dw=Math.round(w*s),dh=Math.round(h*s);g.drawImage(img,(N-dw)/2,(N-dh)/2,dw,dh);const d=g.getImageData(0,0,N,N).data;
    const x0=Math.round((N-dw)/2),y0=Math.round((N-dh)/2),x1=x0+dw-1,y1=y0+dh-1; const bins=new Map();let total=0;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){if(!(x===x0||x===x1||y===y0||y===y1))continue;const i=(y*N+x)*4;if(d[i+3]<128)continue;total++;const k=((d[i]>>4)<<8)|((d[i+1]>>4)<<4)|(d[i+2]>>4);const b=bins.get(k)||{n:0,r:0,g:0,b:0};b.n++;b.r+=d[i];b.g+=d[i+1];b.b+=d[i+2];bins.set(k,b);}
    if(!total)return null;let best=null;for(const b of bins.values())if(!best||b.n>best.n)best=b;const share=best.n/total;if(share<0.6)return null;return 'rgb('+Math.round(best.r/best.n)+','+Math.round(best.g/best.n)+','+Math.round(best.b/best.n)+')';}catch(_){return null;}};
  function mat(card){const img=card.querySelector('.deck-front .st-gal-img');if(!img)return;const apply=()=>{const c=edgeMode(img);if(c){const f=card.querySelector('.deck-front');f.style.setProperty('--deck-mat',c);f.classList.add('has-mat');}};if(img.complete)apply();else img.addEventListener('load',apply,{once:true});}
  [...pre,...post].forEach(c=>{ if(c)mat(c); });   // the cards made up front (the file's cover, our own last card); a tile's card gets its mat when it is dealt
  // cards enter the stack through paint() → syncWin(); last in DOM = on top (no z-index: WebKit flattens preserve-3d children with z-index)
  // The engine's grid is left as it is — emptied of its tiles for now, each one's place marked — and the stylesheet does not
  // draw it in a pile. The footer has two homes as well: under the cards in a pile, where the engine put it on the wall.
  { const ft=document.querySelector('footer.st-footer'); if(ft){ lodge(ft); host.insertBefore(ft,table); settled(ft); } }   // same stacking context as the table, so z 5 really sits under the cards
  let homing=0, wasAt=0; window.__deckListHome=()=>{ if(!ON||!LIST)return; const ph=pageH(); if(scrollY<=ph/2&&wasAt>0){ homing=Date.now(); scrollTo({top:wasAt*ph,behavior:'smooth'}); wasAt=0; return; } wasAt=cur; document.documentElement.classList.remove('list-away'); homing=Date.now(); scrollTo({top:0,behavior:'smooth'}); };
  window.__deckFanToggle=()=>{ if(!ON||LIST)return; if(fanned)fanIn(); else fanOut(); };
  // stack ⇄ list without a reload: the same cards glide from one arrangement to the other (FLIP), then the other arrangement's scrolling takes over
  window.__deckLayout=(m)=>{ const toList=m==='list'; if(!ON||toList===LIST)return; if(fanned)fanIn(); if(openCard)close(); if(!toList)document.documentElement.classList.remove('list-away');     const before=new Map(cards.map(c=>[c,c.getBoundingClientRect()]));   // cards that join the window during the switch have no before: they just appear
    cards.forEach(c=>{ c.style.transition='none'; c.style.opacity='1'; c.style.visibility='visible'; c.style.transform=''; });
    LIST=toList; document.documentElement.classList.toggle('list',LIST); paint();
    fit(); goTo(cur); listTx();
    // while the cards glide, the one you were reading stays on top and the rest stack beneath by distance (like the fan); flat again on landing
    cards.forEach((c,i)=>{ c.style.zIndex=String(100-Math.abs(i-cur)); });
    void stack.offsetWidth;
    cards.forEach(c=>{ const a=before.get(c); if(!a)return; const b=c.getBoundingClientRect(); const dx=a.left-b.left, dy=a.top-b.top, s=a.width/Math.max(1,b.width); c.style.transform=`translate(${dx}px,${dy}px) scale(${s})`; });
    void stack.offsetWidth;
    cards.forEach(c=>{ c.style.transition='transform .5s cubic-bezier(.3,.7,.3,1)'; c.style.transform=''; });
    setTimeout(()=>{ cards.forEach(c=>{ c.style.transition='none'; c.style.opacity=''; c.style.visibility=''; c.style.transform=''; c.style.zIndex=''; }); void stack.offsetWidth; cards.forEach(c=>{ c.style.transition=''; }); if(!LIST) paint(); },560); };
  // ---- state: an integer. No half-way position exists. ----
  let cur=0;
  const rel=j=>{const n=N;return ((j-cur)%n+n)%n;};
  // The stack is NOT a 3D context: what is drawn on top is decided by DOM order alone (translateZ never sorts siblings here).
  // So paint() keeps DOM order = pile order: deepest first, top last. Only out-of-place nodes move; a card in flight keeps its spot
  // until its own apex (see flight()), because moving a node restarts whatever animates on it.
  function order(){
    if(LIST){ /* move only what is out of place: moving a node restarts its animation, and a closed card's put-back animation is its rest pose (it replayed on every scroll step) */ let node=gshadow.nextSibling; for(const c of cards){ while(node&&node===shade)node=node.nextSibling; if(node!==c)stack.insertBefore(c,node); else node=node.nextSibling; } return; }
    const want=cards.filter(c=>!c.classList.contains('travel')).map(c=>[c,rel(idx(c))]).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
    let node=gshadow.nextSibling;
    for(const c of want){ while(node&&(node===shade||node.classList.contains('travel')))node=node.nextSibling; if(node!==c)stack.insertBefore(c,node); else node=node.nextSibling; }
  }
  function paint(){
    syncWin();
    cards.forEach(c=>{const j=idx(c); const r=rel(j); c.classList.remove('is-next1','is-next2','is-deep','is-top');
      if(r!==0&&!LIST)c.classList.remove('flipping-open','flipping-close','flipped');   // in list any card may be open, not only the centred one
      c.classList.remove('is-prev1'); c.classList.remove('wrap'); if(r===0)c.classList.add('is-top'); else if(r===1){c.classList.add('is-next1'); if(j!==cur+1)c.classList.add('wrap');} else if(r===2&&j<cur){c.classList.add('is-deep');} else if(r===2&&j>cur)c.classList.add('is-next2'); else c.classList.add('is-deep'); if(j===cur-1)c.classList.add('is-prev1');});
    order();
    const top=card(cur); if(shade.nextSibling!==top)stack.insertBefore(shade,top);
    stack.toggleAttribute('data-first',cur===0); stack.toggleAttribute('data-last',cur===N-1);
  }
  const settleHidden=c=>{ if(c.classList.contains('is-deep')){ c.style.visibility='hidden'; c.style.transition='none'; void c.offsetWidth; c.style.visibility=''; c.style.transition=''; } };
  // flight: over the top of the pile in two halves. Half 1 plays where the card is; at the apex the node moves to its new place in the pile
  // (front of DOM for to-back, end of DOM for from-back) and half 2 plays there. Both halves share the apex pose, so the swap is invisible.
  const FLIGHT=['to-back-1','to-back-2','from-back-1','from-back-2'];
  const flight=(c,kind)=>{ c.classList.add('travel'); c.classList.remove(...FLIGHT); c.classList.toggle('side',flingDir!==0); c.style.setProperty('--fdir',String(flingDir||1)); flingDir=0; void c.offsetWidth; c.classList.add(kind+'-1');
    const onEnd1=e=>{ if(!new RegExp('^deck-'+kind+'(-side)?-1$').test(e.animationName))return; c.removeEventListener('animationend',onEnd1);
      c.classList.remove(kind+'-1');
      if(kind==='to-back'){ stack.insertBefore(c,gshadow.nextSibling); } else { stack.appendChild(c); if(card(cur)===c)stack.insertBefore(shade,c); }
      void c.offsetWidth; c.classList.add(kind+'-2');
      const onEnd2=e2=>{ if(!new RegExp('^deck-'+kind+'(-side)?-2$').test(e2.animationName))return; c.removeEventListener('animationend',onEnd2); c.classList.remove(kind+'-2','travel'); settleHidden(c); order(); if(!running&&!stack.querySelector('.travel')){stack.classList.remove('busy'); requestAnimationFrame(hovEval); setTimeout(hovEval,560);} };
      c.addEventListener('animationend',onEnd2); };
    c.addEventListener('animationend',onEnd1); };
  // the deal: the pile lands on the table — when the page opens on it, and each time the wall is left for it
  const dealIn=()=>{ if(!LIST){ stack.classList.add('dealing'); } paint(); if(!LIST) cards.forEach(c=>{c.style.transform='translateY(60vh)';c.style.opacity='0';});
  requestAnimationFrame(()=>requestAnimationFrame(()=>{stack.classList.remove('dealing'); stack.classList.add('dealt'); const vis=cards.filter(c=>!c.classList.contains('is-deep')); cards.forEach(c=>{if(!vis.includes(c)){c.style.transform='';c.style.opacity='';}}); vis.slice().reverse().forEach((c,i)=>setTimeout(()=>{c.style.transform='';c.style.opacity='';},i*110)); setTimeout(()=>stack.classList.remove('dealt'),vis.length*110+700);})); };
  dealIn();
  // ---- fan: tap the table (not a card) while closed → cards spread like a hand. Slide a finger across: the card under it rises; lift → it becomes the top. Tap the table again / Esc → fold. ----
  let fanned=false, fanStep=0, fanScale=1, fanHot=-1;
  let fanT=0, fanP=0; // fanT: how far the whole fan sits below the pile (px); fanP: pivot distance below the card centre (px)
  const fit=()=>{ const w=(LIST&&cards[0]?cards[0].getBoundingClientRect().width:stack.getBoundingClientRect().width)||342; document.documentElement.style.setProperty('--deck-k',(Math.min(1,w/342)).toFixed(3)); };
  fit(); addEventListener('resize',fit);
  const fanGeom=()=>{ const r=stack.getBoundingClientRect(); return {px:r.left+r.width/2, py:r.top+r.height/2+fanT+fanP, H:r.height, top:r.top}; };
  // pivot maths lives in the transform itself, so transform-origin stays 50% 50% for every state and nothing jumps when the fan class comes off
  const fanXform=(slot,lift)=>{ const n=cards.length; const a=(slot-(n-1)/2)*fanStep;
    return 'translateY('+fanT.toFixed(1)+'px) translateY('+fanP.toFixed(1)+'px) rotate('+a.toFixed(2)+'deg) translateY('+(lift?(-0.52*fanP/1.4).toFixed(1):0)+'px) scale('+fanScale+') translateY('+(-fanP).toFixed(1)+'px)'; };
  window.__deckFan=()=>fanOut();
  let fanIdx=[];
  const fanOut=()=>{ if(!ON||LIST||fanned||openCard||running||stack.classList.contains('busy'))return; fanned=true; fanHot=-1;
    fanIdx=N<=FANMAX?[...Array(N).keys()]:Array.from({length:FANMAX},(_,k)=>Math.round(k*(N-1)/(FANMAX-1)));
    { const fc=fanIdx.map(card); for(const c of cards) if(!fc.includes(c)) away(c); cards.length=0; fc.forEach(c=>cards.push(c)); }   // during the fan, the window IS the fan
    const n=cards.length; fanStep=Math.min(3.2,26/Math.max(1,n-1)); fanScale=0.56; { const r=stack.getBoundingClientRect(), H=r.height, s=fanScale; fanP=1.4*H; const centreNow=r.top+H/2; const centreWant=innerHeight-(H*s)/2+(H*s)*0.4; fanT=(centreWant-centreNow)-fanP*(1-s); }
    cards.forEach(c=>{ c.classList.remove('flipping-close'); c.style.transition='none'; c.style.opacity='1'; c.style.visibility='visible'; c.style.pointerEvents='auto'; });
    // fan = table of contents: slots are the author's order (first card leftmost, reef's card rightmost), not the pile's rotated order.
    // Draw order left-over-right, so DOM becomes reverse author order for the fan's duration; paint() restores pile order on fold.
    [...cards].reverse().forEach(c=>stack.appendChild(c)); { const t=card(cur); if(t.parentNode===stack) stack.insertBefore(shade,t); }
    void stack.offsetWidth;
    document.documentElement.classList.add('fan');
    cards.forEach((c,i)=>{ c.style.transition=''; c.style.transform=fanXform(i,false); });
    setTimeout(()=>{ if(!fanned)return; const s=stack.getBoundingClientRect(), cx=s.left+s.width/2, cy=s.top+s.height/2; cards.forEach(c=>{ if(c.classList.contains('fan-hot'))return; const m=new DOMMatrix(getComputedStyle(c).transform); const w=c.offsetWidth,h=c.offsetHeight; c._fanRect=c.getBoundingClientRect(); c._fanPoly=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>{const q=m.transformPoint(new DOMPoint(x,y));return [cx+q.x,cy+q.y];}); }); },380); };
  const inPoly=(x,y,pg)=>{ let c=false; for(let i=0,j=pg.length-1;i<pg.length;j=i++){ const [xi,yi]=pg[i],[xj,yj]=pg[j]; if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c; } return c; };
  const fanIn=()=>{ if(!fanned)return; fanned=false; fanHot=-1;
    // Fold as a keyframe animation (WAAPI), not a transition: with both end poses known up front WebKit rasterises the card at the
    // larger scale from frame 0, so the content stays crisp all the way home instead of snapping sharp when the transition ends.
    const from=new Map(cards.map(c=>[c,getComputedStyle(c).transform]));
    document.documentElement.classList.remove('fan'); paint();
    cards.forEach(c=>{ c.style.transition='none'; c.style.transform=''; c.style.pointerEvents=''; c.classList.remove('fan-hot'); });   // solid while travelling home (opacity/visibility inline stay)
    void stack.offsetWidth;
    cards.forEach(c=>{ const f=from.get(c); if(!f)return; const to=getComputedStyle(c).transform; c.animate([{transform:f},{transform:to}],{duration:500,easing:'cubic-bezier(.45,0,.55,1)'}); });
    setTimeout(()=>{ cards.forEach(c=>{ c.style.transition='none'; c.style.opacity=''; c.style.visibility=''; }); void stack.offsetWidth; cards.forEach(c=>{ c.style.transition=''; }); }, 520); };
  const fanNearest=(x,y)=>{ const g=fanGeom(); const dx=x-g.px, dy=g.py-y; if(dy<=0)return -1; const a=Math.atan2(dx,dy)*180/Math.PI; const n=cards.length; const i=Math.max(0,Math.min(n-1,Math.round(a/fanStep+(n-1)/2))); if(y<g.top-g.H*0.3)return -1; return i; };
  const slotCard=s=>cards[s];
  const fanHover=s=>{ if(s===fanHot)return; if(fanHot>=0){const o=slotCard(fanHot);o.style.transform=fanXform(fanHot,false);o.classList.remove('fan-hot');} fanHot=s; if(s>=0){const c=slotCard(s);c.style.transform=fanXform(s,true);c.classList.add('fan-hot');} };
  const fanPick=s=>{ document.documentElement.classList.add('fan-closing'); setTimeout(()=>document.documentElement.classList.remove('fan-closing'),350); if(s<0){fanIn();return;} cur=fanIdx[s]; goTo(cur); fanIn(); };
  let fanDown=false;
  const notTable=e=>!!(e.target.closest&&e.target.closest('.deck-bar,dc-dock,[data-dynamic-coral]'));
  document.addEventListener('pointerdown',e=>{ if(!fanned||notTable(e))return; fanDown=true; if(e.pointerType==='mouse'){ const u=fanUnder(e.clientX,e.clientY); fanHover(u>=0?u:fanNearest(e.clientX,e.clientY)); } else fanHover(fanNearest(e.clientX,e.clientY)); },true);
  // hit test on unlifted footprints, topmost first; the hot card additionally answers for where it is NOW (lifted), so the
  // pointer can follow it up — a tall transparent column — without making it sticky over neighbours below
  const fanUnder=(x,y)=>{ const order=[...stack.querySelectorAll('.deck-card')].reverse(); let n=-1; for(const c of order){ if(c._fanPoly&&inPoly(x,y,c._fanPoly)){ n=cards.indexOf(c); break; } }
    if(fanHot>=0&&n!==fanHot){ const b=slotCard(fanHot).getBoundingClientRect(); const a=slotCard(fanHot)._fanRect; if(a&&b&&x>=b.left&&x<=b.right&&y>=b.top&&y<a.top+4) return fanHot; } return n; };
  document.addEventListener('pointermove',e=>{ if(!fanned||notTable(e))return; if(e.pointerType==='mouse'){ const u=fanUnder(e.clientX,e.clientY); fanHover(u>=0?u:fanNearest(e.clientX,e.clientY)); } else if(fanDown) fanHover(fanNearest(e.clientX,e.clientY)); },true);
  document.addEventListener('pointerup',e=>{ if(!fanned||notTable(e))return; fanDown=false; e.preventDefault(); e.stopPropagation(); const u=e.pointerType==='mouse'?fanUnder(e.clientX,e.clientY):-1; fanPick(u>=0?u:fanNearest(e.clientX,e.clientY)); },true);
  document.addEventListener('pointercancel',()=>{ fanDown=false; fanHover(-1); },true);
  stack.addEventListener('click',e=>{ if(document.documentElement.classList.contains('fan-closing')){e.preventDefault();e.stopPropagation();} },true);
  document.addEventListener('click',e=>{ if(!ON||openCard||fanned||document.documentElement.classList.contains('fan-closing'))return; if(e.target.closest('.deck-card,.deck-bar,.deck-seg,.deck-player,a,button,input,label,.cp-icon,#qr-holder,#qr-overlay,#qr-group,dc-dock,[data-dynamic-coral]'))return; fanOut(); });   // dock items retarget shadow clicks to the host: not the table
  let queue=0, running=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let movedOnce=false, moveTimer=null;
  function moving(){ if(!movedOnce){movedOnce=true;return;} document.documentElement.classList.add('moving'); clearTimeout(moveTimer); moveTimer=setTimeout(()=>document.documentElement.classList.remove('moving'),600); }
  let riffle=0;
  function step(n){ if(openCard)return; if(fanned){fanIn();return;} ensureQr(); queue+=n; if(!running) run(); }
  function run(){
    running=true; stack.classList.add('busy');
    const tick=()=>{
      if(queue===0){running=false; if(!stack.querySelector('.travel'))stack.classList.remove('busy'); return;}
      const dir=Math.sign(queue); const n=N; queue-=dir;
      if(dir>0){ const leaving=card(cur); if(!reduced)leaving.classList.add('travel'); cur=(cur+1)%n; paint(); if(!reduced)flight(leaving,'to-back'); }
      else { cur=(cur-1+n)%n; const rising=card(cur); if(!reduced)rising.classList.add('travel'); paint(); if(!reduced)flight(rising,'from-back'); }
      let wait=120; if(riffle){ const k=riffle-Math.abs(queue); wait=Math.round(28+92*Math.pow(k/riffle,2)); if(!queue) riffle=0; }   /* a riffle starts fast and settles into the normal pace */
      setTimeout(tick, reduced?0:wait);
    };
    tick();
  }
  // scroll: the browser owns it. The document is n pages tall with one snap point per card, so the scrollbar reads "card i of n",
  // thumb-drag / space / PageDown / Home / End all work natively, and iOS swipes are real scrolls. The pile only changes when the
  // snap index changes (never scrubbed by scroll offset): sync() queues exactly the steps that bring cur to the snapped page.
  // up to SNAPMAX cards: one snap point per card, exactly as before. Beyond: one tall rail (capped), no snaps; scroll offset → index.
  const rail=mk('div','deck-rail'); const railSize=()=>{ if(N>SNAPMAX) rail.style.height=Math.round(innerHeight+(N-1)*Math.min(innerHeight,CAP/(N-1)))+'px'; };
  if(N<=SNAPMAX){ for(let i=0;i<N;i++) rail.appendChild(mk('div','deck-snap')); } else { railSize(); addEventListener('resize',railSize); } document.body.appendChild(rail);
  try{history.scrollRestoration='manual';}catch(_){}
  const pageH=()=>Math.max(1e-6,(document.scrollingElement.scrollHeight-innerHeight)/Math.max(1,N-1));
  const goTo=i=>scrollTo({top:i*pageH(),left:0,behavior:'instant'});
  // a jump, not a walk: step() animates one card per 120ms, so a dice landing 400,000 cards away must set cur directly
  window.__deckJump=(i,o)=>{ i=Math.max(0,Math.min(N-1,i|0)); if(openCard)close(); if(fanned)fanIn(); queue=0; cur=i; paint(); goTo(i); if(LIST)listTx(); if(o&&o.open)requestAnimationFrame(()=>requestAnimationFrame(()=>{ const c=card(i); if(c.querySelector('.deck-back')) open(c); })); };
  // the dice: riffle through the real cards before the target and land on it face up, not opened.
  // Scroll goes to the target first and the riffle is queued, so sync() sees cur+queue === the scrolled index and stays quiet.
  window.__deckRiffle=(t)=>{ t=Math.max(0,Math.min(N-1,t|0)); if(openCard)close(); if(fanned)fanIn(); const K=Math.min(18,t);
    if(reduced||K===0){ window.__deckJump(t); return; } queue=0; riffle=0;
    if(LIST){ cur=t-K; paint(); goTo(t-K); listTx(); requestAnimationFrame(()=>scrollTo({top:t*pageH(),behavior:'smooth'})); return; }
    const go=()=>{ cur=t-K; paint(); goTo(t); riffle=K; step(K); };
    if(running){ const wait=()=>{ if(running) setTimeout(wait,30); else go(); }; wait(); } else go(); };
  window.__deckCount=()=>N; window.__deckCur=()=>cur;   // the editor asks which card is up, to open its row there
  let syncQueued=false;
  const sync=()=>{ syncQueued=false; if(openCard||fanned)return;
    { const ph=pageH(); const off=scrollY/ph-cur; const f=ph>=innerHeight*0.5?Math.max(-1,Math.min(1,off)):0; const top=card(cur); cards.forEach(c=>{ if(c!==top&&c.style.getPropertyValue('--peek')) c.style.removeProperty('--peek'); }); if(top&&!running&&!top.classList.contains('travel')){ const lift=Math.abs(f)<0.5?f*-180:0; top.classList.toggle('peeking',Math.abs(lift)>0.5); top.style.setProperty('--peek',lift.toFixed(1)+'px'); } } const want=Math.max(0,Math.min(N-1,Math.round(scrollY/pageH()))); const d=want-(cur+queue); if(Math.abs(d)>JUMP&&!openCard){ queue=0; cur=want; paint(); } else if(d)step(d); };   // far = a jump (thumb-drag across a long deck), near = the walk   // one swipe = one card is the browser's job (scroll-snap-stop: always); clamping here broke thumb-drag and End
  // list: the vertical scroll position IS the horizontal position — one rail, one scrollbar, one snap per card
  const listTx=()=>{ if(!ON||!LIST)return; const ph=pageH(); const k=scrollY/ph; const want=Math.max(0,Math.min(N-1,Math.round(k))); if(want!==cur){ cur=want; if(openCard&&openCard!==card(cur)) close(); paint(); }
    const w=cards[0]?cards[0].getBoundingClientRect().width:400; const s0=cards[0]?idx(cards[0]):0; const kk=N>SNAPMAX&&Math.abs(k-Math.round(k))<0.06?Math.round(k):k; stack.style.setProperty('--tx',(-(kk-s0)*(w+18)).toFixed(1)+'px');   /* a long deck's card is ~17px of scroll and scrollY is whole pixels: at rest, sit exactly on the card */   /* the row starts at the window's first card */ if(Date.now()-homing>=800) document.documentElement.classList.toggle('list-away',scrollY>ph/2); };
  // a long deck has no snap points (SNAPMAX): when scrolling stops between two cards, glide to the nearer one
  let settleT=0; const settle=()=>{ if(N<=SNAPMAX)return; clearTimeout(settleT); settleT=setTimeout(()=>{ const ph=pageH(); const k=Math.round(scrollY/ph); if(Math.abs(scrollY-k*ph)>0.5) scrollTo({top:k*ph,behavior:'smooth'}); },160); };
  addEventListener('scroll',()=>{ if(!ON)return; settle(); if(LIST){ listTx(); return; } if(!syncQueued){syncQueued=true;requestAnimationFrame(sync);} },{passive:true}); addEventListener('resize',listTx); goTo(0); listTx();
  addEventListener('keydown',e=>{ if(!ON)return; if(e.key==='Escape'){if(fanned){fanIn();return;} close();const p=document.querySelector('.deck-player');p&&p.remove();return;} if(openCard){ if(SWIPE&&e.key==='ArrowLeft'&&!LIST&&openCard===card(N-1)){e.preventDefault();close();} return; }
    if(SWIPE&&e.key==='ArrowRight'&&!LIST&&cur===N-1){e.preventDefault(); if(!e.repeat)endFlip('key'); else bump(1); return;}   /* a held key that ARRIVES at the end does not flip it (e.repeat) */
    if(e.key==='ArrowRight'){e.preventDefault();scrollBy({top:pageH(),behavior:'smooth'});} if(e.key==='ArrowLeft'){e.preventDefault();scrollBy({top:-pageH(),behavior:'smooth'});}
    if(e.key==='Enter'){if(fanned){fanIn();return;} if(e.target&&e.target.closest&&e.target.closest('a,button,input,select,textarea,[role="button"]'))return; /* Enter on a control is that control's: on the switcher it used to turn the top card over as well, and the card then took focus away from the switcher */ const c=card(cur); if(c.querySelector('.deck-back')) open(c);} });
  // ── sideways swipes (Magic Trackpad two fingers, Magic Mouse one finger, a phone in list) ──────────────
  // macOS turns a sideways swipe the page does not stop into "swipe between pages" (browser back/forward), and it
  // decides on the FIRST wheel event of the gesture. So every sideways event is preventDefault()ed from the first
  // one — except a FRESH gesture that starts on the first card going back: that one is left to the browser, and
  // the visitor goes back a page. The gesture keeps one meaning, "previous": the previous card, else the previous page.
  // A gesture = wheel events less than GAP ms apart. macOS momentum events arrive closer than that, so the
  // momentum of the swipe that ARRIVES at an end never counts as a new gesture there (the same rule flips the last
  // card only for a gesture that started on it). Stack: one gesture = one card. List: a free scroll that settles on a card.
  // overscroll-behavior-x would also stop the browser, but overscroll-behavior on this root made WebKit swallow the
  // wheel over the empty table (deck.css, top of file), so it is not used. Vertical scrolling is untouched: on a desktop a
  // hard fling passing several cards is deliberate.
  // Tried on a Mac (Safari, Magic Trackpad): sideways swipes, quick repeats, and the last-card flip, which a fling
  // arriving at the end does not trigger.
  const SWIPE=true;
  if(SWIPE) document.documentElement.classList.add('swipe');
  function bump(dir){ const c=card(cur); if(!c||!c.animate)return; c.animate([{translate:'0 0'},{translate:(dir>0?-16:16)+'px 0'},{translate:'0 0'}],{duration:300,easing:'cubic-bezier(.3,0,.2,1)'}); }
  function endFlip(via){ const c=card(N-1); if(cur!==N-1||!c||openCard)return; if(!c.querySelector('.deck-back')){bump(1);return;} open(c); }
  const GAP=180, HOLD=400, STEP=26, html=document.documentElement; let lastAct=0;
  const canScrollX=(el,dx)=>{ for(;el&&el!==document.body&&el!==html;el=el.parentElement){ const cs=getComputedStyle(el); if(/(auto|scroll)/.test(cs.overflowX)&&el.scrollWidth>el.clientWidth+1){ if(dx>0?el.scrollLeft+el.clientWidth<el.scrollWidth-1:el.scrollLeft>0)return true; } } return false; };
  const settle2=()=>{ html.style.scrollSnapType=''; const ph=pageH(); scrollTo({top:Math.round(scrollY/ph)*ph,behavior:'smooth'}); };
  let G=null;
  addEventListener('wheel',e=>{
    if(!ON||!SWIPE||e.ctrlKey||fanned)return;                                   // ctrl+wheel = pinch zoom
    const k=e.deltaMode===1?16:e.deltaMode===2?innerHeight:1, dx=e.deltaX*k, dy=e.deltaY*k;
    const now=e.timeStamp||performance.now();   // when the event HAPPENED: a stalled page handles a swipe's events late and far apart, but they were made ~16 ms apart, and that is what decides the gesture
    // a gesture also stays one gesture for HOLD ms after it acted: a flip or a turn-back stalls the page, the stall
    // stretches a momentum gap past GAP, and the rest of the same swipe would act a second time (caught in testing)
    if(!G||(now-G.t>GAP&&now-lastAct>HOLD)){ if(G&&G.axis==='x'&&LIST)settle2(); G={t:now,axis:'',acc:0,fired:false,startCur:cur,atTop:LIST?scrollY<=2:cur===0}; }
    G.t=now; clearTimeout(G.timer); const g=G; G.timer=setTimeout(()=>{ if(g.axis==='x'&&LIST)settle2(); },GAP);   /* the timer only settles list; it must not end the gesture, or it would bypass HOLD (caught in testing: a turn-back stalled 214 ms, the timer fired, and the same swipe stepped back a card) */
    if(!G.axis){ if(Math.abs(dx)>Math.abs(dy)){ if(canScrollX(e.target,dx)){G.axis='inner';return;} G.axis=(dx<0&&G.atTop&&!openCard)?'release':'x'; } else if(dy!==0) G.axis='y'; else return; }
    if(G.axis==='inner'||G.axis==='release')return;                     // an inner scroller's, or the browser's
    if(G.axis==='y'){ if(!LIST&&!openCard&&G.startCur===N-1&&dy>0&&scrollY>=html.scrollHeight-innerHeight-2){ G.acc+=dy; if(!G.fired&&G.acc>STEP*2){G.fired=true;lastAct=now;endFlip('wheel-y');} } return; }
    e.preventDefault();                                                 // ours, from the first event: no history swipe
    if(LIST){ if(openCard)return; html.style.scrollSnapType='none'; scrollBy({top:dx,behavior:'instant'}); return; }
    // a new swipe can start while the last one's momentum is still arriving: macOS keeps the stream going with no gap, so it
    // looked like one gesture and the second swipe did nothing until the pointer moved (moving it ends momentum). Momentum only
    // decays; a new finger ramps back up. So once the deltas have fallen to half their peak, a clear rise is a new swipe.
    if(G.fired){ const a=Math.abs(dx); if(!G.decay){ G.peak=Math.max(G.peak||0,a); if(a<G.peak*0.5){G.decay=true;G.min=a;} return; }
      if(a<G.min){G.min=a;return;} if(!(a>=G.min*2&&a-G.min>=6))return;
      G.fired=false; G.acc=0; G.decay=false; G.peak=0; G.startCur=cur; }
    G.acc+=dx; if(Math.abs(G.acc)<STEP)return; G.fired=true; lastAct=now; const dir=Math.sign(G.acc);
    if(openCard){ if(dir<0)close(); return; }                           // swiping back on an open card turns it back
    if(dir>0){ if(cur<N-1){ flingDir=1; scrollTo({top:(cur+1)*pageH(),behavior:'instant'}); } else if(G.startCur===N-1) endFlip('wheel-x'); else bump(1); }
    else { if(cur>0){ flingDir=-1; scrollTo({top:(cur-1)*pageH(),behavior:'instant'}); } else bump(-1); }
  },{passive:false});
  // list on a phone: a sideways drag moves the row the way the finger goes (it moved only on an up/down drag before).
  // touch-action:pan-y (deck4.css) hands sideways moves to this code and keeps up/down native.
  let LD=null;
  stack.addEventListener('pointerdown',e=>{ if(!SWIPE||!LIST||openCard||e.pointerType!=='touch')return; LD={id:e.pointerId,x0:e.clientX,y0:e.clientY,s0:scrollY,on:false,lx:e.clientX,lt:performance.now(),v:0}; },true);
  document.addEventListener('pointermove',e=>{ if(!LD||e.pointerId!==LD.id)return; const dx=e.clientX-LD.x0, dy=e.clientY-LD.y0;
    if(!LD.on){ if(Math.abs(dx)<8&&Math.abs(dy)<8)return; if(Math.abs(dy)>Math.abs(dx)){LD=null;return;} LD.on=true; html.style.scrollSnapType='none'; }
    const c=card(cur), w=(c?c.getBoundingClientRect().width:300)+18, t=performance.now();
    LD.v=(e.clientX-LD.lx)/Math.max(1,t-LD.lt); LD.lx=e.clientX; LD.lt=t;
    scrollTo({top:LD.s0-dx*(pageH()/w),behavior:'instant'}); e.preventDefault(); },{passive:false});
  const ldEnd=e=>{ if(!LD||(e&&e.pointerId!==LD.id))return; const d=LD; LD=null; if(!d.on)return; html.style.scrollSnapType=''; const ph=pageH();
    let to=Math.round(scrollY/ph); if(Math.abs(d.v)>0.35) to=Math.round(d.s0/ph)+(d.v<0?1:-1);   // a flick moves one card the way it went
    to=Math.max(0,Math.min(N-1,to)); scrollTo({top:to*ph,behavior:'smooth'});
    const kill=ev=>{ev.stopPropagation();ev.preventDefault();}; stack.addEventListener('click',kill,{capture:true,once:true}); setTimeout(()=>stack.removeEventListener('click',kill,true),400); };   /* the drag's own click, if the browser sends one; removed after, so it never eats the next real tap */
  document.addEventListener('pointerup',ldEnd,true); document.addEventListener('pointercancel',ldEnd,true);
  // ---- leaving for the wall, and coming back ----
  // what the pile answers the page with (the dice asks these); taken away on the wall, where there is no pile to jump
  const API={}; for(const k of ['__mdFirst','__mdCount','__deckJump','__deckRiffle','__deckCount','__deckCur']) API[k]=window[k];
  const seatOf=c=>Math.max(0,cells.indexOf(c));   // a tile's card has the tile's own place in the page as its number
  // leave: put a held card back, fold the fan, stop answering, and send every tile home. Returns the tile of the card that was up.
  const leave=()=>{ if(fanned)fanIn(); if(openCard)close(); const up=cells.length?cells[Math.min(cur,cells.length-1)]:null;
    queue=0; drag=null; LD=null; hx=-1; ON=false; stack.classList.remove('hov'); root.classList.remove('list-away','fan','fan-closing','moving','open');
    cards.forEach(c=>c.style.removeProperty('--peek')); rehome(true); for(const k in API) delete window[k]; return up; };
  // enter: the tiles take their seats again and the pile is dealt, open on the card whose tile was in the middle of the wall
  const enter=c=>{ ON=true; LIST=mode==='list'; rehome(false); Object.assign(window,API); try{history.scrollRestoration='manual';}catch(_){}
    fit(); railSize(); queue=0; cur=seatOf(c); dealIn(); goTo(cur); listTx(); };
  if(at){ cur=seatOf(at); paint(); goTo(cur); listTx(); }
  return {enter,leave,close,layout:window.__deckLayout};
  }
  }
})();
