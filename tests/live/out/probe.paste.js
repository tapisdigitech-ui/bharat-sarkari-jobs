window.__bsjSrc = async function () {
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function() {
if (err) throw err[0];
try {
return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
} catch (e) {
throw err = [e], e;
}
};
var __export = (target, all) => {
for (var name in all)
__defProp(target, name, { get: all[name], enumerable: !0 });
};
var unpdf_exports = {};
__export(unpdf_exports, {
extractText: () => extractText,
getDocumentProxy: () => getDocumentProxy
});
async function pdfjs() {
return lib || (lib = await import(
/* @vite-ignore */
CDN + "pdf.min.mjs"
), lib.GlobalWorkerOptions.workerSrc = CDN + "pdf.worker.min.mjs", lib);
}
async function getDocumentProxy(data) {
return (await pdfjs()).getDocument({ data, isEvalSupported: !1, useSystemFonts: !0 }).promise;
}
async function getPageText(pdf, n) {
return (await (await pdf.getPage(n)).getTextContent()).items.filter((i) => i.str != null).map((i) => i.str + (i.hasEOL ? `
` : "")).join("");
}
function normalizeMergedText(texts) {
return texts.join(`
`).replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, `
`).replace(/\n{3,}/g, `

`);
}
async function extractText(pdf, o = {}) {
let texts = [];
for (let i = 1; i <= pdf.numPages; i++) texts.push(await getPageText(pdf, i));
return { totalPages: pdf.numPages, text: o.mergePages ? normalizeMergedText(texts) : texts };
}
var CDN, lib, init_unpdf = __esm({
"tests/live/shims/unpdf.ts"() {
"use strict";
CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.1.200/build/", lib = null;
}
});
const { parse: parse2 } = await import("https://cdn.jsdelivr.net/npm/node-html-parser@9.0.4/+esm");
var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }, MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)", pad = (n) => String(n).padStart(2, "0");
function iso(y, m, d) {
if (y < 100 && (y += 2e3), y < 2e3 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
let dt = new Date(Date.UTC(y, m - 1, d));
return dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d ? null : `${y}-${pad(m)}-${pad(d)}`;
}
function findDates(s) {
let out = [], seen = /* @__PURE__ */ new Set(), push = (index, raw, v2) => {
v2 && !seen.has(index) && (seen.add(index), out.push({ iso: v2, index, raw }));
};
for (let m of s.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/g)) push(m.index, m[0], iso(Number(m[3]), Number(m[2]), Number(m[1])));
for (let m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s.-]*${MON}[\\s.,-]*(\\d{4})\\b`, "gi"))) push(m.index, m[0], iso(Number(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()] ?? MONTHS[m[2].slice(0, 4).toLowerCase()], Number(m[1])));
for (let m of s.matchAll(new RegExp(`\\b${MON}[\\s.]+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})\\b`, "gi"))) push(m.index, m[0], iso(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2])));
for (let m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m.index, m[0], iso(Number(m[1]), Number(m[2]), Number(m[3])));
return out.sort((a, b) => a.index - b.index);
}
function segments(text2) {
return text2.split(/\n|(?<=\.)\s{2,}|\s\|\s|\t/).map((l) => l.trim()).filter(Boolean);
}
function labelledDates(text2, label, window = 120) {
let segs = segments(text2), out = [];
for (let i = 0; i < segs.length; i++) {
let m = label.exec(segs[i]);
if (!m) continue;
let after = segs[i].slice(m.index + m[0].length, m.index + m[0].length + window), ds = findDates(after), evidence = segs[i], pre = segs[i].slice(Math.max(0, m.index - 25), m.index), span = pre + segs[i].slice(m.index, m.index + m[0].length + (ds[0]?.index ?? after.length));
!ds.length && !/\d/.test(after) && after.length < 40 && !/\bas\s+(?:under|follows)\b/i.test(after) && segs[i + 1] && (ds = findDates(segs[i + 1].slice(0, window)), evidence = `${segs[i]} ${segs[i + 1]}`, span = `${pre}${segs[i].slice(m.index)} ${segs[i + 1].slice(0, ds[0]?.index ?? 0)}`), ds.length && out.push({ iso: ds[0].iso, evidence: evidence.slice(0, 200), span });
}
return out;
}
function pickDate(text2, label, name, issues) {
let c = labelledDates(text2, label);
if (label === L.last && (c = c.filter((x) => !NOT_APPLICATION_WINDOW.test(x.span))), !c.length) return;
let distinct = [...new Set(c.map((x) => x.iso))];
return distinct.length > 1 ? (issues.push(`Several different ${name} dates in the source (${distinct.join(", ")}) \u2014 check which one is current (a corrigendum may have changed it)`), { value: c[c.length - 1].iso, confidence: 0.4, evidence: c[c.length - 1].evidence }) : { value: c[0].iso, confidence: 1, evidence: c[0].evidence };
}
var L = {
last: /\b(last|closing|end)\s*date\b[^:\n]{0,60}?(?:application|registration|apply|submission|online|receipt|fee)?|\bdate\s+of\s+closing\b|\bclosing\s+date\b|\blast\s+date\s+(?:for|of)\b/i,
start: /\b(?:(?:start(?:ing)?|opening|commencement)\s+(?:date\s+)?(?:of|for)\s+(?:online\s+)?(?:application|registration|submission)|(?:online\s+)?(?:application|registration)s?\s+(?:start|begin|open)s?(?:\s+(?:from|on))?|opening\s+date)\b/i,
notif: /\b(?:date\s+of\s+(?:notification|advertisement|publication|issue)|notification\s+date|advertisement\s+date|publication\s+date)\b/i,
correction: /\b(?:correction|modification|edit)\s+(?:window|date|facility)\b/i,
exam: /\b(?:(?:tentative\s+)?(?:date|schedule)\s+of\s+(?:the\s+)?(?:computer[\s-]based\s+|written\s+|preliminary\s+|main\s+)?(?:exam(?:ination)?|test|cbt)|(?:exam(?:ination)?|cbt|written\s+test)\s+(?:date|will\s+be\s+(?:held|conducted)\s+on))\b/i,
admit: /\b(?:admit\s+card|hall\s+ticket|e-?admit\s+card|call\s+letter)s?\b[^:\n]{0,40}?(?:release|available|issue|download)/i,
result: /\bresults?\s+(?:date|declaration|will\s+be\s+declared|declared\s+on|announced)\b/i,
objStart: /\b(?:objections?|representations?|challenge)\b[^:\n]{0,40}?\b(?:from|start|open)/i,
objLast: /\b(?:last\s+date\s+(?:for|of|to)\s+(?:submit(?:ting)?\s+)?(?:objections?|representations?|challeng))|\bobjections?\b[^:\n]{0,40}?\b(?:till|upto|up\s+to|last\s+date|by)\b/i
}, NOT_APPLICATION_WINDOW = /\bfee\s*(?:last|closing|end)\s*date\b|\b(?:correction|modification|edit(?:ing)?|fee\s+payment|payment\s+of\s+(?:the\s+)?fee|making\s+(?:online\s+)?(?:fee\s+)?payment|challan)\b/i;
function applicationRange(text2) {
for (let seg of segments(text2)) {
if (!/\b(?:application|registration|apply|online)\b/i.test(seg) || NOT_APPLICATION_WINDOW.test(seg)) continue;
let pairs = [/\bfrom\b(.{0,40}?)\b(?:to|till|upto|up\s+to)\b(.{0,40})/i.exec(seg), ...seg.matchAll(/(\S{6,12})\s+(?:to|till|upto|up\s+to|–|-)\s+(\S{6,40})/gi)];
for (let m of pairs) {
if (!m) continue;
let a = findDates(m[1])[0], b = findDates(m[2])[0];
if (a && b && a.iso <= b.iso) return { start: { value: a.iso, confidence: 1, evidence: seg.slice(0, 200) }, last: { value: b.iso, confidence: 1, evidence: seg.slice(0, 200) } };
}
}
}
var HEAD_CHARS = 4e3, REF = "([A-Z0-9][A-Za-z0-9/().\\-\u2013]{0,38}[A-Za-z0-9)])";
function extractAdvertisementNo(text2) {
let head = text2.slice(0, HEAD_CHARS), tries = [
[new RegExp(`\\b(?:advt\\.?|advertisement|adv\\.|employment\\s+notice|cen|recruitment\\s+notice)\\s*(?:no\\.?|number|num\\.?)\\s*[:.\u2013-]?\\s*${REF}`, "i"), head, 1],
[new RegExp(`\\b(?:f\\.?|file)\\s*no\\.?\\s*[:.\u2013-]?\\s*${REF}`, "i"), head, 1],
[new RegExp(`\\b(?:notification|notice)\\s*(?:no\\.?|number|num\\.?)\\s*[:.\u2013-]?\\s*${REF}`, "i"), head, 0.8],
[new RegExp(`\\b(?:advt\\.?|advertisement)\\s*(?:no\\.?|number)\\s*[:.\u2013-]?\\s*${REF}`, "i"), text2, 0.8]
];
for (let [re, where, confidence] of tries) {
let m = re.exec(where);
if (!m) continue;
let v2 = m[1].replace(/[–]/g, "-").replace(/\s+/g, "");
if (!(!/\d/.test(v2) || v2.length < 2))
return { value: v2, confidence, evidence: m[0].slice(0, 120) };
}
}
function extractVacancies(text2, issues) {
for (let m of text2.matchAll(/\btotal(?:\s+(?:no\.?\s+of\s+)?(?:vacanc(?:y|ies)|posts?))?\s*[:=–-]?\s*((?:\d{1,6}\s+){5,}\d{1,6})/gi)) {
let n = m[1].trim().split(/\s+/).map(Number);
for (let k = 5; k < n.length; k++) {
let cats = n.slice(k - 5, k);
if (n[k] > 0 && n[k] < 5e5 && cats.reduce((a, b) => a + b, 0) === n[k]) return { value: n[k], confidence: 1, evidence: m[0].slice(0, 120) };
}
}
for (let m of text2.matchAll(/((?:\b(?:UR|GEN(?:ERAL)?|OBC|SC|ST|EWS)\b\s*[:=–-]?\s*\d{1,6}[\s,;/]*){3,})\btotal\b\s*[:=–-]?\s*(\d{1,6})\b/gi)) {
let parts = [...m[1].matchAll(/\b(?:UR|GEN(?:ERAL)?|OBC|SC|ST|EWS)\b\s*[:=–-]?\s*(\d{1,6})/gi)].map((p) => Number(p[1])), total = Number(m[2]);
if (total > 0 && total < 5e5)
return parts.reduce((a, b) => a + b, 0) === total ? { value: total, confidence: 1, evidence: m[0].slice(0, 120) } : (issues.push(`The category figures (${parts.join(" + ")}) do not add up to the stated total ${total} \u2014 check the vacancy table`), { value: total, confidence: 0.5, evidence: m[0].slice(0, 120) });
}
let labelled = [...text2.matchAll(/\b(?:total\s+(?:no\.?\s+of\s+)?(?:posts?|vacanc(?:y|ies))|(?:no\.?|number)\s+of\s+(?:posts?|vacanc(?:y|ies))|total\s+vacanc(?:y|ies))\s*[:=–-]?\s*(\d{1,3}(?:,\d{2,3})*|\d{1,6})\b/gi)], nums = [...new Set(labelled.map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n > 0 && n < 5e5))];
if (nums.length === 1) return { value: nums[0], confidence: 1, evidence: labelled[0][0].slice(0, 120) };
if (nums.length > 1)
return issues.push(`More than one vacancy total mentioned (${nums.join(", ")}) \u2014 confirm the correct total`), { value: Math.max(...nums), confidence: 0.4, evidence: labelled.map((m) => m[0]).join(" \xB7 ").slice(0, 200) };
let tentative = /\b(?:tentative\s+)?vacanc(?:y|ies)\s*[:=–-]\s*(?:approx(?:\.|imately)?\s*)?(\d{1,3}(?:,\d{2,3})*|\d{1,6})\b(?!\.\d)/i.exec(text2);
if (tentative) {
let n = Number(tentative[1].replace(/,/g, ""));
if (n > 0 && n < 5e5) return { value: n, confidence: 0.8, evidence: tentative[0] };
}
let loose = /(?<![\d.])\b(\d{1,3}(?:,\d{2,3})*|\d{1,6})\s+(?:tentative\s+)?(?:posts|vacancies)\b/i.exec(text2);
if (loose) {
let n = Number(loose[1].replace(/,/g, ""));
if (n > 0 && n < 5e5) return { value: n, confidence: 0.6, evidence: loose[0] };
}
}
function extractAge(text2, issues) {
let segs = segments(text2), idx = segs.map((s, i) => /\bage\b/i.test(s) ? i : -1).filter((i) => i >= 0).slice(0, 8);
if (!idx.length) return {};
let seg = "";
for (let i of idx) {
let cand = /\d{2}\s*(?:to|-|–|and)\s*\d{2}\s*(?:years|yrs)/i.test(segs[i]) ? segs[i] : `${segs[i]} ${segs[i + 1] ?? ""}`, range = /\b(\d{2})\s*(?:to|-|–|and)\s*(\d{2})\s*(?:years|yrs)\b/i.exec(cand) ?? /\bbetween\s+(\d{2})\s*(?:and|to|-)\s*(\d{2})\b/i.exec(cand) ?? /\bmin(?:imum)?\.?\s*(?:age\s*)?(?:of\s*)?(\d{2})\s*(?:years|yrs)\b[^.\n]{0,40}?\bmax(?:imum)?\.?\s*(?:age\s*)?(?:of\s*)?(\d{2})\s*(?:years|yrs)\b/i.exec(cand);
if (range) {
let a = Number(range[1]), b = Number(range[2]);
if (a >= 14 && b <= 70 && a < b) return { min: { value: a, confidence: 1, evidence: cand.slice(0, 160) }, max: { value: b, confidence: 1, evidence: cand.slice(0, 160) } };
}
!seg && /\d{2}/.test(cand) && (seg = cand);
}
let mn = /\bmin(?:imum)?\.?\s*age[^0-9]{0,15}(\d{2})/i.exec(text2), mx = /\bmax(?:imum)?\.?\s*age[^0-9]{0,15}(\d{2})/i.exec(text2), out = {};
if (mn && Number(mn[1]) >= 14 && Number(mn[1]) <= 60 && (out.min = { value: Number(mn[1]), confidence: 1, evidence: mn[0] }), mx && Number(mx[1]) >= 16 && Number(mx[1]) <= 70 && (out.max = { value: Number(mx[1]), confidence: 1, evidence: mx[0] }), out.min && out.max && out.min.value >= out.max.value)
return issues.push("Minimum age is not below maximum age \u2014 check the age limit"), {};
if (!out.min && !out.max) {
let notExceed = /\bnot\s+(?:exceed|be\s+more\s+than)\s+(\d{2})\s*years/i.exec(seg);
notExceed && (out.max = { value: Number(notExceed[1]), confidence: 0.8, evidence: notExceed[0] });
}
return out;
}
var money = (s) => `Rs. ${s.replace(/\s/g, "")}`;
function extractPay(text2) {
let out = {}, lvl = /\bpay\s*(?:matrix\s*)?level[\s-]*(\d{1,2})\b/i.exec(text2) ?? /\blevel[\s-]*(\d{1,2})\s*\(\s*(?:rs\.?|₹)/i.exec(text2);
lvl && (out.payLevel = { value: `Level ${lvl[1]}`, confidence: 1, evidence: lvl[0] });
let lvlRange = /\blevel[\s-]*\d{1,2}\s*\(\s*(?:rs\.?|₹)\s*([\d,]{4,})\s*(?:\/-)?\s*(?:-|–|to)\s*(?:rs\.?|₹)?\s*([\d,]{4,})/i.exec(text2);
if (lvlRange)
return out.salary = { value: `${money(lvlRange[1])} \u2013 ${money(lvlRange[2])}`, confidence: 1, evidence: lvlRange[0].slice(0, 160) }, out;
let seg = segments(text2).find((s) => /\b(?:pay|salary|scale|emoluments?|stipend)\b/i.test(s) && /(?:rs\.?|₹|inr)\s*[\d,]{4,}/i.test(s));
if (seg) {
let r = /(?:rs\.?|₹|inr)\s*([\d,]{4,})\s*(?:\/-)?\s*(?:-|–|to)\s*(?:rs\.?|₹|inr)?\s*([\d,]{4,})/i.exec(seg);
if (r) out.salary = { value: `${money(r[1])} \u2013 ${money(r[2])}`, confidence: 1, evidence: seg.slice(0, 160) };
else {
let one = /(?:rs\.?|₹|inr)\s*([\d,]{4,})/i.exec(seg);
one && (out.salary = { value: money(one[1]), confidence: 0.7, evidence: seg.slice(0, 160) });
}
}
return out;
}
function extractFees(text2) {
let all = segments(text2), lines = all.map((s, i) => ({ s, ctx: [all[i - 2], all[i - 1], s].filter(Boolean).join(" ") })).filter((l) => /\bfees?\b/i.test(l.s)), out = {}, RES = /\b(?:sc|st|pwd|pwbd|women|female|ex-?servicemen|esm|reserved)\b/i, AMT = /(?:rs\.?|₹|inr)\s*([\d,]{2,6})/i;
for (let { s: own, ctx } of lines) {
let s = !RES.test(own) && !AMT.test(own) && /\bexempt/i.test(ctx) && RES.test(ctx) ? ctx.slice(ctx.search(RES)) : own, resAt = s.search(RES), amt = AMT.exec(s), generalNamed = /\b(?:general|ur|unreserved|obc|ews)\b/i.test(s);
if (amt && !out.general && (resAt < 0 || amt.index < resAt || /\b(?:general|ur|unreserved|obc|ews)\b[^.]{0,20}(?:rs|₹)/i.test(s)) && (out.general = { value: money(amt[1]), confidence: generalNamed ? 1 : 0.7, evidence: s.slice(0, 160) }), resAt >= 0 && !out.reserved) {
let tail = s.slice(resAt);
if (/\b(?:no\s+fee|nil|exempt(?:ed)?|fee\s+is\s+not\s+payable)\b/i.test(tail)) out.reserved = { value: "Nil (exempted)", confidence: 0.9, evidence: s.slice(0, 160) };
else {
let before = /(?:rs\.?|₹|inr)\s*([\d,]{2,6})\s*(?:\/-)?\s*(?:\([^)]*\)\s*)?(?:for|to\s+be\s+paid\s+by)\s+(?:the\s+)?(?:reserved|sc|st|pwd|pwbd|women|female|ex-?servicemen)/i.exec(s), ra = before ?? AMT.exec(tail);
ra && (before || !amt || ra.index + resAt !== amt.index || resAt < amt.index) && (out.reserved = { value: money(ra[1]), confidence: 0.8, evidence: s.slice(0, 160) });
}
}
}
return out;
}
var QUAL_RULES = [
[/\b(?:10th|matric(?:ulation)?|high\s+school|class\s*(?:x|10)|sslc|secondary\s+school)\b/i, "10th-pass"],
[/\b(?:12th|intermediate|higher\s+secondary|class\s*(?:xii|12)|hsc|10\+2|senior\s+secondary)\b/i, "12th-pass"],
[/\b(?:iti|i\.t\.i\.?|industrial\s+training\s+institute)(?![a-z])/i, "iti"],
[/\bdiploma\b/i, "diploma"],
[/\b(?:graduat(?:e|ion)|bachelor'?s?\s+degree|degree\s+from\s+a\s+recogni[sz]ed|b\.?\s?a\.?|b\.?\s?sc\.?|b\.?\s?com\.?)\b/i, "graduate"],
[/\b(?:post[\s-]?graduat(?:e|ion)|master'?s?\s+degree|m\.?\s?a\.?|m\.?\s?sc\.?|m\.?\s?com\.?|mba)\b/i, "post-graduate"],
[/(?:\bb\.\s?e\.|\bb\.?\s?tech\b|\bm\.?\s?tech\b|\bengineering\s+degree\b|\bdegree\s+in\s+(?:\w+\s+){0,3}engineering\b|\bdiploma\s+in\s+(?:\w+\s+){0,2}engineering\b)/i, "engineering"],
[/\b(?:mbbs|bds|b\.?\s?sc\.?\s+nursing|gnm|anm|b\.?\s?pharm|d\.?\s?pharm)\b/i, "medical"],
[/\b(?:llb|ll\.b|llm|law\s+graduate|degree\s+in\s+law|advocate|enrolled\s+with\s+(?:the\s+)?bar\s+council)\b/i, "law"],
[/\b(?:b\.?\s?ed|d\.?\s?el\.?\s?ed|ctet|tet)\b/i, "teaching"]
];
function extractQualifications(text2) {
let segs = segments(text2), picked = [];
segs.forEach((s, i) => {
/\b(?:qualification|eligib|educational|pass(?:ed)?|degree|diploma|matric|advocate)/i.test(s) && (/\b(?:date\s+of\s+birth|dob|certificate\s+(?:as|for)\s+(?:proof|date))\b/i.test(s) || (picked.push(s), s.length < 60 && segs[i + 1] && picked.push(segs[i + 1])));
});
let seg = picked.join(`
`);
if (!seg) return;
let found = [...new Set(QUAL_RULES.filter(([re]) => re.test(seg)).map(([, slug]) => slug))];
return found.length ? { value: found, confidence: 0.8, evidence: seg.slice(0, 200) } : void 0;
}
var STAGES = [
[/\b(?:computer[\s-]based\s+(?:test|exam(?:ination)?)|cbt)\b/i, "Computer Based Test"],
[/\bwritten\s+(?:test|exam(?:ination)?)\b/i, "Written Examination"],
[/\b(?:preliminary|prelims?)\s+exam/i, "Preliminary Examination"],
[/\bmains?\s+exam/i, "Main Examination"],
[/\b(?:physical\s+(?:efficiency|endurance|standard|measurement)\s+test|pet|pst)\b/i, "Physical Test (PET/PST)"],
[/\b(?:skill|typing|stenography|trade)\s+test\b/i, "Skill Test"],
[/\b(?:interview|personality\s+test|viva)\b/i, "Interview"],
[/\bdocument\s+verification\b/i, "Document Verification"],
[/\bmedical\s+(?:exam(?:ination)?|test)\b/i, "Medical Examination"]
];
function extractSelection(text2) {
let seg = segments(text2).filter((s) => /\b(?:selection|stage|mode\s+of|scheme\s+of|process)\b/i.test(s)).join(`
`) || "", found = STAGES.filter(([re]) => re.test(seg)).map(([, n]) => n);
return found.length ? { value: found, confidence: 0.8, evidence: seg.slice(0, 200) } : void 0;
}
function extractFields(rawText, links = []) {
let text2 = rawText.replace(/\bpage\s+\d{1,3}\s+of\s+\d{1,3}\b/gi, " "), issues = [], x = { issues };
x.advertisementNo = extractAdvertisementNo(text2);
let advts = [...new Set([...text2.slice(0, HEAD_CHARS).matchAll(new RegExp(`\\b(?:advt\\.?|advertisement)\\s*(?:no\\.?|number)\\s*[:.\u2013-]?\\s*${REF}`, "gi"))].map((m) => m[1].replace(/[–]/g, "-")).filter((v2) => /\d/.test(v2)))];
advts.length > 1 && issues.push(`The notice names several advertisement numbers (${advts.join(", ")}) \u2014 check which one this record is for`), x.notificationDate = pickDate(text2, L.notif, "notification", issues);
let range = applicationRange(text2);
x.applicationStart = pickDate(text2, L.start, "application start", issues) ?? range?.start, x.lastDate = pickDate(text2, L.last, "last", issues) ?? range?.last, range && x.lastDate && x.lastDate.value !== range.last.value && x.lastDate.confidence === 1 && (issues.push(`The application period (${range.start.value} to ${range.last.value}) and the stated last date (${x.lastDate.value}) disagree`), x.lastDate = { ...x.lastDate, confidence: 0.4 }), x.correctionDate = pickDate(text2, L.correction, "correction", issues);
let ex = pickDate(text2, L.exam, "exam", issues);
ex && (x.examDate = { ...ex, tentative: /\btentative|likely|probable|expected\b/i.test(ex.evidence) }), x.admitCardDate = pickDate(text2, L.admit, "admit card", issues), x.resultDate = pickDate(text2, L.result, "result", issues), x.objectionStart = pickDate(text2, L.objStart, "objection start", issues), x.objectionLast = pickDate(text2, L.objLast, "objection last", issues), x.totalVacancies = extractVacancies(text2, issues);
let age = extractAge(text2, issues);
x.ageMin = age.min, x.ageMax = age.max;
let pay = extractPay(text2);
x.payLevel = pay.payLevel, x.salary = pay.salary;
let fee = extractFees(text2);
x.feeGeneral = fee.general, x.feeReserved = fee.reserved, x.qualifications = extractQualifications(text2), x.selectionProcess = extractSelection(text2);
let apply = links.find((l) => /\b(?:apply\s+online|online\s+application|registration|apply\s+here|click\s+here\s+to\s+apply)\b/i.test(l.text) || /\/(?:apply|registration|register|onlineapp)/i.test(l.href));
apply && (x.applyUrl = { value: apply.href, confidence: /apply|registration/i.test(apply.text) ? 1 : 0.7, evidence: apply.text || apply.href });
let notif = links.find((l) => /\.pdf($|\?)/i.test(l.href) && /\b(?:notification|advertisement|advt|notice|detailed)\b/i.test(l.text + " " + l.href));
return notif && (x.notificationUrl = { value: notif.href, confidence: 1, evidence: notif.text || notif.href }), x.applicationStart && x.lastDate && x.applicationStart.value > x.lastDate.value && issues.push("Application start date is after the last date"), x.notificationDate && x.lastDate && x.notificationDate.value > x.lastDate.value && issues.push("Notification date is after the last date"), x.objectionStart && x.objectionLast && x.objectionStart.value > x.objectionLast.value && issues.push("Objection window starts after it ends"), x;
}
var AMENDMENT = /\b(?:corrigend(?:um|a)|addend(?:um|a)|errat(?:um|a)|clarification|notice\s+regarding\s+change|cancell?ation|revival|revision\s+of\s+vacanc|revised\s+(?:dates?|schedule|notice|programme)|re-?schedul(?:ed|ing)|postpone(?:d|ment)|extension\s+of\s+(?:the\s+)?(?:last\s+)?date|(?:last\s+)?date\s+(?:is\s+|has\s+been\s+)?extended|change\s+in\s+(?:the\s+)?(?:date|schedule|exam))/i;
function pickTitle(anchorText, doc) {
let clean = (s) => s.replace(/\s+/g, " ").replace(/\b(?:new|click here|download|view|pdf|\(\s*\d+(?:\.\d+)?\s*[km]b\s*\))\b/gi, " ").replace(/\s+/g, " ").trim(), strong = /\b(recruitment|notification|advertisement|advt|vacanc|examination|exam|admit\s+card|hall\s+ticket|result|answer\s+key|calendar|schedule|bharti|भर्ती)\b/i, a = anchorText ? clean(anchorText) : "";
if (a.length >= 12 && a.length <= 300 && strong.test(a)) return { value: a, confidence: 1, evidence: anchorText };
if (a.length >= 12 && a.length <= 300 && /\b(?:notice|posts?|corrigendum|addendum|clarification)\b/i.test(a)) return { value: a, confidence: 0.9, evidence: anchorText };
let head = doc.text.split(`
`).slice(0, 12).map(clean), amendLine = a ? void 0 : head.find((l) => l.length >= 8 && l.length <= 200 && AMENDMENT.test(l));
if (amendLine) {
let subject = head.find((l) => l !== amendLine && l.length >= 15 && strong.test(l));
return { value: subject ? `${amendLine} \u2014 ${subject}`.slice(0, 300) : amendLine, confidence: 0.7, evidence: amendLine };
}
for (let h of doc.headings) {
let c = clean(h);
if (c.length >= 12 && c.length <= 300 && strong.test(c)) return { value: c, confidence: 0.8, evidence: h };
}
let line = doc.text.split(`
`).map(clean).find((l) => l.length >= 15 && l.length <= 300 && strong.test(l));
if (line) return { value: line, confidence: 0.7, evidence: line };
if (a.length >= 8) return { value: a, confidence: 0.5, evidence: anchorText };
if (doc.title && doc.title.length >= 8) return { value: clean(doc.title), confidence: 0.4, evidence: doc.title };
}
var K = new Uint32Array([1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298]);
function sha256(msg) {
let l = msg.length, withPad = l + 9 + 63 >> 6 << 6, b = new Uint8Array(withPad);
b.set(msg), b[l] = 128;
let dv = new DataView(b.buffer);
dv.setUint32(withPad - 4, l * 8 >>> 0), dv.setUint32(withPad - 8, Math.floor(l * 8 / 2 ** 32));
let H = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225]), W = new Uint32Array(64), r = (x, n) => x >>> n | x << 32 - n;
for (let o = 0; o < withPad; o += 64) {
for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
for (let i = 16; i < 64; i++) {
let s0 = r(W[i - 15], 7) ^ r(W[i - 15], 18) ^ W[i - 15] >>> 3, s1 = r(W[i - 2], 17) ^ r(W[i - 2], 19) ^ W[i - 2] >>> 10;
W[i] = W[i - 16] + s0 + W[i - 7] + s1 >>> 0;
}
let [a, bb, c, d, e, f, g, h] = H;
for (let i = 0; i < 64; i++) {
let t1 = h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + (e & f ^ ~e & g) + K[i] + W[i] >>> 0, t2 = (r(a, 2) ^ r(a, 13) ^ r(a, 22)) + (a & bb ^ a & c ^ bb & c) >>> 0;
h = g, g = f, f = e, e = d + t1 >>> 0, d = c, c = bb, bb = a, a = t1 + t2 >>> 0;
}
H[0] += a, H[1] += bb, H[2] += c, H[3] += d, H[4] += e, H[5] += f, H[6] += g, H[7] += h;
}
return [...H].map((x) => x.toString(16).padStart(8, "0")).join("");
}
function createHash(_alg) {
let parts = [], api = {
update(x) {
return parts.push(typeof x == "string" ? new TextEncoder().encode(x) : x), api;
},
digest(_enc) {
let n = parts.reduce((s, p) => s + p.length, 0), all = new Uint8Array(n), o = 0;
for (let p of parts)
all.set(p, o), o += p.length;
return sha256(all);
}
};
return api;
}
var NOISE = /\b(tender|quotation|e-?auction|rti\b|right\s+to\s+information|holiday\s+list|transfer\s+(?:order|posting)|promotion\s+order|seniority\s+list|pension|gpf|court\s+case\s+status|annual\s+report|citizen\s+charter|budget|minutes\s+of\s+(?:the\s+)?meeting|purchase|empanelment\s+of\s+vendors?)\b/i, isAmendment = (title) => AMENDMENT.test(title);
function classify(title, text2, hint) {
let t = `${title}
${text2.slice(0, 3e3)}`;
return NOISE.test(title) ? null : /\banswer\s*keys?\b|\bresponse\s+sheet\b/i.test(title) ? "answer_key" : /\b(?:admit\s+card|hall\s+ticket|call\s+letter|e-?admit)\b/i.test(title) ? "admit_card" : /\b(?:results?|merit\s+list|select(?:ion|ed)\s+list|marks?\s+(?:of|obtained)|cut[\s-]?off)\b/i.test(title) ? "result" : /\b(?:exam(?:ination)?\s+calendar|calendar\s+of\s+exam|tentative\s+(?:schedule|calendar|programme)|annual\s+calendar)\b/i.test(title) ? "exam_calendar" : /\b(?:recruitment|vacanc|advertisement|advt|notification|bharti|भर्ती|posts?\s+of|appointment|walk[\s-]?in|engagement|apprentice)/i.test(t) ? "job" : isAmendment(title) ? hint ?? "job" : hint ?? null;
}
var v = (f) => f?.value;
function place(ctx) {
return ctx.isAllIndia || !ctx.stateId ? { is_all_india: !0, state_id: null } : { is_all_india: !1, state_id: ctx.stateId };
}
var monthYear = (iso2) => (/* @__PURE__ */ new Date(`${iso2}T00:00:00Z`)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
function normalize(kind, title, x, ctx, itemUrl) {
let issues = [...x.issues], conf = { title: title.confidence }, evidence = { title: title.evidence.slice(0, 240) }, put = (o, col, f) => {
f !== void 0 && f.value !== void 0 && f.value !== null && (o[col] = f.value, conf[col] = f.confidence, evidence[col] = f.evidence.slice(0, 240));
}, ev = (col, f) => {
f && (evidence[col] = f.evidence.slice(0, 240));
}, common = { title: title.value, organization_id: ctx.organizationId, source_name: ctx.name, source_url: itemUrl, official_website_url: ctx.baseUrl, ...place(ctx) }, out, examStatus = (col, f) => f ? f.tentative ? { [col]: f.value, [`${col}_status`]: "expected", [`${col}_text`]: monthYear(f.value) } : { [col]: f.value, [`${col}_status`]: "official" } : {}, amendment = isAmendment(title.value);
switch (amendment && issues.push("This is a corrigendum / addendum / date change \u2014 link it to the existing record (Merge or Apply changes); do not publish it as a new notice"), x.examDate?.tentative && issues.push("The exam date is described as tentative in the source \u2014 stored as Expected (month only); confirm on review"), kind) {
case "job": {
out = {
title: title.value,
organization_id: ctx.organizationId,
organization_name: ctx.organizationName,
level: ctx.organizationLevel ?? "central",
department_slug: ctx.departmentSlug,
state_slug: ctx.isAllIndia || !ctx.stateSlug ? "all-india" : ctx.stateSlug,
source_name: ctx.name,
source_url: itemUrl,
source_type: "official_notification",
official_website_url: ctx.baseUrl
}, put(out, "advertisement_no", x.advertisementNo), put(out, "notification_date", x.notificationDate), put(out, "application_start_date", x.applicationStart), put(out, "last_date", x.lastDate), put(out, "correction_date", x.correctionDate), put(out, "total_vacancies", x.totalVacancies), put(out, "age_min", x.ageMin), put(out, "age_max", x.ageMax), put(out, "pay_level", x.payLevel), put(out, "salary_text", x.salary), put(out, "fee_general", x.feeGeneral), put(out, "fee_reserved", x.feeReserved), put(out, "qualification_slugs", x.qualifications), put(out, "selection_process", x.selectionProcess), put(out, "official_apply_url", x.applyUrl), out.notification_url = v(x.notificationUrl) ?? (/\.pdf($|\?)/i.test(itemUrl) ? itemUrl : null), conf.notification_url = x.notificationUrl?.confidence ?? 1, x.examDate && (Object.assign(out, examStatus("exam_date", x.examDate)), conf.exam_date = x.examDate.confidence), x.admitCardDate && (out.admit_card_date = x.admitCardDate.value, out.admit_card_date_status = "official", conf.admit_card_date = x.admitCardDate.confidence), out.last_date || issues.push("No application last date found"), out.qualification_slugs || issues.push("No qualification recognised \u2014 pick at least one before publishing"), out.official_apply_url || issues.push("No official apply link found (fine for offline applications \u2014 say so on review)"), out.total_vacancies || issues.push("Total vacancies not found");
break;
}
case "recruitment": {
out = { ...common, official_notification_url: /\.pdf($|\?)/i.test(itemUrl) ? itemUrl : v(x.notificationUrl) ?? null }, put(out, "notification_number", x.advertisementNo), put(out, "notification_date", x.notificationDate);
break;
}
case "admit_card": {
out = { ...common, official_notification_url: /\.pdf($|\?)/i.test(itemUrl) ? itemUrl : null }, x.admitCardDate && (out.release_date = x.admitCardDate.value, out.release_date_status = "official", conf.release_date = x.admitCardDate.confidence), x.examDate && (Object.assign(out, examStatus("exam_date", x.examDate)), conf.exam_date = x.examDate.confidence), issues.push("Availability (upcoming / released) is not inferred automatically \u2014 choose it on review from the official page");
break;
}
case "result": {
out = { ...common, official_result_url: itemUrl }, x.resultDate && (out.result_date = x.resultDate.value, conf.result_date = x.resultDate.confidence), issues.push("Result type is not inferred automatically \u2014 choose it on review");
break;
}
case "answer_key": {
out = { ...common, official_answer_key_url: itemUrl }, put(out, "objection_start_date", x.objectionStart), put(out, "objection_last_date", x.objectionLast), issues.push("Answer key type (provisional / final) is not inferred automatically \u2014 choose it on review");
break;
}
default: {
out = { ...common, official_notification_url: itemUrl }, x.examDate && (Object.assign(out, examStatus("exam_date", x.examDate)), conf.exam_date = x.examDate.confidence), x.lastDate && (out.application_last_date = x.lastDate.value, out.application_last_date_status = "official", conf.application_last_date = x.lastDate.confidence);
break;
}
}
ctx.organizationId || issues.push("The source has no organization linked \u2014 choose the organization on review");
let { score, level } = score_(kind, out, conf, issues);
ev("exam_date", x.examDate), ev("admit_card_date", x.admitCardDate), ev("release_date", x.admitCardDate), ev("result_date", x.resultDate), ev("application_last_date", x.lastDate), ev("notification_url", x.notificationUrl);
let kept = stripNulls(out);
for (let k of Object.keys(evidence)) k in kept || delete evidence[k];
return {
kind,
title: title.value,
extracted: kept,
fieldConfidence: conf,
evidence,
issues: [...new Set(issues)],
confidence: level,
score,
amendment,
fingerprint: fingerprint(kind, ctx.organizationId, out, itemUrl),
contentHash: hashOf(stripNulls(out))
};
}
var stripNulls = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x != null && x !== "")), WEIGHTS = {
job: { title: 0.15, organization_id: 0.1, notification_url: 0.15, last_date: 0.15, advertisement_no: 0.1, total_vacancies: 0.1, qualification_slugs: 0.1, application_start_date: 0.05, age_max: 0.05, fee_general: 0.05 },
recruitment: { title: 0.3, organization_id: 0.2, official_notification_url: 0.3, notification_number: 0.1, notification_date: 0.1 },
admit_card: { title: 0.35, organization_id: 0.2, source_url: 0.25, exam_date: 0.1, release_date: 0.1 },
result: { title: 0.35, organization_id: 0.2, official_result_url: 0.35, result_date: 0.1 },
answer_key: { title: 0.35, organization_id: 0.2, official_answer_key_url: 0.3, objection_last_date: 0.15 },
exam_calendar: { title: 0.3, organization_id: 0.2, official_notification_url: 0.2, exam_date: 0.3 }
};
function score_(kind, out, conf, issues) {
let w = WEIGHTS[kind] ?? WEIGHTS.job, s = 0;
for (let [k, weight] of Object.entries(w)) out[k] !== void 0 && out[k] !== null && (s += weight * (conf[k] ?? 1));
let conflicts = issues.filter((i) => /several|more than one|disagree|after the last|not below/i.test(i)).length;
s = Math.max(0, s - 0.1 * conflicts), s = Math.round(s * 1e3) / 1e3;
let essentials = kind === "job" ? !!(out.title && out.last_date && out.notification_url && out.organization_id) : !!(out.title && out.organization_id), level = s >= 0.75 && essentials && conflicts === 0 ? "HIGH" : s >= 0.5 ? "MEDIUM" : "LOW";
return { score: Math.min(1, s), level };
}
var normRef = (t) => (typeof t == "string" ? t.toLowerCase().replace(/[^a-z0-9]+/g, "") : "") || null, normUrl = (u) => (typeof u == "string" ? u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[/#?]+$/, "") : "") || null;
function fingerprint(kind, orgId, out, itemUrl) {
let org = orgId ?? "no-org", ref = normRef(out.advertisement_no ?? out.notification_number);
if (ref) return `${org}|${kind === "recruitment" ? "job" : kind}|ref:${ref}`;
let u = normUrl(itemUrl);
return u ? `${org}|${kind}|url:${u}` : null;
}
function stable(x) {
return Array.isArray(x) ? x.map(stable) : x && typeof x == "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, stable(x[k])])) : x;
}
var hashOf = (o) => createHash("sha256").update(JSON.stringify(stable(o))).digest("hex"), isImportantField = (k) => [
"title",
"advertisement_no",
"notification_number",
"total_vacancies",
"age_min",
"age_max",
"fee_general",
"fee_reserved",
"fee_note",
"qualification_details",
"qualification_slugs",
"eligibility_summary",
"availability",
"objection_start_date",
"objection_last_date"
].includes(k) || /(_date|_date_status|_date_text)$/.test(k) || /_url$/.test(k), IGNORE_IN_DIFF = /* @__PURE__ */ new Set(["source_name", "organization_name", "organization_id", "level", "department_slug", "state_slug", "state_id", "is_all_india", "source_type", "official_website_url"]), canon = (x) => x == null || x === "" ? "" : Array.isArray(x) ? JSON.stringify([...x].map(String).sort()) : typeof x == "string" && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : String(x).trim(), AMENDMENT_SKIP = /* @__PURE__ */ new Set(["title", "source_url", "notification_url", "official_notification_url", "official_result_url", "official_answer_key_url"]);
function diffFields(before, after, opts = {}) {
let out = {};
for (let [k, to] of Object.entries(after)) {
if (IGNORE_IN_DIFF.has(k) || to === void 0 || to === null || to === "" || opts.amendment && (AMENDMENT_SKIP.has(k) || Array.isArray(to))) continue;
let from = before[k];
canon(from) !== canon(to) && (out[k] = { from: from ?? null, to, important: isImportantField(k) });
}
return out;
}
const { parse: parse } = await import("https://cdn.jsdelivr.net/npm/node-html-parser@9.0.4/+esm");
var sha2562 = (b) => createHash("sha256").update(b).digest("hex");
function docType(contentType, url, body) {
let ct = (contentType ?? "").toLowerCase();
return ct.includes("pdf") || /\.pdf($|\?)/i.test(url) || body && body.length > 4 && String.fromCharCode(...body.slice(0, 4)) === "%PDF" ? "pdf" : ct.includes("html") || ct.includes("xml") || ct === "" || /\.(s?html?|aspx?|php|jsp)($|\?)/i.test(url) ? "html" : "other";
}
var collapse = (s) => s.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, `
`).replace(/\n{3,}/g, `

`).trim();
function decodeHtml(body) {
try {
return new TextDecoder("utf-8", { fatal: !0 }).decode(body);
} catch {
return new TextDecoder("latin1").decode(body);
}
}
function htmlToDoc(body, baseUrl) {
let html = typeof body == "string" ? body : decodeHtml(body), root = parse(html, { blockTextElements: { script: !1, style: !1, noscript: !1 } });
root.querySelectorAll("script,style,noscript,svg,iframe").forEach((n) => n.remove());
let title = collapse(root.querySelector("title")?.text ?? "") || void 0, headings = root.querySelectorAll("h1,h2,h3").map((h) => collapse(h.text)).filter((t) => t.length > 2).slice(0, 30), links = [];
for (let a of root.querySelectorAll("a[href]")) {
let raw = (a.getAttribute("href") ?? "").trim();
if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel):/i.test(raw)) continue;
let href;
try {
href = new URL(raw, baseUrl).toString();
} catch {
continue;
}
let text3 = collapse(a.text || a.getAttribute("title") || "");
links.push({ href, text: text3, context: spacedText(rowOf(a)).slice(0, 400) });
}
return { type: "html", text: collapse(root.structuredText ?? root.text), title, headings, links };
}
function spacedText(n) {
return collapse(parse(n.innerHTML.replace(/</g, " <")).text.replace(/\s+/g, " "));
}
function rowOf(a) {
let n = a;
for (let i = 0; i < 5 && n; i++) {
if (["TR", "LI", "P", "DIV"].includes(n.tagName)) return n;
n = n.parentNode;
}
return a;
}
async function pdfToDoc(body) {
let { extractText: extractText2, getDocumentProxy: getDocumentProxy2 } = await Promise.resolve().then(() => (init_unpdf(), unpdf_exports)), pdf = await getDocumentProxy2(new Uint8Array(body)), { text: text2, totalPages } = await extractText2(pdf, { mergePages: !0 }), t = collapse(Array.isArray(text2) ? text2.join(`
`) : text2), links = [];
for (let m of t.matchAll(/https?:\/\/[^\s)<>"']+/g)) links.push({ href: m[0].replace(/[.,;]+$/, ""), text: m[0], context: "" });
return { type: "pdf", text: t, headings: t.split(`
`).slice(0, 12).map((l) => l.trim()).filter(Boolean), links, pages: totalPages };
}
async function toDoc(body, contentType, url) {
let type = docType(contentType, url, body);
return type === "pdf" ? pdfToDoc(body) : type === "html" ? htmlToDoc(body, url) : { type: "other", text: "", headings: [], links: [] };
}
function hostAllowed(href, officialDomain, extra = []) {
let h;
try {
h = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
} catch {
return !1;
}
return [officialDomain, ...extra].some((d) => h === d.toLowerCase() || h.endsWith("." + d.toLowerCase()));
}
var LIMITS = { listing: 3e6, detail: 3e6, notice: 15e6 }, AMENDMENT_TYPES = [
["cancellation", /\bcancell?(?:ation|ed)\b|\bwithdrawn\b|\bwithdrawal\s+of\b/i],
["revival", /\brevival\b|\brevived\b/i],
["postponement", /\bpostpone(?:d|ment)\b|\bdeferred\b/i],
["extension", /\bextension\s+of\s+(?:the\s+)?(?:last\s+)?date\b|\b(?:last\s+)?date\s+(?:is\s+|has\s+been\s+)?extended\b|\bextended\s+(?:up\s*to|till|until)\b/i],
["revised_schedule", /\brevised\s+(?:dates?|schedule|programme)\b|\bre-?schedul(?:ed|ing)\b|\bchange\s+in\s+(?:the\s+)?(?:date|schedule|exam)\b/i],
["vacancy_revision", /\brevision\s+of\s+vacanc|\b(?:increase|decrease|change)\s+in\s+(?:the\s+)?(?:number\s+of\s+)?vacanc/i],
["addendum", /\baddend(?:um|a)\b/i],
["errata", /\berrat(?:um|a)\b/i],
["clarification", /\bclarification\b/i],
["corrigendum", /\bcorrigend(?:um|a)\b/i],
["change_notice", /\bnotice\s+regarding\s+change\b/i]
];
function amendmentType(title, text2 = "") {
let head = `${title}
${text2.split(`
`).slice(0, 8).join(`
`)}`;
if (!AMENDMENT.test(title) && !AMENDMENT.test(head)) return null;
for (let [t, re] of AMENDMENT_TYPES) if (re.test(title)) return t;
for (let [t, re] of AMENDMENT_TYPES) if (re.test(head)) return t;
return "change_notice";
}
function pluck(obj, path) {
if (!path) return [obj];
let cur = [obj];
for (let part of path.split(".")) {
let many = part.endsWith("[]"), key = many ? part.slice(0, -2) : part;
cur = cur.flatMap((o) => {
let v2 = key ? o && typeof o == "object" ? o[key] : void 0 : o;
return many ? Array.isArray(v2) ? v2 : [] : v2 === void 0 ? [] : [v2];
});
}
return cur;
}
var base = {
capabilities: { twoHop: !1, tableColumns: !1, jsonFeed: !1, needsTermsReview: !1 },
configKeys: ["include", "exclude", "selector", "maxItems", "delayMs", "allowDomains", "pdfOnly", "expectOrganization", "applyDomains"],
validateConfig() {
return null;
},
refuse() {
return null;
},
listings(src) {
let l = [
{ url: src.recruitment_url ?? "", kind: "job" },
{ url: src.admit_card_url ?? "", kind: "admit_card" },
{ url: src.results_url ?? "", kind: "result" },
{ url: src.answer_key_url ?? "", kind: "answer_key" },
{ url: src.exam_url ?? "", kind: "exam_calendar" }
].filter((x) => x.url);
return l.length || l.push({ url: src.base_url }), [...new Map(l.map((x) => [x.url, x])).values()];
},
fetch(fetcher, url, purpose) {
return fetcher.fetch(url, { maxBytes: LIMITS[purpose] });
},
async parse(res) {
let body = res.body;
if (/json/i.test(res.contentType ?? "")) {
let text2 = new TextDecoder().decode(body), json = null;
try {
json = JSON.parse(text2);
} catch {
}
return { doc: { type: "other", text: "", headings: [], links: [] }, raw: null, json };
}
let doc = await toDoc(body, res.contentType, res.finalUrl);
return { doc, raw: doc.type === "html" ? new TextDecoder().decode(body) : null };
},
async identifyNotification(c, first) {
return { candidate: c, res: first.res, parsed: first.parsed, hops: [c.url] };
},
extractFields(doc, c) {
return extractFields(`${doc.text}
${c.context}`, doc.links);
},
identifyAmendment(title, text2) {
return amendmentType(title, text2);
},
identifyUpdate(existing, extracted, amendment) {
return diffFields(existing, extracted, { amendment });
},
identifyApplicationLink(_doc, x, ctx) {
if (!x.applyUrl) return null;
let url = x.applyUrl.value;
return { url, offDomain: !hostAllowed(url, ctx.officialDomain, [...ctx.config.allowDomains ?? [], ...ctx.config.applyDomains ?? []]) };
},
checkNotice(doc, ctx) {
let issues = [];
if (scannedPdf(doc) && issues.push("The PDF has little or no text layer (probably scanned) \u2014 enter the details manually from the document"), ctx.config.expectOrganization) {
let re = null;
try {
re = new RegExp(ctx.config.expectOrganization, "i");
} catch {
}
re && !re.test(doc.text.slice(0, 2500)) && issues.push("The notice does not name the expected organization near its start \u2014 it may be another body's circular re-posted on this site. Check the organization before approving.");
}
return issues;
}
}, scannedPdf = (doc) => doc.type === "pdf" && doc.text.replace(/\s/g, "").length < 200;
function defineAdapter(a) {
return { ...base, ...a, capabilities: { ...base.capabilities, ...a.capabilities ?? {} } };
}
var RELEVANT = /\b(recruit|notification|advertisement|advt|vacanc|post(?:s)?\s+of|examination|exam\b|admit\s*card|hall\s*ticket|call\s*letter|result|merit\s*list|answer\s*key|calendar|schedule|corrigendum|addendum|walk[\s-]?in|apprentice|bharti|भर्ती|परीक्षा|परिणाम|प्रवेश\s*पत्र)/i, NAV = /^(home|about(\s+us)?|contact(\s+us)?|sitemap|site\s*map|login|sign\s*in|register(?!\s+for)|faq|help|feedback|screen\s*reader|skip\s+to|hindi|english|हिंदी|a\+|a-|a|rti|tenders?|archives?|more|view\s+all|read\s+more)$/i, WEAK = /^(click\s+here|download|view|pdf|here|link|new|details?|open|see|\d+(\.\d+)?\s*[km]b|\(\s*\d+(\.\d+)?\s*[km]b\s*\))$/i, BAD_EXT = /\.(jpg|jpeg|png|gif|zip|rar|docx?|xlsx?|pptx?|mp4|mp3)(\?|$)/i, isPdf = (u) => /\.pdf($|\?)/i.test(u);
function kindHintOf(text2, listingKind) {
return /answer\s*key/i.test(text2) ? "answer_key" : /admit\s*card|hall\s*ticket|call\s*letter/i.test(text2) ? "admit_card" : /\bresult|merit\s*list|cut[\s-]?off/i.test(text2) ? "result" : /calendar|schedule\s+of\s+exam/i.test(text2) ? "exam_calendar" : listingKind;
}
function linksWithin(rawHtml, selector, base2, fallback) {
if (!rawHtml || !selector) return fallback;
try {
let area = parse2(rawHtml).querySelectorAll(selector);
if (!area.length) return fallback;
let hrefs = new Set(area.flatMap((n) => n.querySelectorAll("a[href]").map((a) => {
try {
return new URL(a.getAttribute("href"), base2).toString();
} catch {
return "";
}
})));
return fallback.filter((l) => hrefs.has(l.href));
} catch {
return fallback;
}
}
function genericDiscover(doc, rawHtml, ctx, opts = {}) {
let c = ctx.config, include = c.include ? new RegExp(c.include, "i") : RELEVANT, exclude = c.exclude ? new RegExp(c.exclude, "i") : null, max = Math.min(Math.max(c.maxItems ?? 10, 1), 25), seen = /* @__PURE__ */ new Set(), out = [];
for (let l of linksWithin(rawHtml, c.selector, ctx.listingUrl, doc.links)) {
let href = l.href.split("#")[0];
if (seen.has(href) || href === ctx.listingUrl.split("#")[0] || !hostAllowed(href, ctx.officialDomain, c.allowDomains) || BAD_EXT.test(href) || (opts.pdfOnly || c.pdfOnly) && !isPdf(href)) continue;
let text2 = l.text.trim();
if (NAV.test(text2)) continue;
let useRow = (opts.rowTitles || WEAK.test(text2) || text2.length < 6) && l.context.length > text2.length, rowTitle = l.context.replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ").replace(/\b(?:download|click here|view|pdf|new)\b/gi, " ").replace(/^\s*\d{1,3}[.)]?\s+/, "").replace(/\s+/g, " ").trim(), title = (useRow && rowTitle.length >= 6 ? rowTitle : text2).slice(0, 300), hay = `${title} ${href}`;
if (!include.test(hay) || exclude && exclude.test(hay)) continue;
seen.add(href);
let d = findDates(l.context)[0];
if (out.push({ url: href, anchorText: title, context: l.context, dateHint: d?.iso, kindHint: kindHintOf(hay, ctx.listingKind) }), out.length >= max) break;
}
return out;
}
function tableColumnsDiscover(rawHtml, ctx) {
if (!rawHtml) return [];
let c = ctx.config, include = c.include ? new RegExp(c.include, "i") : null, exclude = c.exclude ? new RegExp(c.exclude, "i") : null, max = Math.min(Math.max(c.maxItems ?? 10, 1), 25), out = [], seen = /* @__PURE__ */ new Set(), tables = parse2(rawHtml).querySelectorAll(c.tableSelector || "table"), clean = (s) => s.replace(/\s+/g, " ").trim();
for (let t of tables) {
let rows = t.querySelectorAll("tr");
if (rows.length < 2) continue;
let headerRow = rows.find((r) => r.querySelectorAll("th").length > 0) ?? rows[0], headers = headerRow.querySelectorAll("th,td").map((h) => clean(h.text));
for (let r of rows) {
if (r === headerRow) continue;
let cells = r.querySelectorAll("td");
if (!cells.length) continue;
let a = r.querySelectorAll("a[href]").map((x) => {
try {
return { href: new URL(x.getAttribute("href"), ctx.listingUrl).toString(), text: clean(x.text) };
} catch {
return null;
}
}).find((x) => x && hostAllowed(x.href, ctx.officialDomain, c.allowDomains) && !BAD_EXT.test(x.href));
if (!a || seen.has(a.href)) continue;
let lines = cells.map((cell, i) => {
let v2 = clean(cell.text), h = headers[i] ?? "";
return v2 ? h && !/^(s\.?\s*no\.?|sr\.?\s*no\.?|#)$/i.test(h) ? `${h}: ${v2}` : v2 : "";
}).filter(Boolean), context = lines.join(`
`), titleCell = lines.map((l) => l.replace(/^[^:]{1,40}:\s*/, "")).sort((x, y) => y.length - x.length)[0] ?? a.text, title = (a.text && !WEAK.test(a.text) && a.text.length >= 12 ? a.text : titleCell).slice(0, 300), hay = `${title} ${context} ${a.href}`;
if (!(include && !include.test(hay) || exclude && exclude.test(hay)) && (seen.add(a.href), out.push({ url: a.href, anchorText: title, context, dateHint: findDates(context)[0]?.iso, kindHint: kindHintOf(hay, ctx.listingKind) }), out.length >= max))
return out;
}
}
return out;
}
var regexOk = (s, max = 300) => typeof s == "string" && s.length <= max && (() => {
try {
return new RegExp(s, "i"), !0;
} catch {
return !1;
}
})(), adapters = [
defineAdapter({
key: "generic-listing",
label: "Generic notice listing",
description: "Any page listing notices as links (HTML or PDF). Keeps links on the official domain whose text looks like a recruitment / exam / result notice.",
discover: (doc, raw, ctx) => genericDiscover(doc, raw, ctx)
}),
defineAdapter({
key: "pdf-index",
label: "PDF notice board",
description: "Notice boards where every notice is a PDF (common on NIC-hosted sites). Only PDF links are followed.",
discover: (doc, raw, ctx) => genericDiscover(doc, raw, ctx, { pdfOnly: !0 })
}),
defineAdapter({
key: "table-listing",
label: "Table of notices",
description: "Notices in table rows (serial no. \xB7 title \xB7 date \xB7 'Download'). The row text becomes the title, so weak link text like 'Click here' is not a problem.",
discover: (doc, raw, ctx) => genericDiscover(doc, raw, ctx, { rowTitles: !0 })
}),
defineAdapter({
key: "table-columns",
label: "Table with named columns",
description: "A table whose headers name the facts (Advt No \xB7 Start date \xB7 Last date \xB7 Fee last date). Each row's cells are read with their column names, so dates come from the table, not from a hard-to-read PDF.",
capabilities: { twoHop: !1, tableColumns: !0, jsonFeed: !1, needsTermsReview: !1 },
configKeys: ["include", "exclude", "tableSelector", "maxItems", "delayMs", "allowDomains", "expectOrganization", "applyDomains"],
validateConfig: (c) => c.tableSelector !== void 0 && (typeof c.tableSelector != "string" || c.tableSelector.length > 200) ? "tableSelector must be a short CSS selector" : null,
discover: (_doc, raw, ctx) => tableColumnsDiscover(raw, ctx)
}),
defineAdapter({
key: "detail-page",
label: "Notice page \u2192 PDF (two steps)",
description: "The listing links to an HTML page for each notice, and that page links the official PDF. The PDF is read; the page's own text is kept as context.",
capabilities: { twoHop: !0, tableColumns: !1, jsonFeed: !1, needsTermsReview: !1 },
configKeys: ["include", "exclude", "selector", "maxItems", "delayMs", "allowDomains", "detailPdfInclude", "expectOrganization", "applyDomains"],
validateConfig: (c) => c.detailPdfInclude !== void 0 && !regexOk(c.detailPdfInclude) ? "detailPdfInclude must be a valid short pattern" : null,
discover: (doc, raw, ctx) => genericDiscover(doc, raw, ctx),
async identifyNotification(c, first, ctx, io) {
if (first.parsed.doc.type !== "html") return { candidate: c, res: first.res, parsed: first.parsed, hops: [c.url] };
let want = ctx.config.detailPdfInclude ? new RegExp(ctx.config.detailPdfInclude, "i") : /notice|notification|advt|advertisement|corrigendum|addendum|\bkb\b|\bmb\b|download/i, pdfs = first.parsed.doc.links.filter((l) => isPdf(l.href) && hostAllowed(l.href, ctx.officialDomain, ctx.config.allowDomains)), pick = pdfs.find((l) => want.test(`${l.text} ${l.href}`)) ?? (pdfs.length === 1 ? pdfs[0] : void 0);
if (!pick) return { skip: pdfs.length ? `The notice page links ${pdfs.length} PDFs and none matches detailPdfInclude` : "The notice page links no PDF on the official domain" };
let res = await io.fetch(pick.href, "notice");
if (!res.ok || !res.body) return { skip: `Notice PDF ${pick.href}: ${res.error ?? res.outcome}` };
let parsed = await io.parse(res), pageText = first.parsed.doc.text.slice(0, 1500);
return { candidate: { ...c, url: pick.href, context: `${c.context}
${pageText}`.trim() }, res, parsed, hops: [c.url, pick.href] };
}
}),
defineAdapter({
key: "json-feed",
label: "JSON notice feed (terms review required)",
description: "A JSON listing (e.g. a site's own notice-board API). Refuses to run until a person has confirmed the site's terms permit automated reading and set termsReviewed=true. Never used to get around a page that blocks crawlers.",
capabilities: { twoHop: !1, tableColumns: !1, jsonFeed: !0, needsTermsReview: !0 },
configKeys: ["feed", "termsReviewed", "maxItems", "delayMs", "allowDomains", "include", "exclude", "expectOrganization", "applyDomains"],
validateConfig(c) {
let f = c.feed;
if (!f) return "json-feed needs a feed: {url, title, link, \u2026}";
if (typeof f.url != "string" || !/^https:\/\//.test(f.url) || f.url.length > 500) return "feed.url must be an https URL";
for (let k of ["itemsPath", "title", "link", "date", "id", "group"]) if (f[k] !== void 0 && (typeof f[k] != "string" || !/^[A-Za-z0-9_.\[\]]{1,80}$/.test(f[k]))) return `feed.${k} must be a field path like "attachments[].path"`;
return !f.title || !f.link ? "feed.title and feed.link are required" : f.linkPrefix !== void 0 && (typeof f.linkPrefix != "string" || !/^https:\/\//.test(f.linkPrefix)) ? "feed.linkPrefix must be an https URL" : c.termsReviewed !== void 0 && typeof c.termsReviewed != "boolean" ? "termsReviewed must be true or false" : null;
},
refuse: (c) => c.termsReviewed === !0 ? null : "JSON feed not enabled: nobody has yet confirmed that this site's terms permit automated reading of the feed (set termsReviewed only after checking).",
listings: (_src, c) => c.feed?.url ? [{ url: c.feed.url, kind: "job" }] : [],
discover(_doc, _raw, ctx, parsed) {
let f = ctx.config.feed;
if (!f || !parsed?.json) return [];
let items = f.itemsPath ? pluck(parsed.json, f.itemsPath) : Array.isArray(parsed.json) ? parsed.json : Object.values(parsed.json).find((v2) => Array.isArray(v2) && v2.some((x) => x && typeof x == "object")) ?? [], max = Math.min(Math.max(ctx.config.maxItems ?? 10, 1), 25), include = ctx.config.include ? new RegExp(ctx.config.include, "i") : null, exclude = ctx.config.exclude ? new RegExp(ctx.config.exclude, "i") : null, out = [];
for (let it of (Array.isArray(items) ? items : []).flat()) {
let title = String(pluck(it, f.title)[0] ?? "").replace(/\s+/g, " ").trim(), date = f.date ? String(pluck(it, f.date)[0] ?? "") : "";
for (let p of pluck(it, f.link)) {
if (typeof p != "string" || !p) continue;
let url;
try {
url = new URL(p, f.linkPrefix ?? ctx.listingUrl).toString();
} catch {
continue;
}
if (hostAllowed(url, ctx.officialDomain, ctx.config.allowDomains) && !(include && !include.test(title) || exclude && exclude.test(title)) && (out.push({
url,
anchorText: title.slice(0, 300),
context: [title, date].filter(Boolean).join(`
`),
dateHint: findDates(date)[0]?.iso ?? (/^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : void 0),
kindHint: kindHintOf(title, ctx.listingKind),
externalId: f.id && String(pluck(it, f.id)[0] ?? "") || void 0,
group: f.group && String(pluck(it, f.group)[0] ?? "") || void 0
}), out.length >= max))
return out;
}
}
return out;
}
})
], ADAPTERS = adapters.map(({ key, label, description, capabilities, configKeys }) => ({ key, label, description, capabilities, configKeys }));
function getAdapter(key) {
return adapters.find((a) => a.key === key) ?? adapters[0];
}
function parseRobots(text2) {
let groups = /* @__PURE__ */ new Map(), agents = [], lastWasAgent = !1;
for (let raw of text2.split(/\r?\n/)) {
let line = raw.replace(/#.*$/, "").trim();
if (!line) continue;
let m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
if (!m) continue;
let key = m[1].toLowerCase(), val = m[2].trim();
if (key === "user-agent") {
lastWasAgent || (agents = []), agents.push(val.toLowerCase());
for (let a of agents) groups.has(a) || groups.set(a, { allow: [], disallow: [] });
lastWasAgent = !0;
continue;
}
lastWasAgent = !1;
for (let a of agents) {
let g = groups.get(a);
if (key === "allow" && val) g.allow.push(val);
else if (key === "disallow" && val) g.disallow.push(val);
else if (key === "crawl-delay") {
let n = Number(val);
Number.isFinite(n) && n >= 0 && (g.crawlDelaySec = n);
}
}
}
return { groups };
}
function rulesFor(r, agentToken) {
let token = agentToken.toLowerCase();
for (let [name, rules] of r.groups) if (name !== "*" && token.includes(name)) return rules;
return r.groups.get("*");
}
function toRegex(pattern) {
let anchored = pattern.endsWith("$"), body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
return new RegExp("^" + body + (anchored ? "$" : ""));
}
function robotsAllows(r, agentToken, path) {
let rules = rulesFor(r, agentToken);
if (!rules) return !0;
let best = null;
for (let [list, allow] of [[rules.allow, !0], [rules.disallow, !1]])
for (let p of list)
if (toRegex(p).test(path)) {
let len = p.replace(/\*/g, "").length;
(!best || len > best.len || len === best.len && allow) && (best = { len, allow });
}
return best ? best.allow : !0;
}
function selftest(html, text2) {
let doc = htmlToDoc(html, "https://example.gov.in/notices"), cands = getAdapter("table-listing").discover(doc, html, { officialDomain: "example.gov.in", listingUrl: "https://example.gov.in/notices", config: {} }), d2 = { type: "pdf", text: text2, headings: text2.split(`
`).slice(0, 12), links: [] }, t = pickTitle("", d2), k = classify(t.value, text2), n = normalize(k, t, extractFields(text2, []), { id: null, name: "T", organizationId: "o1", organizationName: "Org", organizationLevel: "central", departmentSlug: null, stateId: null, stateSlug: null, isAllIndia: !0, officialDomain: "example.gov.in", baseUrl: "https://example.gov.in", isSynthetic: !1 }, "https://example.gov.in/pdf/advt-05-2026.pdf");
return { digest: hashOf({ cands, n, links: doc.links, text: doc.text }), cands: cands.length, kind: k, conf: n.confidence, fields: Object.keys(n.extracted).length };
}
var BOT = "BharatSarkariJobsBot", docs = /* @__PURE__ */ new Map();
async function get(url) {
let r = await fetch(url, { credentials: "omit", redirect: "follow", cache: "no-store" }), body = new Uint8Array(await r.arrayBuffer());
return { status: r.status, ok: r.ok, ct: r.headers.get("content-type"), finalUrl: r.url, body };
}
async function robots(u) {
let origin = new URL(u).origin;
try {
let r = await get(origin + "/robots.txt"), text2 = new TextDecoder().decode(r.body), looksHtml = /<html|<!doctype/i.test(text2.slice(0, 500)), parsed = r.ok ? parseRobots(text2) : r.status === 401 || r.status === 403 ? parseRobots(`User-agent: *
Disallow: /`) : null, path = new URL(u).pathname + new URL(u).search;
return {
status: r.status,
ct: r.ct,
looksHtml,
rules: parsed ? parsed.groups.size : 0,
allowed: parsed ? robotsAllows(parsed, BOT, path) : !0,
excerpt: looksHtml ? "(HTML page, not a robots file)" : text2.slice(0, 400)
};
} catch (e) {
return { status: 0, error: String(e), allowed: !0, rules: 0 };
}
}
async function load(url) {
let r = await get(url), entry = { doc: await toDoc(r.body, r.ct, r.finalUrl), bytes: r.body.byteLength, ct: r.ct, hash: sha2562(r.body) };
return docs.set(url, entry), { r, ...entry };
}
async function listing(url, o) {
let rob = await robots(url), { r, doc, bytes, hash } = await load(url), raw = doc.type === "html" ? new TextDecoder().decode(r.body) : null, cands = r.ok ? getAdapter(o.adapter ?? "generic-listing").discover(doc, raw, { officialDomain: o.officialDomain, listingUrl: r.finalUrl, listingKind: o.kind, config: o.config ?? {} }) : [];
return {
url,
final: r.finalUrl,
status: r.status,
ct: r.ct,
bytes,
hash: hash.slice(0, 16),
docType: doc.type,
textLen: doc.text.length,
links: doc.links.length,
robots: rob,
candidates: cands.map((c) => ({ url: c.url, title: c.anchorText.slice(0, 140), date: c.dateHint, kind: c.kindHint }))
};
}
async function notice(url, o) {
let rob = await robots(url), { r, doc, bytes, hash } = await load(url), ctx = {
id: null,
name: "",
organizationId: null,
organizationName: null,
organizationLevel: null,
departmentSlug: null,
stateId: null,
stateSlug: null,
isAllIndia: !0,
officialDomain: null,
baseUrl: null,
isSynthetic: !1,
...o.ctx
}, title = pickTitle(o.anchorText ?? "", doc), kind = title ? classify(title.value, doc.text, o.kindHint) : null, base2 = {
url,
status: r.status,
ct: r.ct,
bytes,
hash: hash.slice(0, 16),
docType: doc.type,
pages: doc.pages,
textLen: doc.text.length,
textChars: doc.text.replace(/\s/g, "").length,
robotsAllowed: rob.allowed,
title: title?.value
};
if (!title || !kind) return { ...base2, kind: null, skipped: title ? "not a notice" : "no title" };
let x = extractFields(`${doc.text}
${o.context ?? ""}`, doc.links), n = normalize(kind, title, x, ctx, url);
return doc.type === "pdf" && doc.text.replace(/\s/g, "").length < 200 && (n.issues.push("scanned / no text layer"), n.confidence = "LOW"), { ...base2, kind, confidence: n.confidence, score: n.score, fingerprint: n.fingerprint, extracted: n.extracted, fieldConfidence: n.fieldConfidence, issues: n.issues };
}
function snip(url, pattern, width = 160, max = 4) {
let d = docs.get(url);
if (!d) return [];
let re = new RegExp(pattern, "gi"), t = d.doc.text, out = [];
for (let m of t.matchAll(re))
if (out.push(t.slice(Math.max(0, m.index - width / 2), m.index + width).replace(/\s+/g, " ")), out.length >= max) break;
return out;
}
function text(url) {
return docs.get(url)?.doc.text ?? null;
}
function docInfo(url) {
let d = docs.get(url);
return d ? { type: d.doc.type, pages: d.doc.pages, bytes: d.bytes, hash: d.hash, links: d.doc.links.slice(0, 40) } : null;
}
return {docInfo, listing, notice, robots, selftest, snip, text};
};
window.BSJ = await window.__bsjSrc();
Object.keys(window.BSJ).join(",");
