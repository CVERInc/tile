// Fixture for scripts/runtime-scan.mjs, rule dynamic-import (format: see cookie-write.js).
import(url); // expect dynamic-import
import("./parts/" + name + ".js"); // expect dynamic-import
import(`./parts/${name}.js`); // expect dynamic-import
import(new URL("./x.js", import.meta.url).href); // expect dynamic-import
import(/* a comment */ url); // expect dynamic-import
import ( url , { with: { type: "json" } } ); // expect dynamic-import
import(a).then(b),import(c+".js") // expect dynamic-import x2
