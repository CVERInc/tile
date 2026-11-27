// Fixture for scripts/runtime-scan.mjs, rule unscannable (format: see cookie-write.js). NOT valid
// JavaScript, on purpose: what the scan cannot read is a finding, never a silent stop. Each finding
// covers the rest of its line, so the expectation comment sits inside it.
<!-- an HTML-like comment opening // expect unscannable
var a = 1;
--> an HTML-like comment closing, first on its line // expect unscannable
var b = 'a string that never closes; eval(code) // expect unscannable
var c = /[a regex that never closes; eval(code) // expect unscannable
/* a block comment that never closes; eval(code) // expect unscannable
eval(code);
