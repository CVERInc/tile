// Fixture for scripts/runtime-scan.mjs: the clean bundle. Every construct here is a near miss of a
// forbidden one, or a forbidden one hidden where it is not code, and the scan must find NOTHING.
//
// In a comment: document.cookie = "x"; eval("x"); new Function("x"); import(url); new Worker(u);
/* and a block comment: document['cookie'] = 1; setTimeout("x"); caches.open("v1");
   navigator.serviceWorker.register("/sw.js"); document.createElement("script"); s.src = u; */
const strings = [
  "document.cookie = 'a=1'", 'eval("1")', "new Function('x')", "import(url)", "importScripts('a.js')",
  'document.createElement("script")', "s.src = u", "caches.open('v1')", "new SharedWorker(u)",
  'cookieStore.set("a", "1")', "document.domain = 'x'", 'setTimeout("x")', "it's `quoted` \"twice\"",
];
const html = `<script src="x.js"></script> document.cookie = "${strings.length}"; eval(x) import(y)`;
const nested = `outer ${`inner eval("x") ${strings[0]} new Worker(u)`} document.domain`;
// Regular expressions are not code either, quotes inside them included.
const re1 = /document\.cookie\s*=|eval\(|new Function/g, re2 = /'/, re3 = /["`]/, re4 = /[/]import\(/;
const ratio = width / 2 / height; const half = (width) / 2; const idx = list[0] / 3;
if (re2.test(html)) console.log(/import\(x\)/.source, "caches.open('x')");
// Reading a cookie is not writing one; comparing is not assigning.
console.log(document.cookie, document.cookie === "a=1", document["cookie"] == "b", !document.cookie);
// Other objects' look-alike properties.
config.domain = "example.com"; url.domain; obj.caches = 1; store.caches.get(k); thing.eval(x);
lib.Function = 1; ns.Worker = 2; ns.importScripts(x); ctx.src; el.getAttribute("src");
img.srcset = set; el.dataset.src; el.srcdoc; a.cookies = 2; jar.cookieJar = 3;
// Object keys and the like.
const keys = { eval: 1, caches: 2, Worker: 3, importScripts: 4, Function: 5, cookieStore: 6, setTimeout: 7 };
// Function used for what it is, not to construct one.
if (f instanceof Function) Function.prototype.toString.call(f);
// Timers with a function, elements that are not scripts, imports of one literal.
setTimeout(() => tick(), 10); setInterval(tick, 1000); window.setTimeout(tick);
document.createElement("div"); document.createElement("scripts"); document.createElementNS(svg, "path");
el.setAttribute("href", u); el.setAttribute("data-src", u); el.setAttributeNS(null, "x", u);
import("./literal.js"); import('./literal.js'); import(`./literal.js`); import("./x.js", { with: { type: "json" } });
console.log(import.meta.url, new URL("./a.js", import.meta.url).href);
// A service worker that is already there, read and not registered.
navigator.serviceWorker.controller; navigator.serviceWorker.ready.then(noop);
// The words as identifiers of other things.
const cookie = 1, domain = 2, src = 3, evaluate = 4, Functions = 5, workers = 6, cachesList = 7;
x = a?.5:1;
// A timer handed a parenthesised function is still handed a function.
setTimeout((tick), 10); setTimeout((() => tick("a")), 10); setInterval(((fn)), 1);
// Methods and accessors that happen to share a forbidden global's name are definitions, not references.
class Host { eval(x) { return x } static Function(a) {} async caches() {} *Worker() {} importScripts() {} }
const api = { eval(x) { return x }, get SharedWorker() { return 1 }, set cookieStore(v) {}, setTimeout(f) {} };
