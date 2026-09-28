import { selftest } from "./selftest-core";
import { FIX_HTML, FIX_TEXT } from "./selftest-fixture";
console.log(JSON.stringify(selftest(FIX_HTML, FIX_TEXT)));
