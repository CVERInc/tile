// Fixture for scripts/runtime-scan.mjs, rule cache-storage (format: see cookie-write.js).
caches.open("v1"); // expect cache-storage
self.caches.match(request); // expect cache-storage
window["caches"].keys(); // expect cache-storage
var c = caches; // expect cache-storage
caches.open("a").then(b),caches.delete("c") // expect cache-storage x2
