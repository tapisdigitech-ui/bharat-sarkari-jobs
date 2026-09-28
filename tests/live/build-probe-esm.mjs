// ESM variant of the probe for pasting into a page (node-html-parser @9.0.4 from jsdelivr; our code inline).
import { build } from "esbuild";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
for (const [name, ids] of [["probe.esm.js", true], ["probe.esm.readable.js", false]]) {
  const plain = !ids;
  await build({
    entryPoints: [path.join(root, "tests/live/browser-probe.ts")], bundle: true, format: "esm", platform: "browser", target: "es2022",
    minifyWhitespace: !plain, minifySyntax: true, minifyIdentifiers: ids, outfile: path.join(root, "tests/live/out", name), legalComments: "none",
    alias: { "@": path.join(root, "src"), "node:crypto": path.join(root, "tests/live/shims/crypto.ts"), unpdf: path.join(root, "tests/live/shims/unpdf.ts") },
    plugins: [{ name: "cdn-nhp", setup(b) { b.onResolve({ filter: /^node-html-parser$/ }, () => ({ path: "https://cdn.jsdelivr.net/npm/node-html-parser@9.0.4/+esm", external: true })); } }],
  });
}

// "Paste" form: the module body wrapped in one async function, so it can be sent as-is to a page's console (CDP evaluate)
// and its own source recovered with Function.prototype.toString() for re-use on the next official site.
import fs from "node:fs";
{
  const src = fs.readFileSync(path.join(root, "tests/live/out/probe.esm.readable.js"), "utf8");
  let inTpl = false; const out = [];
  for (const l of src.split("\n")) {
    const t = inTpl ? l : l.replace(/^\s+/, "");
    if (!inTpl && t.startsWith("//")) continue;
    if (t.length || inTpl) out.push(t);
    if (((l.match(/(?<!\\)`/g) || []).length) % 2) inTpl = !inTpl;
  }
  let body = out.join("\n")
    .replace(/^import \{ parse(?: as (\w+))? \} from "(https:[^"]+)";$/gm, (_m, alias, url) => `const { parse: ${alias ?? "parse"} } = await import("${url}");`)
    .replace(/^export \{([\s\S]*?)\};\s*$/m, (_m, names) => `return {${names.trim().replace(/\n/g, " ")}};`);
  if (/^\s*(import|export)\b/m.test(body)) throw new Error("module syntax left in paste form");
  fs.writeFileSync(path.join(root, "tests/live/out/probe.paste.js"), `window.__bsjSrc = async function () {\n${body}\n};\nwindow.BSJ = await window.__bsjSrc();\nObject.keys(window.BSJ).join(",");\n`);
}
console.log("paste form written");
