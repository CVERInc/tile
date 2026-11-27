// Fixture for scripts/runtime-scan.mjs, rule function-constructor (format: see cookie-write.js).
new Function("return 1"); // expect function-constructor
Function("return 2")(); // expect function-constructor
new window.Function("a", "return a"); // expect function-constructor
new self["Function"]("return 3"); // expect function-constructor
var F = Function; // expect function-constructor
Function.call(null, "return 4"); // expect function-constructor
Function.apply(null, ["return 5"]); // expect function-constructor
Reflect.construct(Function, ["return 6"]); // expect function-constructor
new Function("a"),Function("b")() // expect function-constructor x2
