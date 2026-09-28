/**
 * Deterministic field extraction for Indian government recruitment notices (HTML pages and PDF text).
 * Rules, not AI: every value found here can be traced to a matched phrase ("evidence") in the official text, and each
 * carries its own confidence (1 = found next to an explicit label, lower = heuristic). Anything ambiguous is reported as an
 * issue for the reviewer instead of being guessed.
 */

export interface Found<T> { value: T; confidence: number; evidence: string }
export interface Extraction {
  title?: Found<string>;
  advertisementNo?: Found<string>;
  notificationDate?: Found<string>;
  applicationStart?: Found<string>;
  lastDate?: Found<string>;
  correctionDate?: Found<string>;
  examDate?: Found<string> & { tentative?: boolean };
  admitCardDate?: Found<string>;
  resultDate?: Found<string>;
  objectionStart?: Found<string>;
  objectionLast?: Found<string>;
  totalVacancies?: Found<number>;
  ageMin?: Found<number>;
  ageMax?: Found<number>;
  payLevel?: Found<string>;
  salary?: Found<string>;
  feeGeneral?: Found<string>;
  feeReserved?: Found<string>;
  qualifications?: Found<string[]>;
  selectionProcess?: Found<string[]>;
  applyUrl?: Found<string>;
  notificationUrl?: Found<string>;
  issues: string[];
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const pad = (n: number) => String(n).padStart(2, "0");

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;   // 31 Feb etc.
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Every date in a string, in order of appearance. Indian day-first numeric dates; written months in either order. */
export function findDates(s: string): { iso: string; index: number; raw: string }[] {
  const out: { iso: string; index: number; raw: string }[] = [];
  const seen = new Set<number>();
  const push = (index: number, raw: string, v: string | null) => { if (v && !seen.has(index)) { seen.add(index); out.push({ iso: v, index, raw }); } };
  for (const m of s.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/g)) push(m.index!, m[0], iso(Number(m[3]), Number(m[2]), Number(m[1])));
  for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s.-]*${MON}[\\s.,-]*(\\d{4})\\b`, "gi"))) push(m.index!, m[0], iso(Number(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()] ?? MONTHS[m[2].slice(0, 4).toLowerCase()], Number(m[1])));
  for (const m of s.matchAll(new RegExp(`\\b${MON}[\\s.]+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})\\b`, "gi"))) push(m.index!, m[0], iso(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2])));
  for (const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m.index!, m[0], iso(Number(m[1]), Number(m[2]), Number(m[3])));
  return out.sort((a, b) => a.index - b.index);
}

/** Lines (or sentence-ish segments) of the text, so a label and its value are looked for close together. */
function segments(text: string): string[] {
  return text.split(/\n|(?<=\.)\s{2,}|\s\|\s|\t/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Find a date that follows one of the labels, on the same segment (or the next one when the label ends the line —
 * common in two-column PDF tables). Returns all distinct candidates so callers can detect conflicts.
 */
function labelledDates(text: string, label: RegExp, window = 120): { iso: string; evidence: string; span: string }[] {
  const segs = segments(text); const out: { iso: string; evidence: string; span: string }[] = [];
  for (let i = 0; i < segs.length; i++) {
    const m = label.exec(segs[i]);
    if (!m) continue;
    const after = segs[i].slice(m.index + m[0].length, m.index + m[0].length + window);
    let ds = findDates(after);
    let evidence = segs[i];
    // `span` = the label up to its date. Qualifier checks (fee payment? correction window?) look ONLY at this span: the rest of
    // the line can say anything ("In partial modification of the notice…, the last date … is 10/11/2026" is still the last date).
    const pre = segs[i].slice(Math.max(0, m.index - 25), m.index);           // "Fee Last Date" — the qualifier can precede the label
    let span = pre + segs[i].slice(m.index, m.index + m[0].length + (ds[0]?.index ?? after.length));
    // The value is often in the next cell / line when the label ends the line ("Last date of online application" ⏎ "30/10/2026").
    if (!ds.length && !/\d/.test(after) && after.length < 40 && !/\bas\s+(?:under|follows)\b/i.test(after) && segs[i + 1]) {
      ds = findDates(segs[i + 1].slice(0, window)); evidence = `${segs[i]} ${segs[i + 1]}`; span = `${pre}${segs[i].slice(m.index)} ${segs[i + 1].slice(0, ds[0]?.index ?? 0)}`;
    }
    if (ds.length) out.push({ iso: ds[0].iso, evidence: evidence.slice(0, 200), span });
  }
  return out;
}

function pickDate(text: string, label: RegExp, name: string, issues: string[]): Found<string> | undefined {
  let c = labelledDates(text, label);
  // "Last date for making online fee payment" / "…correction window" are separate deadlines, not the application last date.
  if (label === L.last) c = c.filter((x) => !NOT_APPLICATION_WINDOW.test(x.span));
  if (!c.length) return undefined;
  const distinct = [...new Set(c.map((x) => x.iso))];
  if (distinct.length > 1) {
    issues.push(`Several different ${name} dates in the source (${distinct.join(", ")}) — check which one is current (a corrigendum may have changed it)`);
    return { value: c[c.length - 1].iso, confidence: 0.4, evidence: c[c.length - 1].evidence };   // later mention wins, low confidence
  }
  return { value: c[0].iso, confidence: 1, evidence: c[0].evidence };
}

const L = {
  last: /\b(last|closing|end)\s*date\b[^:\n]{0,60}?(?:application|registration|apply|submission|online|receipt|fee)?|\bdate\s+of\s+closing\b|\bclosing\s+date\b|\blast\s+date\s+(?:for|of)\b/i,
  start: /\b(?:(?:start(?:ing)?|opening|commencement)\s+(?:date\s+)?(?:of|for)\s+(?:online\s+)?(?:application|registration|submission)|(?:online\s+)?(?:application|registration)s?\s+(?:start|begin|open)s?(?:\s+(?:from|on))?|opening\s+date)\b/i,
  notif: /\b(?:date\s+of\s+(?:notification|advertisement|publication|issue)|notification\s+date|advertisement\s+date|publication\s+date)\b/i,
  correction: /\b(?:correction|modification|edit)\s+(?:window|date|facility)\b/i,
  exam: /\b(?:(?:tentative\s+)?(?:date|schedule)\s+of\s+(?:the\s+)?(?:computer[\s-]based\s+|written\s+|preliminary\s+|main\s+)?(?:exam(?:ination)?|test|cbt)|(?:exam(?:ination)?|cbt|written\s+test)\s+(?:date|will\s+be\s+(?:held|conducted)\s+on))\b/i,
  admit: /\b(?:admit\s+card|hall\s+ticket|e-?admit\s+card|call\s+letter)s?\b[^:\n]{0,40}?(?:release|available|issue|download)/i,
  result: /\bresults?\s+(?:date|declaration|will\s+be\s+declared|declared\s+on|announced)\b/i,
  objStart: /\b(?:objections?|representations?|challenge)\b[^:\n]{0,40}?\b(?:from|start|open)/i,
  objLast: /\b(?:last\s+date\s+(?:for|of|to)\s+(?:submit(?:ting)?\s+)?(?:objections?|representations?|challeng))|\bobjections?\b[^:\n]{0,40}?\b(?:till|upto|up\s+to|last\s+date|by)\b/i,
};

/** Windows that mention "application" but are not the application period (found in real SSC notice headers). */
const NOT_APPLICATION_WINDOW = /\bfee\s*(?:last|closing|end)\s*date\b|\b(?:correction|modification|edit(?:ing)?|fee\s+payment|payment\s+of\s+(?:the\s+)?fee|making\s+(?:online\s+)?(?:fee\s+)?payment|challan)\b/i;

/** "Online application from 01/10/2026 to 31/10/2026" → start + last with full confidence. */
function applicationRange(text: string): { start: Found<string>; last: Found<string> } | undefined {
  for (const seg of segments(text)) {
    if (!/\b(?:application|registration|apply|online)\b/i.test(seg)) continue;
    if (NOT_APPLICATION_WINDOW.test(seg)) continue;               // correction / fee-payment windows are not the application period
    // "from 01/10/2026 to 31/10/2026" or, in notice headers, "Dates for submission of online applications 07.09.2026 to 07.10.2026"
    const pairs = [/\bfrom\b(.{0,40}?)\b(?:to|till|upto|up\s+to)\b(.{0,40})/i.exec(seg), ...seg.matchAll(/(\S{6,12})\s+(?:to|till|upto|up\s+to|–|-)\s+(\S{6,40})/gi)];
    for (const m of pairs) {
      if (!m) continue;
      const a = findDates(m[1])[0], b = findDates(m[2])[0];
      if (a && b && a.iso <= b.iso) return { start: { value: a.iso, confidence: 1, evidence: seg.slice(0, 200) }, last: { value: b.iso, confidence: 1, evidence: seg.slice(0, 200) } };
    }
  }
  return undefined;
}

/**
 * The notice's own reference number. Real notices cite OTHER documents' numbers in their body ("vide Notification
 * No. 38-16/2020-DDIII dated 04.01.2021" appears in every SSC notice), so only the document head is searched for generic
 * "Notice/Notification No." and file ("F. No.") references; an explicit "Advt./Advertisement No." is accepted anywhere.
 */
const HEAD_CHARS = 4000;
const REF = "([A-Z0-9][A-Za-z0-9/().\\-–]{0,38}[A-Za-z0-9)])";
export function extractAdvertisementNo(text: string): Found<string> | undefined {
  const head = text.slice(0, HEAD_CHARS);
  const tries: [RegExp, string, number][] = [
    [new RegExp(`\\b(?:advt\\.?|advertisement|adv\\.|employment\\s+notice|cen|recruitment\\s+notice)\\s*(?:no\\.?|number|num\\.?)\\s*[:.–-]?\\s*${REF}`, "i"), head, 1],
    [new RegExp(`\\b(?:f\\.?|file)\\s*no\\.?\\s*[:.–-]?\\s*${REF}`, "i"), head, 1],
    [new RegExp(`\\b(?:notification|notice)\\s*(?:no\\.?|number|num\\.?)\\s*[:.–-]?\\s*${REF}`, "i"), head, 0.8],
    [new RegExp(`\\b(?:advt\\.?|advertisement)\\s*(?:no\\.?|number)\\s*[:.–-]?\\s*${REF}`, "i"), text, 0.8],
  ];
  for (const [re, where, confidence] of tries) {
    const m = re.exec(where);
    if (!m) continue;
    const v = m[1].replace(/[–]/g, "-").replace(/\s+/g, "").replace(/\)$/, (x, _i, str: string) => (str.includes("(") ? x : ""));   // "(Advt. No. X/07)" → "X/07"
    if (!/\d/.test(v) || v.length < 2) continue;          // "No. of posts" etc. are not references
    return { value: v, confidence, evidence: m[0].slice(0, 120) };
  }
  return undefined;
}

export function extractVacancies(text: string, issues: string[]): Found<number> | undefined {
  // Category-wise total row ("TOTAL VACANCIES 997 328 278 126 250 1979 84 42 8" under "UR OBC SC ST EWS TOTAL"): the
  // TOTAL column is the one that equals the sum of the five category columns — a self-check, not a guess.
  for (const m of text.matchAll(/\btotal(?:\s+(?:no\.?\s+of\s+)?(?:vacanc(?:y|ies)|posts?))?\s*[:=–-]?\s*((?:\d{1,6}\s+){5,}\d{1,6})/gi)) {
    const n = m[1].trim().split(/\s+/).map(Number);
    for (let k = 5; k < n.length; k++) {
      const cats = n.slice(k - 5, k);
      if (n[k] > 0 && n[k] < 500000 && cats.reduce((a, b) => a + b, 0) === n[k]) return { value: n[k], confidence: 1, evidence: m[0].slice(0, 120) };
    }
  }
  // Interleaved labels ("UR 40 OBC 27 SC 15 ST 7 EWS 11 Total 100"): the total must equal the sum of the vertical categories.
  for (const m of text.matchAll(/((?:\b(?:UR|GEN(?:ERAL)?|OBC|SC|ST|EWS)\b\s*[:=–-]?\s*\d{1,6}[\s,;/]*){3,})\btotal\b\s*[:=–-]?\s*(\d{1,6})\b/gi)) {
    const parts = [...m[1].matchAll(/\b(?:UR|GEN(?:ERAL)?|OBC|SC|ST|EWS)\b\s*[:=–-]?\s*(\d{1,6})/gi)].map((p) => Number(p[1]));
    const total = Number(m[2]);
    if (total > 0 && total < 500000) {
      if (parts.reduce((a, b) => a + b, 0) === total) return { value: total, confidence: 1, evidence: m[0].slice(0, 120) };
      issues.push(`The category figures (${parts.join(" + ")}) do not add up to the stated total ${total} — check the vacancy table`);
      return { value: total, confidence: 0.5, evidence: m[0].slice(0, 120) };
    }
  }
  const labelled = [...text.matchAll(/\b(?:total\s+(?:no\.?\s+of\s+)?(?:posts?|vacanc(?:y|ies))|(?:no\.?|number)\s+of\s+(?:posts?|vacanc(?:y|ies))|total\s+vacanc(?:y|ies))\s*[:=–-]?\s*(\d{1,3}(?:,\d{2,3})*|\d{1,6})\b/gi)];
  const nums = [...new Set(labelled.map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n > 0 && n < 500000))];
  if (nums.length === 1) return { value: nums[0], confidence: 1, evidence: labelled[0][0].slice(0, 120) };
  if (nums.length > 1) {
    issues.push(`More than one vacancy total mentioned (${nums.join(", ")}) — confirm the correct total`);
    return { value: Math.max(...nums), confidence: 0.4, evidence: labelled.map((m) => m[0]).join(" · ").slice(0, 200) };
  }
  // "(?!\.\d)": "2. Vacancies:\n2.1 Tentative vacancies…" — a section number is not a count (SSC CHSL 2026).
  const tentative = /\b(?:tentative\s+)?vacanc(?:y|ies)\s*[:=–-]\s*(?:approx(?:\.|imately)?\s*)?(\d{1,3}(?:,\d{2,3})*|\d{1,6})\b(?!\.\d)/i.exec(text);
  if (tentative) { const n = Number(tentative[1].replace(/,/g, "")); if (n > 0 && n < 500000) return { value: n, confidence: 0.8, evidence: tentative[0] }; }
  const loose = /(?<![\d.])\b(\d{1,3}(?:,\d{2,3})*|\d{1,6})\s+(?:tentative\s+)?(?:posts|vacancies)\b/i.exec(text);   // not "2.1 Tentative vacancies"
  if (loose) { const n = Number(loose[1].replace(/,/g, "")); if (n > 0 && n < 500000) return { value: n, confidence: 0.6, evidence: loose[0] }; }
  return undefined;
}

export function extractAge(text: string, issues: string[]): { min?: Found<number>; max?: Found<number> } {
  const segs = segments(text);
  // Long notices mention "age" many times ("Age Limit (as on 01-08-2026):" on its own line, relaxation tables…) — look at
  // the first few age segments (plus the line after each) for an explicit range.
  const idx = segs.map((s, i) => (/\bage\b/i.test(s) ? i : -1)).filter((i) => i >= 0).slice(0, 8);
  if (!idx.length) return {};
  let seg = "";
  for (const i of idx) {
    const cand = /\d{2}\s*(?:to|-|–|and)\s*\d{2}\s*(?:years|yrs)/i.test(segs[i]) ? segs[i] : `${segs[i]} ${segs[i + 1] ?? ""}`;
    const range = /\b(\d{2})\s*(?:to|-|–|and)\s*(\d{2})\s*(?:years|yrs)\b/i.exec(cand) ?? /\bbetween\s+(\d{2})\s*(?:and|to|-)\s*(\d{2})\b/i.exec(cand)
      ?? /\bmin(?:imum)?\.?\s*(?:age\s*)?(?:of\s*)?(\d{2})\s*(?:years|yrs)\b[^.\n]{0,40}?\bmax(?:imum)?\.?\s*(?:age\s*)?(?:of\s*)?(\d{2})\s*(?:years|yrs)\b/i.exec(cand);
    if (range) {
      const a = Number(range[1]), b = Number(range[2]);
      if (a >= 14 && b <= 70 && a < b) return { min: { value: a, confidence: 1, evidence: cand.slice(0, 160) }, max: { value: b, confidence: 1, evidence: cand.slice(0, 160) } };
    }
    if (!seg && /\d{2}/.test(cand)) seg = cand;
  }
  const mn = /\bmin(?:imum)?\.?\s*age[^0-9]{0,15}(\d{2})/i.exec(text), mx = /\bmax(?:imum)?\.?\s*age[^0-9]{0,15}(\d{2})/i.exec(text);
  const out: { min?: Found<number>; max?: Found<number> } = {};
  if (mn && Number(mn[1]) >= 14 && Number(mn[1]) <= 60) out.min = { value: Number(mn[1]), confidence: 1, evidence: mn[0] };
  if (mx && Number(mx[1]) >= 16 && Number(mx[1]) <= 70) out.max = { value: Number(mx[1]), confidence: 1, evidence: mx[0] };
  if (out.min && out.max && out.min.value >= out.max.value) { issues.push("Minimum age is not below maximum age — check the age limit"); return {}; }
  if (!out.min && !out.max) {
    const notExceed = /\bnot\s+(?:exceed|be\s+more\s+than)\s+(\d{2})\s*years/i.exec(seg);
    if (notExceed) out.max = { value: Number(notExceed[1]), confidence: 0.8, evidence: notExceed[0] };
  }
  return out;
}

const money = (s: string) => `Rs. ${s.replace(/\s/g, "")}`;
export function extractPay(text: string): { payLevel?: Found<string>; salary?: Found<string> } {
  const out: { payLevel?: Found<string>; salary?: Found<string> } = {};
  const lvl = /\bpay\s*(?:matrix\s*)?level[\s-]*(\d{1,2})\b/i.exec(text) ?? /\blevel[\s-]*(\d{1,2})\s*\(\s*(?:rs\.?|₹)/i.exec(text);
  if (lvl) out.payLevel = { value: `Level ${lvl[1]}`, confidence: 1, evidence: lvl[0] };
  // "Level-6 (Rs. 35400-112400/-)" / "Pay Level-2 (Rs. 19,900- 63,200)": the range next to the level is the pay scale.
  const lvlRange = /\blevel[\s-]*\d{1,2}\s*\(\s*(?:rs\.?|₹)\s*([\d,]{4,})\s*(?:\/-)?\s*(?:-|–|to)\s*(?:rs\.?|₹)?\s*([\d,]{4,})/i.exec(text);
  if (lvlRange) { out.salary = { value: `${money(lvlRange[1])} – ${money(lvlRange[2])}`, confidence: 1, evidence: lvlRange[0].slice(0, 160) }; return out; }
  const seg = segments(text).find((s) => /\b(?:pay|salary|scale|emoluments?|stipend)\b/i.test(s) && /(?:rs\.?|₹|inr)\s*[\d,]{4,}/i.test(s));
  if (seg) {
    const r = /(?:rs\.?|₹|inr)\s*([\d,]{4,})\s*(?:\/-)?\s*(?:-|–|to)\s*(?:rs\.?|₹|inr)?\s*([\d,]{4,})/i.exec(seg);
    if (r) out.salary = { value: `${money(r[1])} – ${money(r[2])}`, confidence: 1, evidence: seg.slice(0, 160) };
    else { const one = /(?:rs\.?|₹|inr)\s*([\d,]{4,})/i.exec(seg); if (one) out.salary = { value: money(one[1]), confidence: 0.7, evidence: seg.slice(0, 160) }; }
  }
  return out;
}

export function extractFees(text: string): { general?: Found<string>; reserved?: Found<string> } {
  const all = segments(text);
  // PDF lines wrap: "…Ex-servicemen (ESM) eligible for reservation are exempted from payment of" / "fee." — read each fee line
  // together with the two lines before it, so the categories and the exemption stay in one sentence.
  const lines = all.map((s, i) => ({ s, ctx: [all[i - 2], all[i - 1], s].filter(Boolean).join(" ") })).filter((l) => /\bfees?\b/i.test(l.s));
  const out: { general?: Found<string>; reserved?: Found<string> } = {};
  const RES = /\b(?:sc|st|pwd|pwbd|women|female|ex-?servicemen|esm|reserved)\b/i;
  const AMT = /(?:rs\.?|₹|inr)\s*([\d,]{2,6})/i;
  for (const { s: own, ctx } of lines) {
    // the amount comes from the fee line itself; the categories/exemption may sit on the wrapped lines just before it
    const s = !RES.test(own) && !AMT.test(own) && /\bexempt/i.test(ctx) && RES.test(ctx) ? ctx.slice(ctx.search(RES)) : own;
    const resAt = s.search(RES);
    const amt = AMT.exec(s);
    const generalNamed = /\b(?:general|ur|unreserved|obc|ews)\b/i.test(s);
    // "Fee payable: ₹100/-. Women and SC/ST/PwBD/ESM candidates are exempted" — ₹100 is the general fee.
    if (amt && !out.general && (resAt < 0 || amt.index < resAt || /\b(?:general|ur|unreserved|obc|ews)\b[^.]{0,20}(?:rs|₹)/i.test(s)))
      out.general = { value: money(amt[1]), confidence: generalNamed ? 1 : 0.7, evidence: s.slice(0, 160) };
    if (resAt >= 0 && !out.reserved) {
      const tail = s.slice(resAt);
      if (/\b(?:no\s+fee|nil|exempt(?:ed)?|fee\s+is\s+not\s+payable)\b/i.test(tail)) out.reserved = { value: "Nil (exempted)", confidence: 0.9, evidence: s.slice(0, 160) };
      else {
        // "Rs.2,000/- for General Category candidates and Rs.500/- for reserved category candidates [SC/ST/PwD]" (Delhi HC)
        const before = /(?:rs\.?|₹|inr)\s*([\d,]{2,6})\s*(?:\/-)?\s*(?:\([^)]*\)\s*)?(?:for|to\s+be\s+paid\s+by)\s+(?:the\s+)?(?:reserved|sc|st|pwd|pwbd|women|female|ex-?servicemen)/i.exec(s);
        const ra = before ?? AMT.exec(tail);
        if (ra && (before || !amt || ra.index + resAt !== amt.index || resAt < amt.index)) out.reserved = { value: money(ra[1]), confidence: 0.8, evidence: s.slice(0, 160) };
      }
    }
  }
  return out;
}

/** Qualification words → the site's qualification slugs. Only recognised, explicit words count. */
const QUAL_RULES: [RegExp, string][] = [
  [/\b(?:10th|matric(?:ulation)?|high\s+school|class\s*(?:x|10)|sslc|secondary\s+school)\b/i, "10th-pass"],
  [/\b(?:12th|intermediate|higher\s+secondary|class\s*(?:xii|12)|hsc|10\+2|senior\s+secondary)\b/i, "12th-pass"],
  [/\b(?:iti|i\.t\.i\.?|industrial\s+training\s+institute)(?![a-z])/i, "iti"],
  [/\bdiploma\b/i, "diploma"],
  [/\b(?:graduat(?:e|ion)|bachelor'?s?\s+degree|degree\s+from\s+a\s+recogni[sz]ed|b\.?\s?a\.?|b\.?\s?sc\.?|b\.?\s?com\.?)\b/i, "graduate"],
  [/\b(?:post[\s-]?graduat(?:e|ion)|master'?s?\s+degree|m\.?\s?a\.?|m\.?\s?sc\.?|m\.?\s?com\.?|mba)\b/i, "post-graduate"],
  // "B.E." needs its dots — a bare "be" is the English verb ("must be a citizen of India" read as an engineering degree in the pilot).
  [/(?:\bb\.\s?e\.|\bb\.?\s?tech\b|\bm\.?\s?tech\b|\bengineering\s+degree\b|\bdegree\s+in\s+(?:\w+\s+){0,3}engineering\b|\bdiploma\s+in\s+(?:\w+\s+){0,2}engineering\b)/i, "engineering"],
  [/\b(?:mbbs|bds|b\.?\s?sc\.?\s+nursing|gnm|anm|b\.?\s?pharm|d\.?\s?pharm)\b/i, "medical"],
  [/\b(?:llb|ll\.b|llm|law\s+graduate|degree\s+in\s+law|advocate|enrolled\s+with\s+(?:the\s+)?bar\s+council)\b/i, "law"],
  [/\b(?:b\.?\s?ed|d\.?\s?el\.?\s?ed|ctet|tet)\b/i, "teaching"],
];
export function extractQualifications(text: string): Found<string[]> | undefined {
  const segs = segments(text); const picked: string[] = [];
  segs.forEach((s, i) => {
    if (!/\b(?:qualification|eligib|educational|pass(?:ed)?|degree|diploma|matric|advocate)/i.test(s)) return;
    if (/\b(?:date\s+of\s+birth|dob|certificate\s+(?:as|for)\s+(?:proof|date))\b/i.test(s)) return;   // DOB proof, not eligibility
    picked.push(s);
    if (s.length < 60 && segs[i + 1]) picked.push(segs[i + 1]);      // label on one line / cell, value on the next
  });
  const seg = picked.join("\n");
  if (!seg) return undefined;
  const found = [...new Set(QUAL_RULES.filter(([re]) => re.test(seg)).map(([, slug]) => slug))];
  return found.length ? { value: found, confidence: 0.8, evidence: seg.slice(0, 200) } : undefined;
}

const STAGES: [RegExp, string][] = [
  [/\b(?:computer[\s-]based\s+(?:test|exam(?:ination)?)|cbt)\b/i, "Computer Based Test"],
  [/\bwritten\s+(?:test|exam(?:ination)?)\b/i, "Written Examination"],
  [/\b(?:preliminary|prelims?)\s+exam/i, "Preliminary Examination"],
  [/\bmains?\s+exam/i, "Main Examination"],
  [/\b(?:physical\s+(?:efficiency|endurance|standard|measurement)\s+test|pet|pst)\b/i, "Physical Test (PET/PST)"],
  [/\b(?:skill|typing|stenography|trade)\s+test\b/i, "Skill Test"],
  [/\b(?:interview|personality\s+test|viva)\b/i, "Interview"],
  [/\bdocument\s+verification\b/i, "Document Verification"],
  [/\bmedical\s+(?:exam(?:ination)?|test)\b/i, "Medical Examination"],
];
export function extractSelection(text: string): Found<string[]> | undefined {
  const seg = segments(text).filter((s) => /\b(?:selection|stage|mode\s+of|scheme\s+of|process)\b/i.test(s)).join("\n") || "";
  const found = STAGES.filter(([re]) => re.test(seg)).map(([, n]) => n);
  return found.length ? { value: found, confidence: 0.8, evidence: seg.slice(0, 200) } : undefined;
}

export function extractFields(rawText: string, links: { href: string; text: string }[] = []): Extraction {
  const text = rawText.replace(/\bpage\s+\d{1,3}\s+of\s+\d{1,3}\b/gi, " ");      // PDF page footers are not data
  const issues: string[] = [];
  const x: Extraction = { issues };
  x.advertisementNo = extractAdvertisementNo(text);
  const advts = [...new Set([...text.slice(0, HEAD_CHARS).matchAll(new RegExp(`\\b(?:advt\\.?|advertisement)\\s*(?:no\\.?|number)\\s*[:.–-]?\\s*${REF}`, "gi"))].map((m) => m[1].replace(/[–]/g, "-").replace(/\)$/, (x, i, str) => (str.includes("(") ? x : ""))).filter((v) => /\d/.test(v)))];
  if (advts.length > 1) issues.push(`The notice names several advertisement numbers (${advts.join(", ")}) — check which one this record is for`);
  x.notificationDate = pickDate(text, L.notif, "notification", issues);
  const range = applicationRange(text);
  x.applicationStart = pickDate(text, L.start, "application start", issues) ?? range?.start;
  x.lastDate = pickDate(text, L.last, "last", issues) ?? range?.last;
  if (range && x.lastDate && x.lastDate.value !== range.last.value && x.lastDate.confidence === 1) {
    issues.push(`The application period (${range.start.value} to ${range.last.value}) and the stated last date (${x.lastDate.value}) disagree`);
    x.lastDate = { ...x.lastDate, confidence: 0.4 };
  }
  x.correctionDate = pickDate(text, L.correction, "correction", issues);
  const ex = pickDate(text, L.exam, "exam", issues);
  if (ex) x.examDate = { ...ex, tentative: /\btentative|likely|probable|expected\b/i.test(ex.evidence) };
  x.admitCardDate = pickDate(text, L.admit, "admit card", issues);
  x.resultDate = pickDate(text, L.result, "result", issues);
  x.objectionStart = pickDate(text, L.objStart, "objection start", issues);
  x.objectionLast = pickDate(text, L.objLast, "objection last", issues);
  x.totalVacancies = extractVacancies(text, issues);
  const age = extractAge(text, issues); x.ageMin = age.min; x.ageMax = age.max;
  const pay = extractPay(text); x.payLevel = pay.payLevel; x.salary = pay.salary;
  const fee = extractFees(text); x.feeGeneral = fee.general; x.feeReserved = fee.reserved;
  x.qualifications = extractQualifications(text);
  x.selectionProcess = extractSelection(text);
  const apply = links.find((l) => /\b(?:apply\s+online|online\s+application|registration|apply\s+here|click\s+here\s+to\s+apply)\b/i.test(l.text) || /\/(?:apply|registration|register|onlineapp)/i.test(l.href));
  if (apply) x.applyUrl = { value: apply.href, confidence: /apply|registration/i.test(apply.text) ? 1 : 0.7, evidence: apply.text || apply.href };
  const notif = links.find((l) => /\.pdf($|\?)/i.test(l.href) && /\b(?:notification|advertisement|advt|notice|detailed)\b/i.test(l.text + " " + l.href));
  if (notif) x.notificationUrl = { value: notif.href, confidence: 1, evidence: notif.text || notif.href };

  // Sanity rules (the reviewer sees these; nothing is silently "fixed").
  if (x.applicationStart && x.lastDate && x.applicationStart.value > x.lastDate.value) issues.push("Application start date is after the last date");
  if (x.notificationDate && x.lastDate && x.notificationDate.value > x.lastDate.value) issues.push("Notification date is after the last date");
  if (x.objectionStart && x.objectionLast && x.objectionStart.value > x.objectionLast.value) issues.push("Objection window starts after it ends");
  return x;
}

/** Corrigenda, addenda, cancellations and date changes (see normalize.ts `isAmendment`). */
export const AMENDMENT = /\b(?:corrigend(?:um|a)|addend(?:um|a)|errat(?:um|a)|clarification|notice\s+regarding\s+change|cancell?ation|revival|revision\s+of\s+vacanc|revised\s+(?:dates?|schedule|notice|programme)|re-?schedul(?:ed|ing)|postpone(?:d|ment)|extension\s+of\s+(?:the\s+)?(?:last\s+)?date|(?:last\s+)?date\s+(?:is\s+|has\s+been\s+)?extended|change\s+in\s+(?:the\s+)?(?:date|schedule|exam))/i;

/** A good title: the link text from the listing when it is descriptive, else the first strong line of the document. */
export function pickTitle(anchorText: string | undefined, doc: { title?: string; headings: string[]; text: string }): Found<string> | undefined {
  const clean = (s: string) => s.replace(/\s+/g, " ").replace(/\b(?:new|click here|download|view|pdf|\(\s*\d+(?:\.\d+)?\s*[km]b\s*\))\b/gi, " ").replace(/\s+/g, " ").trim();
  const strong = /\b(recruitment|notification|advertisement|advt|vacanc|examination|exam|admit\s+card|hall\s+ticket|result|answer\s+key|calendar|schedule|bharti|भर्ती)\b/i;
  const a = anchorText ? clean(anchorText) : "";
  if (a.length >= 12 && a.length <= 300 && strong.test(a)) return { value: a, confidence: 1, evidence: anchorText! };
  // The official listing's own words ("Addendum Notice: 09 posts of Scientist-B …") beat a page's sidebar headings.
  if (a.length >= 12 && a.length <= 300 && /\b(?:notice|posts?|corrigendum|addendum|clarification)\b/i.test(a)) return { value: a, confidence: 0.9, evidence: anchorText! };
  // No listing text (a single notice URL checked by hand): a corrigendum announces itself in its first lines —
  // "CORRIGENDUM TO IMPORTANT NOTICE DATED 12.08.2026" (SSC). Keep that word in the title so it is treated as an amendment.
  const head = doc.text.split("\n").slice(0, 12).map(clean);
  const amendLine = !a ? head.find((l) => l.length >= 8 && l.length <= 200 && AMENDMENT.test(l)) : undefined;
  if (amendLine) {
    const subject = head.find((l) => l !== amendLine && l.length >= 15 && strong.test(l));
    return { value: subject ? `${amendLine} — ${subject}`.slice(0, 300) : amendLine, confidence: 0.7, evidence: amendLine };
  }
  for (const h of doc.headings) { const c = clean(h); if (c.length >= 12 && c.length <= 300 && strong.test(c)) return { value: c, confidence: 0.8, evidence: h }; }
  const line = doc.text.split("\n").map(clean).find((l) => l.length >= 15 && l.length <= 300 && strong.test(l));
  if (line) return { value: line, confidence: 0.7, evidence: line };
  if (a.length >= 8) return { value: a, confidence: 0.5, evidence: anchorText! };
  if (doc.title && doc.title.length >= 8) return { value: clean(doc.title), confidence: 0.4, evidence: doc.title };
  return undefined;
}
