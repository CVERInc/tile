// Fixture for scripts/runtime-scan.mjs, rule worker (format: see cookie-write.js).
new Worker("w.js"); // expect worker
new SharedWorker(url); // expect worker
new Worker(new URL("./w.js", import.meta.url), { type: "module" }); // expect worker
new window.Worker(url); // expect worker
new self["SharedWorker"](url); // expect worker
var W = Worker; // expect worker
new Worker(a),new SharedWorker(b),new globalThis.Worker(c) // expect worker x3
const { Worker: W1 } = window; new W1(u); // expect worker
const mk = ({ SharedWorker: S }) => new S(u); // expect worker
