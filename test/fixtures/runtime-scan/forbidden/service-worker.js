// Fixture for scripts/runtime-scan.mjs, rule service-worker (format: see cookie-write.js).
navigator.serviceWorker.register("/sw.js"); // expect service-worker
navigator.serviceWorker?.register(url); // expect service-worker
navigator["serviceWorker"]["register"](url); // expect service-worker
window.navigator.serviceWorker.register(url, { scope: "/" }); // expect service-worker
var sw = navigator.serviceWorker; // expect service-worker
var { serviceWorker } = navigator; // expect service-worker
navigator.serviceWorker.register(a),navigator.serviceWorker.register(b) // expect service-worker x2
