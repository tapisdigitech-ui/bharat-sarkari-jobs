/**
 * LGD import rules. The CSV below is SYNTHETIC and deliberately fake ("Testland" districts) — it only exercises the parser and
 * the quality checks. Real district lists come only from lgdirectory.gov.in (see scripts/import-lgd.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLgd, parseLgdDistricts } from "../src/lib/reference/lgd";

const CSV = `"LGD Codes of Districts",,,,
S.No.,State Code,State Name (In English),District Code,District Name (In English),District Name (In Local language)
1,90001,Testland Alpha,99901,Synthetic North,
2,90001,Testland Alpha,99902,Synthetic South,
3,90001,Testland Alpha,99902,Synthetic South Duplicate Code,
4,90002,Testland Beta,99903,Synthetic East,
5,90002,Testland Beta,99904,synthetic  east,
6,90003,Outside Scope,99905,Synthetic West,
7,90001,Testland Alpha,,Missing Code,
`;
test("LGD parser + quality report (synthetic)", () => {
  const parsed = parseLgdDistricts(CSV);
  assert.equal(parsed.rows.length, 6); assert.equal(parsed.bad.length, 1);
  const { inScope, report } = checkLgd(parsed, [{ slug: "testland-alpha", name: "Testland Alpha" }, { slug: "testland-beta", name: "Testland Beta" }],
    [{ id: 1, stateSlug: "testland-alpha", slug: "synthetic-north", name: "Synthetic Nrth", lgdCode: "99901" },
     { id: 2, stateSlug: "testland-alpha", slug: "old-district", name: "Old District", lgdCode: "99800" }]);
  assert.equal(inScope.length, 5);
  assert.deepEqual(report.duplicateCodes, ["99902"]);
  assert.equal(report.duplicateNames.length, 1, "same name (after normalising case/spaces) twice in one state");
  assert.deepEqual(report.unknownStates, ["Outside Scope"]);
  assert.deepEqual(report.nameChanges, [{ code: "99901", ours: "Synthetic Nrth", official: "Synthetic North" }]);
  assert.deepEqual(report.notInOfficialFile.map((d) => d.name), ["Old District"], "reported, never deleted");
});
