-- Phase 3L · Controlled real-source pilot: the INITIAL official-source registry for the pilot regions
-- (Central Government, Uttar Pradesh, Delhi, Bihar).
--
-- This is NOT a migration: run it deliberately, once, in the SQL editor of the environment where the pilot will run.
--
-- STATUS (Phase 3.5, 25 Sep 2026): every source below was opened in a browser and checked — see
-- docs/pilot/SOURCE_VALIDATION.md for the evidence (exact URLs, format, robots.txt, whether our reader could process it).
-- The crawler itself has still NOT fetched these sites from a server; everything therefore stays REVIEW_REQUIRED (or
-- BLOCKED) and unscheduled. A person activates a source only after its first server-side "Check now" matches the site.
--   * RRB Chandigarh moved: rrbcdg.gov.in now redirects to rrb.indianrailways.gov.in/chandigarh (corrected below).
--   * DSSSB answers 403 on robots.txt → BLOCKED for the crawler (manual workflow).
--   * SSC's notices come from a JavaScript app; SSC is run as a MANUAL / single-URL source (no API adapter built).
--   * Private job portals are deliberately absent.

insert into organizations (name, slug, level, official_website, description) values
  ('Staff Selection Commission', 'staff-selection-commission', 'central', 'https://ssc.gov.in', 'Recruitment commission of the Government of India.'),
  ('Union Public Service Commission', 'union-public-service-commission', 'central', 'https://upsc.gov.in', 'Constitutional recruitment body of the Government of India.'),
  ('Railway Recruitment Board, Chandigarh', 'railway-recruitment-board-chandigarh', 'central', 'https://rrb.indianrailways.gov.in/chandigarh', 'One of the Railway Recruitment Boards of Indian Railways.'),
  ('National Testing Agency', 'national-testing-agency', 'central', 'https://nta.ac.in', 'Autonomous testing agency under the Ministry of Education.'),
  ('Employment News (Ministry of Information and Broadcasting)', 'employment-news', 'central', 'https://employmentnews.gov.in', 'Official weekly of the Government of India listing recruitment notices.'),
  ('Indian Army (Join Indian Army)', 'indian-army-join-indian-army', 'central', 'https://joinindianarmy.nic.in', 'Official recruitment website of the Indian Army.'),
  ('Coal India Limited', 'coal-india-limited', 'psu', 'https://www.coalindia.in', 'Central public sector undertaking.'),
  ('Uttar Pradesh Public Service Commission', 'uttar-pradesh-public-service-commission', 'state', 'https://uppsc.up.nic.in', 'State public service commission of Uttar Pradesh.'),
  ('Uttar Pradesh Subordinate Services Selection Commission', 'uttar-pradesh-subordinate-services-selection-commission', 'state', 'https://upsssc.gov.in', 'State recruitment commission of Uttar Pradesh.'),
  ('Uttar Pradesh Police Recruitment and Promotion Board', 'uttar-pradesh-police-recruitment-and-promotion-board', 'state', 'https://uppbpb.gov.in', 'Police recruitment board of Uttar Pradesh.'),
  ('District Administration Lucknow', 'district-administration-lucknow', 'district', 'https://lucknow.nic.in', 'NIC website of the Lucknow district administration.'),
  ('Delhi Subordinate Services Selection Board', 'delhi-subordinate-services-selection-board', 'state', 'https://dsssb.delhi.gov.in', 'Recruitment board of the Government of NCT of Delhi.'),
  ('Delhi Police', 'delhi-police', 'state', 'https://delhipolice.gov.in', 'Official website of Delhi Police.'),
  ('High Court of Delhi', 'high-court-of-delhi', 'state', 'https://delhihighcourt.nic.in', 'Official website of the High Court of Delhi.'),
  ('University of Delhi', 'university-of-delhi', 'central', 'https://www.du.ac.in', 'Central university.'),
  ('All India Institute of Medical Sciences, New Delhi', 'aiims-new-delhi', 'central', 'https://www.aiims.edu', 'Autonomous medical institute under the Ministry of Health and Family Welfare.'),
  ('Bihar Public Service Commission', 'bihar-public-service-commission', 'state', 'https://www.bpsc.bihar.gov.in', 'State public service commission of Bihar.'),
  ('Bihar Staff Selection Commission', 'bihar-staff-selection-commission', 'state', 'https://bssc.bihar.gov.in', 'State recruitment commission of Bihar.'),
  ('Central Selection Board of Constable, Bihar', 'central-selection-board-of-constable-bihar', 'state', 'https://csbc.bihar.gov.in', 'Constable recruitment board of Bihar.')
on conflict do nothing;

-- One source per organization, home page only, REVIEW_REQUIRED, not scheduled.
insert into government_sources (name, organization_id, department_id, state_id, source_type, authority_rank, official_domain, base_url, source_priority, check_interval_hours, adapter, status, notes)
select v.name, o.id, (select id from departments where slug = v.dept), (select id from states where slug = v.state), v.type, v.rank, v.domain, v.base, v.priority, v.hours, 'generic-listing', 'REVIEW_REQUIRED',
       'Pilot source (checked in a browser 25 Sep 2026, see docs/pilot/SOURCE_VALIDATION.md). Not yet read by the crawler from a server: run Check now and compare with the site before activating.'
  from (values
    ('Staff Selection Commission', 'staff-selection-commission', 'ssc', null, 'RECRUITMENT_BOARD', 3, 'ssc.gov.in', 'https://ssc.gov.in/', 'high', 6),
    ('Union Public Service Commission', 'union-public-service-commission', 'upsc', null, 'RECRUITMENT_BOARD', 3, 'upsc.gov.in', 'https://upsc.gov.in/', 'high', 6),
    ('Railway Recruitment Board, Chandigarh', 'railway-recruitment-board-chandigarh', 'railways', null, 'RECRUITMENT_BOARD', 2, 'rrb.indianrailways.gov.in', 'https://rrb.indianrailways.gov.in/chandigarh', 'normal', 24),
    ('National Testing Agency', 'national-testing-agency', null, null, 'EDUCATION', 2, 'nta.ac.in', 'https://nta.ac.in/', 'normal', 24),
    ('Employment News', 'employment-news', null, null, 'CENTRAL_GOVERNMENT', 7, 'employmentnews.gov.in', 'https://employmentnews.gov.in/', 'normal', 24),
    ('Indian Army recruitment', 'indian-army-join-indian-army', 'defence', null, 'CENTRAL_GOVERNMENT', 1, 'joinindianarmy.nic.in', 'https://joinindianarmy.nic.in/', 'normal', 24),
    ('Coal India Limited careers', 'coal-india-limited', 'psu', null, 'PSU', 4, 'coalindia.in', 'https://www.coalindia.in/', 'low', 72),
    ('UPPSC', 'uttar-pradesh-public-service-commission', 'state-psc', 'uttar-pradesh', 'RECRUITMENT_BOARD', 3, 'uppsc.up.nic.in', 'https://uppsc.up.nic.in/', 'high', 6),
    ('UPSSSC', 'uttar-pradesh-subordinate-services-selection-commission', null, 'uttar-pradesh', 'RECRUITMENT_BOARD', 3, 'upsssc.gov.in', 'https://upsssc.gov.in/', 'high', 6),
    ('UP Police Recruitment and Promotion Board', 'uttar-pradesh-police-recruitment-and-promotion-board', 'police', 'uttar-pradesh', 'RECRUITMENT_BOARD', 2, 'uppbpb.gov.in', 'https://uppbpb.gov.in/', 'normal', 24),
    ('District Administration Lucknow', 'district-administration-lucknow', null, 'uttar-pradesh', 'DISTRICT_GOVERNMENT', 6, 'lucknow.nic.in', 'https://lucknow.nic.in/', 'low', 72),
    ('DSSSB', 'delhi-subordinate-services-selection-board', null, 'delhi', 'RECRUITMENT_BOARD', 2, 'dsssb.delhi.gov.in', 'https://dsssb.delhi.gov.in/', 'high', 6),
    ('Delhi Police recruitment', 'delhi-police', 'police', 'delhi', 'STATE_GOVERNMENT', 1, 'delhipolice.gov.in', 'https://delhipolice.gov.in/', 'normal', 24),
    ('High Court of Delhi recruitment', 'high-court-of-delhi', 'courts', 'delhi', 'COURT', 5, 'delhihighcourt.nic.in', 'https://delhihighcourt.nic.in/', 'low', 72),
    ('University of Delhi recruitment', 'university-of-delhi', 'universities', 'delhi', 'UNIVERSITY', 5, 'du.ac.in', 'https://www.du.ac.in/', 'low', 72),
    ('AIIMS New Delhi recruitment', 'aiims-new-delhi', 'health', 'delhi', 'HEALTH', 5, 'aiims.edu', 'https://www.aiims.edu/', 'normal', 24),
    ('BPSC', 'bihar-public-service-commission', 'state-psc', 'bihar', 'RECRUITMENT_BOARD', 3, 'bpsc.bihar.gov.in', 'https://www.bpsc.bihar.gov.in/', 'high', 6),
    ('BSSC', 'bihar-staff-selection-commission', null, 'bihar', 'RECRUITMENT_BOARD', 3, 'bssc.bihar.gov.in', 'https://bssc.bihar.gov.in/', 'normal', 24),
    ('CSBC Bihar', 'central-selection-board-of-constable-bihar', 'police', 'bihar', 'RECRUITMENT_BOARD', 2, 'csbc.bihar.gov.in', 'https://csbc.bihar.gov.in/', 'normal', 24)
  ) as v(name, org_slug, dept, state, type, rank, domain, base, priority, hours)
  join organizations o on o.slug = v.org_slug
on conflict do nothing;

-- State bodies belong to their state (central bodies keep state_id null = all-India).
update organizations o set state_id = s.state_id, department_id = coalesce(o.department_id, s.department_id)
  from government_sources s where s.organization_id = o.id and o.state_id is null and s.state_id is not null;

-- Phase 3.5: notice pages, reader settings and outcome per source (evidence: docs/pilot/SOURCE_VALIDATION.md).
update government_sources set recruitment_url = 'https://ssc.gov.in/home/notice-board', status = 'REVIEW_REQUIRED',
  notes = 'NEEDS ADAPTER / MANUAL: notices come from a JSON API used by the site''s JavaScript; served HTML has no links. Use "Check a single notice URL" per PDF (https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/<file>.pdf).'
  where official_domain = 'ssc.gov.in';
update government_sources set recruitment_url = 'https://www.upsc.gov.in/recruitment/recruitment-advertisement', adapter = 'table-listing',
  adapter_config = '{"selector": "div.view-content"}', notes = 'VERIFIED in browser (class B). Exam notices are two-level (page → PDF): check those by single URL.'
  where official_domain = 'upsc.gov.in';
update government_sources set notes = 'Seed domain rrbcdg.gov.in redirects here (www.rrbcdg.gov.in has a certificate error). Reachable; reader not yet tested.'
  where official_domain = 'rrb.indianrailways.gov.in';
update government_sources set notes = 'UNKNOWN: https://www.employmentnews.gov.in/ answered 404 on 25 Sep 2026; find the official notice page first.' where official_domain = 'employmentnews.gov.in';
update government_sources set notes = 'MANUAL ONLY: the site redirects to a sign-in page (Authentication.aspx).' where official_domain = 'joinindianarmy.nic.in';
update government_sources set recruitment_url = 'https://dsssb.delhi.gov.in/dsssb-vacancies', adapter = 'table-listing', adapter_config = '{"selector": "div.card-listing", "maxItems": 20}',
  status = 'BLOCKED', robots_allowed = false,
  notes = 'BLOCKED: /robots.txt answers HTTP 403; our crawler treats a refused robots.txt as "stay out". Manual workflow. Reader settings kept for the day robots.txt is fixed.'
  where official_domain = 'dsssb.delhi.gov.in';
update government_sources set base_url = 'https://delhihighcourt.nic.in/web/', recruitment_url = 'https://delhihighcourt.nic.in/web/',
  notes = 'VERIFIED in browser (class A). The court also re-posts OTHER bodies'' vacancy circulars (e.g. other High Courts, Supreme Court): check the organization on every discovery.'
  where official_domain = 'delhihighcourt.nic.in';
update government_sources set recruitment_url = 'https://uppsc.up.nic.in/', adapter_config = '{"exclude": "\\{\\{", "maxItems": 25}',
  notes = 'NEEDS ADAPTER (class C): discovery works; current application windows are table columns on /CandidatePages/Notifications.aspx; PDFs often complex or legacy-font Hindi → manual fields.'
  where official_domain = 'uppsc.up.nic.in';
update government_sources set base_url = 'https://upsssc.gov.in/default.aspx', recruitment_url = 'https://upsssc.gov.in/AllNotifications.aspx', adapter = 'table-listing',
  notes = 'MANUAL ONLY (class D): advertisements are two-level and the tested PDF was scanned (39 pages, no text).'
  where official_domain = 'upsssc.gov.in';
update government_sources set base_url = 'https://bpsc.bihar.gov.in/', recruitment_url = 'https://bpsc.bihar.gov.in/',
  notes = 'VERIFIED discovery (class A, no config). All tested notice PDFs were images → fields entered by hand. /advertisement/ is JavaScript-loaded.'
  where official_domain = 'bpsc.bihar.gov.in';

-- Phase 3.6: pilot adapter settings (adapters are structural — see src/lib/ingestion/adapters.ts). Every source stays
-- REVIEW_REQUIRED / BLOCKED and unscheduled until its first server-side "Check now" has been compared with the website.
-- SSC: JSON notice-board feed observed in the browser (docs/pilot/SOURCE_VALIDATION.md). Configured but GATED: the adapter
--      refuses to run until a person confirms SSC's terms permit automated reading and sets "termsReviewed": true. The listing
--      URL's remaining query parameters were not recorded in 3.5 — confirm them in a browser before enabling.
update government_sources set adapter = 'json-feed',
  adapter_config = '{"feed": {"url": "https://ssc.gov.in/api/general-website/portal/notice-boards?page=1&limit=10&contentType=notice-boards", "title": "headline", "link": "attachments[].path", "date": "createdAt", "id": "id", "group": "examId", "linkPrefix": "https://ssc.gov.in/api/attachment/"}, "termsReviewed": false, "maxItems": 10}',
  notes = 'json-feed CONFIGURED BUT GATED (termsReviewed=false): the feed is undocumented and not published for re-use. Until SSC''s terms are confirmed, run SSC as MANUAL (Check a single notice URL per PDF).'
  where official_domain = 'ssc.gov.in';
-- UPSC: advertisements are PDFs in div.view-content; exam notifications are pages that link the PDF → detail-page adapter handles both.
update government_sources set adapter = 'detail-page', adapter_config = '{"selector": "div.view-content", "detailPdfInclude": "notice|notification|advt|\\bmb\\b"}',
  notes = 'VERIFIED in browser (class B). detail-page adapter: PDF links are read directly; notice pages are followed to their PDF (second hop). First server-side check still pending.'
  where official_domain = 'upsc.gov.in';
-- UPPSC: current application windows are an HTML table with named columns (Advt no · start · last date · fee last date …).
update government_sources set adapter = 'table-columns', recruitment_url = 'https://uppsc.up.nic.in/CandidatePages/Notifications.aspx',
  adapter_config = '{"maxItems": 15, "expectOrganization": "Uttar Pradesh Public Service Commission|U\\.?P\\.? Public Service Commission|UPPSC|उत्तर प्रदेश लोक सेवा आयोग"}',
  notes = 'table-columns adapter: dates come from the table columns (the PDFs are often legacy-font Hindi or scanned). Table page seen in a browser only; first server-side check pending.'
  where official_domain = 'uppsc.up.nic.in';
-- BPSC: home page needs no configuration; notice PDFs tested so far are images → flagged "scanned" for manual entry.
update government_sources set adapter = 'generic-listing', adapter_config = '{"expectOrganization": "Bihar Public Service Commission|BPSC|बिहार लोक सेवा आयोग"}'
  where official_domain = 'bpsc.bihar.gov.in';
-- High Court of Delhi re-posts OTHER bodies' vacancy circulars: every notice that does not name the High Court is flagged.
update government_sources set adapter_config = '{"expectOrganization": "High Court of Delhi|Delhi High Court|दिल्ली उच्च न्यायालय"}'
  where official_domain = 'delhihighcourt.nic.in';
-- DSSSB (robots.txt refused → BLOCKED) and UPSSSC (two-level + scanned PDFs) remain MANUAL ONLY: no adapter change.
