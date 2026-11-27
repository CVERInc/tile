// Fixture for scripts/runtime-scan.mjs, rule eval (format: see cookie-write.js).
eval("1 + 1"); // expect eval
eval ( code ); // expect eval
window.eval(code); // expect eval
globalThis["eval"](code); // expect eval
(0, eval)(code); // expect eval
var e = eval; // expect eval
run({ fn: eval }); // expect eval
eval(a),(0,eval)(b),self.eval(c) // expect eval x3
class Base extends eval(code) {} // expect eval
const o = { run() { return eval(code) } }; // expect eval
