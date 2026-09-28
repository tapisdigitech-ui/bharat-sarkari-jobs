-- Phase 3C–3G · Source health, discovery, extraction, review queue, duplicate detection.
--   SOURCE → FETCH → RAW DOCUMENT → EXTRACT → NORMALIZE → VALIDATE → DUPLICATE CHECK → CHANGE DETECTION → REVIEW QUEUE → EDITOR APPROVAL → PUBLISH
-- The pipeline (server code, service role) writes runs, documents and discovered items. Nothing it writes is public, and
-- nothing it discovers is ever published automatically: a person approves every item, and publishing still goes through
-- the normal content workflow and its official-source gate.

-- ───────── 1. Ingestion runs (one check of one source; also CSV imports) ─────────
create table ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references government_sources(id) on delete restrict,
  trigger text not null check (trigger in ('manual','schedule','import','test')),
  triggered_by uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','succeeded','partial','failed','skipped','blocked')),
  http_status smallint,
  pages_fetched int not null default 0,
  documents_new int not null default 0, documents_unchanged int not null default 0,
  records_discovered int not null default 0, records_new int not null default 0, records_updated int not null default 0,
  records_unchanged int not null default 0, records_rejected int not null default 0, duplicates int not null default 0,
  errors int not null default 0,
  error_summary text,
  duration_ms int generated always as ((extract(epoch from (completed_at - started_at)) * 1000)::int) stored,
  log jsonb not null default '[]'::jsonb check (jsonb_typeof(log) = 'array')
);
create index ingestion_runs_source_idx on ingestion_runs (source_id, started_at desc);
create index ingestion_runs_started_idx on ingestion_runs (started_at desc);

-- ───────── 2. Raw source documents (metadata + hash; raw text only for a limited time) ─────────
create table source_documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references government_sources(id) on delete restrict,
  run_id uuid references ingestion_runs(id) on delete set null,
  source_url text not null check (source_url ~* '^https?://'),
  final_url text,
  retrieved_at timestamptz not null default now(),
  document_type text not null check (document_type in ('html','pdf','other')),
  content_type text,
  http_status smallint,
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  byte_size int,
  -- Extracted plain text is kept only while it is useful for review, then purged (purge_old_document_text):
  -- we keep the hash, URL and metadata, never a permanent copy of an official document.
  raw_text text,
  raw_text_purge_at timestamptz,
  storage_reference text,
  parser_version text not null,
  extraction_status text not null default 'pending' check (extraction_status in ('pending','extracted','no_match','failed','skipped','unchanged')),
  extraction_error text,
  unique (source_url, document_hash)
);
create index source_documents_source_idx on source_documents (source_id, retrieved_at desc);
create index source_documents_url_idx on source_documents (source_url, retrieved_at desc);

create or replace function purge_old_document_text() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_privileged_caller() and not has_permission('source:manage') then raise exception 'Not allowed' using errcode = '42501'; end if;
  update source_documents set raw_text = null where raw_text is not null and raw_text_purge_at is not null and raw_text_purge_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────── 3. Discovered items = the review queue ─────────
create table discovered_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references government_sources(id) on delete restrict,
  run_id uuid references ingestion_runs(id) on delete set null,
  document_id uuid references source_documents(id) on delete set null,
  origin text not null default 'source' check (origin in ('source','import','manual')),
  item_url text check (item_url is null or item_url ~* '^https?://'),
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count int not null default 1,
  suggested_kind text not null check (content_table(suggested_kind) is not null),
  title text not null check (length(btrim(title)) between 2 and 400),
  organization_id uuid references organizations(id) on delete restrict,
  extracted jsonb not null check (jsonb_typeof(extracted) = 'object'),
  field_confidence jsonb not null default '{}'::jsonb,
  confidence text not null check (confidence in ('HIGH','MEDIUM','LOW')),
  confidence_score numeric(4,3) not null check (confidence_score between 0 and 1),
  validation_issues text[] not null default '{}',
  fingerprint text,
  content_hash text not null,
  -- change detection
  previous_item_id uuid references discovered_items(id) on delete set null,
  change_target_kind text check (change_target_kind is null or content_table(change_target_kind) is not null),
  change_target_id uuid,
  changes jsonb,
  -- duplicate detection
  duplicate_kind text check (duplicate_kind is null or content_table(duplicate_kind) is not null),
  duplicate_id uuid,
  duplicate_score numeric(4,3),
  duplicate_reasons text[] not null default '{}',
  duplicate_resolution text check (duplicate_resolution in ('merge','keep_separate','ignore')),
  -- review
  review_status text not null default 'pending'
    check (review_status in ('pending','needs_review','approved','rejected','merged','ignored','superseded')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  resulting_kind text check (resulting_kind is null or content_table(resulting_kind) is not null),
  resulting_id uuid,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovered_items_result_chk check ((resulting_id is null) = (resulting_kind is null)),
  constraint discovered_items_decided_chk check (review_status not in ('approved','merged') or resulting_id is not null)
);
create index discovered_items_queue_idx on discovered_items (review_status, discovered_at desc);
create index discovered_items_fp_idx on discovered_items (fingerprint) where fingerprint is not null;
create index discovered_items_url_idx on discovered_items (item_url) where item_url is not null;
create index discovered_items_source_idx on discovered_items (source_id, discovered_at desc);
create index discovered_items_title_trgm on discovered_items using gin (title gin_trgm_ops);

-- Reviewers change items only in the ways a review allows; decisions are stamped with who and when.
create or replace function discovered_items_guard() returns trigger language plpgsql as $$
declare v_decided text[] := array['approved','rejected','merged','ignored','superseded'];
begin
  if is_trusted_db_role() then new.updated_at := now(); return new; end if;
  if (to_jsonb(new) - array['review_status','review_note','reviewed_by','reviewed_at','resulting_kind','resulting_id','extracted',
                             'title','duplicate_resolution','validation_issues','updated_at'])
     is distinct from (to_jsonb(old) - array['review_status','review_note','reviewed_by','reviewed_at','resulting_kind','resulting_id','extracted',
                             'title','duplicate_resolution','validation_issues','updated_at']) then
    raise exception 'Only review fields of a discovered item can be changed' using errcode = '42501';
  end if;
  if old.review_status = any(v_decided) and (new.extracted is distinct from old.extracted or new.title is distinct from old.title) then
    raise exception 'A decided item can no longer be edited' using errcode = '23514';
  end if;
  if new.review_status is distinct from old.review_status then
    -- decided → decided is never allowed; rejected/ignored may be reopened (back to pending) by a reviewer.
    if old.review_status = any(v_decided) and not (old.review_status in ('rejected','ignored') and new.review_status = 'pending') then
      raise exception 'This item was already %', old.review_status using errcode = '23514';
    end if;
    if new.review_status = 'rejected' and coalesce(btrim(new.review_note), '') = '' then
      raise exception 'Give a reason when rejecting an item' using errcode = '23514';
    end if;
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
    if new.review_status = 'pending' then new.resulting_kind := null; new.resulting_id := null; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger discovered_items_guard before update on discovered_items for each row execute function discovered_items_guard();
create trigger audit_discovered_items after update on discovered_items for each row execute function audit_row();
create trigger audit_ingestion_runs after insert on ingestion_runs for each row execute function audit_row();

alter table ingestion_runs enable row level security;
alter table source_documents enable row level security;
alter table discovered_items enable row level security;
create policy ingestion_runs_read   on ingestion_runs   for select using (is_staff());
create policy source_documents_read on source_documents for select using (is_staff());
create policy discovered_items_read on discovered_items for select using (is_staff());
create policy discovered_items_review on discovered_items for update using (has_permission('ingestion:review')) with check (has_permission('ingestion:review'));
-- Inserts come only from the pipeline (service role) — never from a browser session.
revoke all on ingestion_runs, source_documents, discovered_items from anon;
revoke insert, delete on ingestion_runs, source_documents, discovered_items from authenticated;

-- ───────── 4. Duplicate candidates ─────────
-- Strong signals decide; fuzzy title similarity only ever WARNS. Reads every row (drafts too), so it runs as definer and
-- is callable only by staff / the pipeline.
create or replace function norm_ref(t text) returns text language sql immutable as $$
  select nullif(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '', 'g'), '')
$$;
create or replace function norm_url(u text) returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(lower(btrim(coalesce(u, ''))), '^https?://(www\.)?', ''), '[/#?]+$', ''), '')
$$;

create or replace function find_duplicate_candidates(p_kind text, p jsonb, p_exclude_item uuid default null, p_limit int default 5)
returns table (kind text, id uuid, title text, status text, score numeric, reasons text[])
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := nullif(p->>'organization_id', '')::uuid;
  v_ref text := norm_ref(coalesce(p->>'advertisement_no', p->>'notification_number'));
  v_title text := coalesce(p->>'title', '');
  v_urls text[] := array_remove(array[norm_url(p->>'notification_url'), norm_url(p->>'source_url'), norm_url(p->>'official_notification_url'),
                                      norm_url(p->>'official_admit_card_url'), norm_url(p->>'official_result_url'), norm_url(p->>'official_answer_key_url'),
                                      norm_url(p->>'item_url')], null);
  v_last date := nullif(p->>'last_date', '')::date;
  v_notif date := nullif(p->>'notification_date', '')::date;
begin
  if not (is_staff() or is_privileged_caller()) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
  with cand as (
    -- jobs
    select 'job'::text k, j.id, j.title t, j.status::text s, j.organization_id org, norm_ref(j.advertisement_no) r,
           array_remove(array[norm_url(j.notification_url), norm_url(j.source_url), norm_url(j.official_apply_url)], null) u,
           j.last_date ld, j.notification_date nd
      from jobs j where p_kind in ('job','recruitment') and j.status <> 'archived'
    union all
    select 'recruitment', r.id, r.title, r.status::text, r.organization_id, norm_ref(r.notification_number),
           array_remove(array[norm_url(r.official_notification_url)], null), null::date, r.notification_date
      from recruitments r where p_kind in ('job','recruitment') and r.status <> 'archived'
    union all
    select 'admit_card', a.id, a.title, a.status::text, a.organization_id, null,
           array_remove(array[norm_url(a.official_admit_card_url), norm_url(a.official_notification_url)], null), null::date, null::date
      from admit_cards a where p_kind = 'admit_card' and a.status <> 'archived'
    union all
    select 'result', x.id, x.title, x.status::text, x.organization_id, null, array_remove(array[norm_url(x.official_result_url)], null), null::date, null::date
      from results x where p_kind = 'result' and x.status <> 'archived'
    union all
    select 'answer_key', x.id, x.title, x.status::text, x.organization_id, null, array_remove(array[norm_url(x.official_answer_key_url)], null), null::date, null::date
      from answer_keys x where p_kind = 'answer_key' and x.status <> 'archived'
    union all
    select 'exam_calendar', x.id, x.title, x.status::text, x.organization_id, null, array_remove(array[norm_url(x.official_notification_url)], null), null::date, null::date
      from exam_calendar x where p_kind = 'exam_calendar' and x.status <> 'archived'
  ), scored as (
    select c.k, c.id, c.t, c.s,
           array_remove(array[
             case when v_ref is not null and c.r = v_ref and (v_org is null or c.org = v_org) then 'advertisement number' end,
             case when cardinality(v_urls) > 0 and c.u && v_urls then 'official URL' end,
             case when v_org is not null and c.org = v_org then 'organization' end,
             case when similarity(lower(c.t), lower(v_title)) >= 0.45 then 'similar title (' || round(similarity(lower(c.t), lower(v_title))::numeric, 2) || ')' end,
             case when v_last is not null and c.ld = v_last then 'same application last date' end,
             case when v_notif is not null and c.nd = v_notif then 'same notification date' end
           ], null) reasons,
           similarity(lower(c.t), lower(v_title)) sim,
           (v_ref is not null and c.r = v_ref and (v_org is null or c.org = v_org)) ref_hit,
           (cardinality(v_urls) > 0 and c.u && v_urls) url_hit,
           (v_org is not null and c.org = v_org) org_hit
      from cand c
  )
  select sc.k, sc.id, sc.t, sc.s,
         least(1, (case when sc.ref_hit then 0.7 else 0 end) + (case when sc.url_hit then 0.6 else 0 end)
                + (case when sc.org_hit and sc.sim >= 0.45 then 0.25 * sc.sim / 1 else 0 end)
                + (case when 'same application last date' = any(sc.reasons) then 0.1 else 0 end)
                + (case when 'same notification date' = any(sc.reasons) then 0.1 else 0 end))::numeric(4,3),
         sc.reasons
    from scored sc
   where sc.ref_hit or sc.url_hit or (sc.org_hit and sc.sim >= 0.45) or sc.sim >= 0.75
   order by 5 desc, sc.sim desc
   limit greatest(1, least(p_limit, 20));
end $$;
revoke execute on function find_duplicate_candidates(text, jsonb, uuid, int) from public, anon;
grant execute on function find_duplicate_candidates(text, jsonb, uuid, int) to authenticated, service_role;

-- ───────── 5. Review actions (SECURITY INVOKER: RLS, content triggers and the publish gate all apply to the reviewer) ─────────

-- Insert a new content record of any kind from a jsonb payload, using only keys that are real columns of that table.
create or replace function insert_content_from_json(p_kind text, p jsonb) returns uuid
language plpgsql set search_path = public as $$
declare v_table text := content_table(p_kind); v_cols text; v_id uuid;
begin
  if v_table is null or p_kind = 'job' then raise exception 'Unknown content type' using errcode = '22023'; end if;
  select string_agg(quote_ident(c.column_name), ', ') into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = v_table and c.is_generated = 'NEVER' and c.column_default is distinct from 'gen_random_uuid()'
     and c.column_name not in ('id','status','created_at','updated_at','published_at','search_text') and p ? c.column_name;
  if v_cols is null then raise exception 'Nothing to insert' using errcode = '22023'; end if;
  execute format('insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) returning id', v_table, v_cols, v_cols, v_table) into v_id using p;
  return v_id;
end $$;

-- Approve: create a DRAFT (optionally submitted for review) from a verified discovery, link it to its source, close the item.
-- LOW-confidence items need stronger review: a written note, an explicit "compared with the official document" confirmation,
-- and a reviewer who could publish that kind of content.
create or replace function approve_discovery(p_id uuid, p_kind text, p_payload jsonb, p_note text default null,
                                             p_confirm_compared boolean default false, p_submit boolean default false)
returns uuid language plpgsql set search_path = public as $$
declare v_item discovered_items; v_new uuid;
begin
  if not has_permission('ingestion:review') then raise exception 'Not allowed to review discoveries' using errcode = '42501'; end if;
  if not has_permission(p_kind || ':create') then raise exception 'Not allowed to create this kind of content' using errcode = '42501'; end if;
  select * into v_item from discovered_items where id = p_id for update;
  if not found then raise exception 'Discovered item not found' using errcode = '22023'; end if;
  if v_item.review_status not in ('pending','needs_review') then raise exception 'This item was already %', v_item.review_status using errcode = '23514'; end if;
  if v_item.confidence = 'LOW' then
    if not p_confirm_compared or coalesce(btrim(p_note), '') = '' then
      raise exception 'Low-confidence item: confirm you compared every field with the official document and add a note' using errcode = '23514';
    end if;
    if not has_permission(p_kind || ':publish') then
      raise exception 'Low-confidence items must be approved by someone who can publish this content' using errcode = '42501';
    end if;
  end if;
  if v_item.duplicate_id is not null and v_item.duplicate_resolution is distinct from 'keep_separate' then
    raise exception 'Resolve the duplicate warning first (merge, keep separate or ignore)' using errcode = '23514';
  end if;

  if p_kind = 'job' then v_new := save_job(null, p_payload);
  else v_new := insert_content_from_json(p_kind, p_payload); end if;
  if p_submit then
    if p_kind = 'job' then update jobs set status = 'review' where id = v_new;
    else execute format('update %I set status = ''review'' where id = $1', content_table(p_kind)) using v_new; end if;
  end if;
  if v_item.source_id is not null then
    insert into source_content_links (source_id, kind, content_id, relation, discovery_id) values (v_item.source_id, p_kind, v_new, 'origin', p_id)
      on conflict do nothing;
  end if;
  update discovered_items set review_status = 'approved', review_note = nullif(btrim(p_note), ''), resulting_kind = p_kind, resulting_id = v_new
   where id = p_id;
  return v_new;
end $$;

-- Merge: the discovery is the same thing as an existing record; keep that record, remember this extra source.
create or replace function merge_discovery(p_id uuid, p_kind text, p_target uuid, p_note text default null) returns void
language plpgsql set search_path = public as $$
declare v_item discovered_items; v_exists boolean;
begin
  if not has_permission('ingestion:review') then raise exception 'Not allowed to review discoveries' using errcode = '42501'; end if;
  select * into v_item from discovered_items where id = p_id for update;
  if not found or v_item.review_status not in ('pending','needs_review') then raise exception 'Item not found or already decided' using errcode = '23514'; end if;
  execute format('select exists (select 1 from %I where id = $1)', content_table(p_kind)) into v_exists using p_target;
  if not coalesce(v_exists, false) then raise exception 'The record to merge into was not found' using errcode = '22023'; end if;
  if v_item.source_id is not null then
    insert into source_content_links (source_id, kind, content_id, relation, discovery_id) values (v_item.source_id, p_kind, p_target, 'reference', p_id)
      on conflict do nothing;
  end if;
  update discovered_items set review_status = 'merged', duplicate_resolution = 'merge', review_note = nullif(btrim(p_note), ''),
         resulting_kind = p_kind, resulting_id = p_target where id = p_id;
end $$;

-- Change detection → approval: apply ONLY the selected fields of a discovered update to the existing record.
-- Runs as the reviewer, so editing live content still needs publish permission and re-runs the publish gate;
-- the content-version trigger records the before/after with the reason given here.
create or replace function apply_discovery_changes(p_id uuid, p_fields text[], p_reason text) returns void
language plpgsql set search_path = public as $$
declare v_item discovered_items; v_kind text; v_target uuid; v_table text; f text; v_sets text := ''; v_allowed text[];
begin
  if not has_permission('ingestion:review') then raise exception 'Not allowed to review discoveries' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for the change (it is kept in the version history)' using errcode = '23514'; end if;
  select * into v_item from discovered_items where id = p_id for update;
  if not found or v_item.review_status not in ('pending','needs_review') then raise exception 'Item not found or already decided' using errcode = '23514'; end if;
  v_kind := coalesce(v_item.change_target_kind, v_item.duplicate_kind); v_target := coalesce(v_item.change_target_id, v_item.duplicate_id);
  if v_target is null then raise exception 'This item is not an update to an existing record' using errcode = '22023'; end if;
  if coalesce(cardinality(p_fields), 0) = 0 then raise exception 'Select at least one change to apply' using errcode = '22023'; end if;
  v_table := content_table(v_kind);
  -- only real, non-system columns that the discovery actually carries
  select array_agg(c.column_name::text) into v_allowed from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = v_table and c.is_generated = 'NEVER'
     and c.column_name not in ('id','slug','status','created_at','updated_at','published_at','search_text','organization_id','source_checked_at',
                               'qualification_slugs','category_slugs','verification_status','last_verified_at','posted_at','expiry_date');
  foreach f in array p_fields loop
    if not (f = any(v_allowed)) or not (v_item.extracted ? f) then raise exception 'Field % cannot be applied', f using errcode = '22023'; end if;
    v_sets := v_sets || case when v_sets = '' then '' else ', ' end || format('%1$I = (jsonb_populate_record(null::%2$I, $1)).%1$I', f, v_table);
  end loop;
  perform set_config('app.change_reason', left(p_reason, 500), true);
  perform set_config('app.change_discovery', p_id::text, true);
  execute format('update %I set %s where id = $2', v_table, v_sets) using v_item.extracted, v_target;
  if v_item.source_id is not null then
    insert into source_content_links (source_id, kind, content_id, relation, discovery_id) values (v_item.source_id, v_kind, v_target, 'update', p_id)
      on conflict (source_id, kind, content_id) do update set relation = 'update', discovery_id = excluded.discovery_id;
  end if;
  update discovered_items set review_status = 'approved', review_note = p_reason, resulting_kind = v_kind, resulting_id = v_target where id = p_id;
end $$;

revoke execute on function insert_content_from_json(text, jsonb), approve_discovery(uuid, text, jsonb, text, boolean, boolean),
                           merge_discovery(uuid, text, uuid, text), apply_discovery_changes(uuid, text[], text), purge_old_document_text() from public, anon;
grant execute on function insert_content_from_json(text, jsonb), approve_discovery(uuid, text, jsonb, text, boolean, boolean),
                          merge_discovery(uuid, text, uuid, text), apply_discovery_changes(uuid, text[], text), purge_old_document_text() to authenticated, service_role;
