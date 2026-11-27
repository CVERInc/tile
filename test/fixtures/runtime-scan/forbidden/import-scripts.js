// Fixture for scripts/runtime-scan.mjs, rule import-scripts (format: see cookie-write.js).
importScripts("a.js"); // expect import-scripts
self.importScripts(url); // expect import-scripts
self["importScripts"](url); // expect import-scripts
var is = importScripts; // expect import-scripts
importScripts(a),self.importScripts(b) // expect import-scripts x2
