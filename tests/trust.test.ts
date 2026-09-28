/** Source trust model (Phase 3.6 item 8) — enforced by the DATABASE publish gates (migration 0022). Local PostgreSQL. */
import { test, before, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { ANON, Session, U, admin, jobPayload, seedUsers, user, addDays } from "./db";
import { seedContentMatrix } from "./fixtures/content-matrix";

before(async () => { await seedUsers(); });
afterEach(async () => { await Session.closeAll(); });

const saveJob = (s: Session, payload: object) => s.q<{ save_job: string }>("select save_job(null, $1::jsonb)", [JSON.stringify(payload)]).then((r) => r[0].save_job);
const publishJob = async (s: Session, id: string) => { await s.q("select transition_job($1,'review',null,null)", [id]); return s.fails("select transition_job($1,'published',null,null)", [id]); };
const PRIVATE = { source_url: "https://jobs-portal.example.com/ssc-cgl", notification_url: "https://jobs-portal.example.com/ssc-cgl.pdf", official_website_url: "https://jobs-portal.example.com", official_apply_url: "https://jobs-portal.example.com/apply" };

describe("trusted official domain is required to publish", () => {
  test("a job whose links all point to a private portal cannot be published", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await saveJob(s, jobPayload({ title: "Private Portal Only Job 2026", last_date: addDays(30), ...PRIVATE }));
    assert.match((await publishJob(s, id)) ?? "published!", /registered official domain|gov\.in/);
  });

  test("a .gov.in / .nic.in notification is trusted", async () => {
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await saveJob(s, jobPayload({ title: "Gov Domain Job 2026", last_date: addDays(30), ...PRIVATE, notification_url: "https://ssc.nic.in/notice.pdf" }));
    assert.equal(await publishJob(s, id), null);
  });

  test("a domain registered in the official-source registry is trusted (e.g. a board outside .gov.in)", async () => {
    const c = await admin();
    await c.query("insert into government_sources (slug, name, source_type, official_domain, base_url) values ('trust-ibps','Institute of Banking Personnel Selection','RECRUITMENT_BOARD','ibps.in','https://www.ibps.in') on conflict do nothing");
    await c.end();
    const s = await Session.open(); await s.as(user(U.ed));
    const id = await saveJob(s, jobPayload({ title: "Registered Domain Job 2026", last_date: addDays(30), ...PRIVATE, official_website_url: "https://www.ibps.in" }));
    assert.equal(await publishJob(s, id), null);
    const lookalike = await saveJob(s, jobPayload({ title: "Look-alike Domain Job 2026", last_date: addDays(30), ...PRIVATE, official_website_url: "https://ibps.in.jobs-portal.example.com" }));
    assert.match((await publishJob(s, lookalike)) ?? "published!", /registered official domain/);
  });

  test("other kinds: an admit card may link a third-party download portal only alongside a trusted link", async () => {
    const c = await admin();
    const org = (await c.query("insert into organizations (name, slug, level) values ('Trust Test Board','trust-test-board','central') on conflict (slug) do update set name=excluded.name returning id")).rows[0].id;
    await c.end();
    const s = await Session.open(); await s.as(user(U.ed));
    const base = { organization_id: org, is_all_india: true, source_name: "Board website", source_checked_at: new Date().toISOString(), official_admit_card_url: "https://cdn.exam-agency.example.com/admit" };
    const ins = async (title: string, extra: Record<string, unknown>) => {
      const row = { ...base, title, ...extra }; const cols = Object.keys(row);
      return (await s.q(`insert into admit_cards (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`, cols.map((k) => (row as Record<string, unknown>)[k])))[0].id as string;
    };
    const onlyThirdParty = await ins("Third Party Only Admit Card", {});
    await s.q("select transition_content('admit_card',$1,'review',null)", [onlyThirdParty]);
    assert.match((await s.fails("select transition_content('admit_card',$1,'published',null)", [onlyThirdParty])) ?? "published!", /registered official domain/);
    const withGov = await ins("Admit Card With Gov Site", { official_website_url: "https://board.gov.in" });
    await s.q("select transition_content('admit_card',$1,'review',null)", [withGov]);
    assert.equal(await s.fails("select transition_content('admit_card',$1,'published',null)", [withGov]), null);
  });

  test("anon cannot probe the registry through official_url_trust()", async () => {
    const s = await Session.open(); await s.as(ANON);
    assert.ok(await s.fails("select official_url_trust('https://ibps.in')"));
  });
});

describe("every public record carries its trust fields", () => {
  test("published/updated/expired rows visible to anon all have source name, checked time, an official URL, verification and publication status", async () => {
    await seedContentMatrix();
    const s = await Session.open(); await s.as(ANON);
    const checks: [string, string][] = [
      ["jobs", "coalesce(notification_url, official_website_url)"],
      ["recruitments", "coalesce(official_notification_url, official_website_url)"],
      ["exams", "official_website_url"],
      ["admit_cards", "coalesce(official_admit_card_url, official_notification_url, official_website_url)"],
      ["results", "coalesce(official_result_url, official_website_url)"],
      ["answer_keys", "coalesce(official_answer_key_url, official_website_url)"],
      ["exam_calendar", "coalesce(official_notification_url, official_website_url)"],
    ];
    let seen = 0;
    for (const [t, url] of checks) {
      const rows = await s.q(`select id, status::text, source_name, source_checked_at, ${url} as url, verification_status from ${t}`);
      seen += rows.length;
      for (const r of rows) {
        assert.ok(["published", "updated", "expired"].includes(r.status), `${t}: ${r.status} visible to anon`);
        assert.ok(r.source_name && r.source_checked_at && r.url && r.verification_status, `${t} ${r.id}: missing trust field ${JSON.stringify(r)}`);
      }
    }
    assert.ok(seen >= 21, `expected the matrix's public rows, saw ${seen}`);
  });
});
