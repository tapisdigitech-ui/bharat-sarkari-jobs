// Bundles tests/live/browser-probe.ts for a browser (global `BSJ`). Test tooling for the live pilot only — never shipped.
import { build } from "esbuild";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
await build({
  entryPoints: [path.join(root, "tests/live/browser-probe.ts")], bundle: true, format: "iife", globalName: "BSJ", platform: "browser",
  target: "es2022", minify: true, outfile: path.join(root, "tests/live/out/probe.js"), legalComments: "none",
  alias: { "@": path.join(root, "src"), "node:crypto": path.join(root, "tests/live/shims/crypto.ts"), unpdf: path.join(root, "tests/live/shims/unpdf.ts") },
  define: { "process.env.NODE_ENV": '"production"' },
});
console.log("built");
