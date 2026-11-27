// Fixture for scripts/runtime-scan.mjs, rule cookie-store (format: see cookie-write.js).
cookieStore.set("a", "1"); // expect cookie-store
window.cookieStore.delete("a"); // expect cookie-store
self["cookieStore"].get("b"); // expect cookie-store
var cs = cookieStore; // expect cookie-store
cookieStore.set("a","1"),globalThis.cookieStore.get("b") // expect cookie-store x2
const { cookieStore: ck1 } = window; ck1.set('a', '1'); // expect cookie-store
