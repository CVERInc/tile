// web shim：讓未改的 tile-core（Obsidian 風味）在瀏覽器跑。無 fork——核心不動,缺的 API 這裡補。
const set = (e,o={})=>{ if(o.cls) e.className=o.cls; if(o.text!=null) e.textContent=o.text;
  for(const k of ['type','value','placeholder','href','title','id']) if(o[k]!=null) e[k]=o[k];
  if(o.attr) for(const k in o.attr) e.setAttribute(k,o.attr[k]); return e; };
const mk=(parent,tag,o)=>{ const e=set(document.createElement(tag),o); parent.appendChild(e); return e; };
const P=HTMLElement.prototype;
P.createEl   = function(tag,o){ return mk(this,tag,o); };
P.createDiv  = function(o){ return mk(this,'div',o); };
P.createSpan = function(o){ return mk(this,'span',o); };
P.empty      = function(){ while(this.firstChild) this.removeChild(this.firstChild); };
P.addClass   = function(...c){ this.classList.add(...c); return this; };
P.removeClass= function(...c){ this.classList.remove(...c); return this; };
P.toggleClass= function(c,v){ this.classList.toggle(c,v); return this; };
P.setText    = function(t){ this.textContent=t; return this; };
P.setAttr    = function(k,v){ this.setAttribute(k,v); return this; };
P.detach     = function(){ this.remove(); return this; };
// setIcon: render real inline Lucide SVGs (MIT) for the editor toolbar — core does `if(icon) setIcon(...)`
// and never falls back to text, so without these the toolbar buttons are empty. currentColor = inherits text color.
const _svg = (b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>',
  'heading-1': '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/>',
  'heading-2': '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>',
  'heading-3': '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/>',
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
  strikethrough: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
  list: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  'list-ordered': '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  'list-checks': '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>',
  'text-quote': '<path d="M17 5H3"/><path d="M21 12H8"/><path d="M21 19H8"/><path d="M3 12v7"/>',
  table: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'list-tree': '<path d="M8 5h13"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="M3 10a2 2 0 0 0 2 2h3"/><path d="M3 5v12a2 2 0 0 0 2 2h3"/>',
  'square-m': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 16V8l4 5 4-5v8"/>',
  'square-code': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 9-2 3 2 3"/><path d="m15 9 2 3-2 3"/>',
  'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'lock-open': '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  video: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  'check-big': '<path d="M20 6 9 17l-5-5"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  replace: '<rect width="8" height="8" x="2" y="2" rx="1"/><path d="M14 14a2 2 0 0 1 2-2h4"/><path d="m17 9 3 3-3 3"/>',
  'replace-all': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><path d="M10 7h4a2 2 0 0 1 2 2v1"/><path d="M14 17h-4a2 2 0 0 1-2-2v-1"/>',
};
globalThis.setIcon = (el, name) => { el.setAttribute('data-icon', name); el.innerHTML = ICONS[name] ? _svg(ICONS[name]) : ''; };
globalThis.lucideSvg = (name) => ICONS[name] ? _svg(ICONS[name]) : '';   // raw svg string — for innerHTML composition (toasts/status text)
globalThis.Modal   = class { constructor(){ this.contentEl=document.createElement('div'); } open(){} close(){} onOpen(){} onClose(){} };
globalThis.Platform = { isMobile:false, isDesktop:true, isMacOS:true, isIosApp:false, isAndroidApp:false };
globalThis.Notice  = class { constructor(m){ this.message=m; } };
