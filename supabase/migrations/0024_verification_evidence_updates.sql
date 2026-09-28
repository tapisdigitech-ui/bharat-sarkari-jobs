-- 0024 · Per-field verification, field-level source evidence, and the official-updates chain (Phase 3.6 items 14–17).
-- Idempotent where practical (if not exists / create or replace / drop … if exists).
--
--   field_verifications — append-only history of a reviewer's per-field decision (verified / incorrect / not in source),
--                         on a discovery or on a content record. Staff-only.
--   field_evidence      — the exact phrase in the official document each value came from. Staff-only (editorial).
--                         Written by the database when a discovery becomes (or updates) a record — never typed in by hand.
--   official_updates    — the public chain of official updates for a record: original → corrigendum → addendum →
--                         postponement → extension → … Never deleted (withdrawn instead). Public only while the record is.

-- ───────── 1. field_verifications ─────────
create table if not exists field_verifications (
  id bigint generated always as identity primary key,
  subject_kind text not null check (subject_kind = 'discovery' or content_table(subject_kind) is not null),
  subject_id uuid not null,
  field text not null check (field ~ '^[a-z][a-z0-9_]{1,59}$'),
  status text not null check (status in ('verified', 'incorrect', 'not_in_source')),
  value_checked jsonb,
  note text check (note is null or length(note) <= 500),
  verified_by uuid not null default auth.uid() references auth.users(id),
  verified_at timestamptz not null default now()
);
create index if not exists field_verifications_subject_idx on field_verifications (subject_kind, subject_id, field, verified_at desc);
create index if not exists field_verifications_verified_by_idx on field_verifications (verified_by);
alter table field_verifications enable row level security;
drop policy if exists field_verifications_read on field_verifications;
create policy field_verifications_read on field_verifications for select using (is_staff());
drop policy if exists field_verifications_insert on field_verifications;
create policy field_verifications_insert on field_verifications for insert with check (
  verified_by = auth.uid() and case when subject_kind = 'discovery' then has_permission('ingestion:review')
                                    else has_permission(subject_kind || ':edit') or has_permission(subject_kind || ':publish') end);
revoke all on field_verifications from anon;
revoke update, delete, truncate on field_verifications from authenticated;

create or replace view field_verification_latest with (security_invoker = true) as
  select distinct on (subject_kind, subject_id, field) subject_kind, subject_id, field, status, value_checked, note, verified_by, verified_at
    from field_verifications order by subject_kind, subject_id, field, verified_at desc, id desc;
revoke all on field_verification_latest from anon;

-- ───────── 2. field_evidence ─────────
create table if not exists field_evidence (
  id bigint generated always as identity primary key,
  kind text not null check (content_table(kind) is not null),
  content_id uuid not null,
  field text not null,
  excerpt text not null check (length(excerpt) between 1 and 1000),
  source_url text check (source_url is null or source_url ~* '^https?://'),
  discovery_id uuid references discovered_items(id) on delete set null,
  captured_at timestamptz not null default now()
);
create index if not exists field_evidence_content_idx on field_evidence (kind, content_id, field, captured_at desc);
create index if not exists field_evidence_discovery_idx on field_evidence (discovery_id);
alter table field_evidence enable row level security;
drop policy if exists field_evidence_read on field_evidence;
create policy field_evidence_read on field_evidence for select using (is_staff());
revoke all on field_evidence from anon;
revoke insert, update, delete, truncate on field_evidence from authenticated;

-- ───────── 3. official_updates ─────────
create table if not exists official_updates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (content_table(kind) is not null),
  content_id uuid not null,
  update_type text not null check (update_type in ('corrigendum','addendum','errata','clarification','postponement','extension','cancellation',
                                                   'revival','revised_schedule','vacancy_revision','change_notice')),
  title text not null check (length(btrim(title)) between 3 and 300),
  official_url text check (official_url is null or official_url ~* '^https?://'),
  issued_on date,
  summary text check (summary is null or length(summary) <= 1000),
  changes jsonb not null default '{}'::jsonb check (jsonb_typeof(changes) = 'object'),
  discovery_id uuid references discovered_items(id) on delete set null,
  is_withdrawn boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id)
);
create unique index if not exists official_updates_discovery_uq on official_updates (discovery_id) where discovery_id is not null;
create index if not exists official_updates_content_idx on official_updates (kind, content_id, issued_on);
create index if not exists official_updates_created_by_idx on official_updates (created_by);

-- Is a content record publicly visible (published / updated / expired)? SECURITY DEFINER: evaluated for anon, who cannot
-- read drafts — it only answers yes/no.
create or replace function content_is_public(p_kind text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if content_table(p_kind) is null then return false; end if;
  execute format('select exists (select 1 from %I where id = $1 and status in (''published'',''updated'',''expired''))', content_table(p_kind)) into v using p_id;
  return v;
end $$;
revoke execute on function content_is_public(text, uuid) from public;
grant execute on function content_is_public(text, uuid) to anon, authenticated, service_role;

alter table official_updates enable row level security;
drop policy if exists official_updates_read on official_updates;
create policy official_updates_read on official_updates for select using (is_staff() or (not is_withdrawn and content_is_public(kind, content_id)));
drop policy if exists official_updates_insert on official_updates;
create policy official_updates_insert on official_updates for insert with check (has_permission(kind || ':edit') or has_permission(kind || ':publish'));
drop policy if exists official_updates_update on official_updates;
create policy official_updates_update on official_updates for update using (has_permission(kind || ':edit') or has_permission(kind || ':publish'))
  with check (has_permission(kind || ':edit') or has_permission(kind || ':publish'));
revoke delete, truncate on official_updates from anon, authenticated;   -- never erase history: withdraw instead
revoke insert, update on official_updates from anon;

-- Immutable facts: an update's type, record and source document cannot be rewritten after the fact (only its wording,
-- date and withdrawn flag can be corrected).
create or replace function official_updates_guard() returns trigger language plpgsql as $$
begin
  if not is_trusted_db_role() and (new.kind, new.content_id, new.update_type, new.discovery_id) is distinct from (old.kind, old.content_id, old.update_type, old.discovery_id) then
    raise exception 'An official update''s type, record and source cannot be changed — withdraw it and add a new one' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists official_updates_guard on official_updates;
create trigger official_updates_guard before update on official_updates for each row execute function official_updates_guard();
drop trigger if exists audit_official_updates on official_updates;
create trigger audit_official_updates after insert or update or delete on official_updates for each row execute function audit_row();

-- ───────── 4. The database writes evidence and official updates when a discovery is decided ─────────
-- Only fields whose value in the record NOW equals the extracted value are recorded (an editor may have corrected or
-- declined some) — evidence never describes a value the record does not show.
create or replace function discovery_outcome_capture() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rec jsonb; v_kind text; v_id uuid; k text; v_changes jsonb := '{}'::jsonb; v_issued date;
begin
  if new.resulting_id is null or new.resulting_kind is null or content_table(new.resulting_kind) is null then return null; end if;
  if old.review_status = new.review_status and old.resulting_id is not distinct from new.resulting_id then return null; end if;
  if new.review_status not in ('approved', 'merged') then return null; end if;
  v_kind := new.resulting_kind; v_id := new.resulting_id;
  execute format('select to_jsonb(t) from %I t where id = $1', content_table(v_kind)) into v_rec using v_id;
  if v_rec is null then return null; end if;

  -- evidence for every field the record now carries from this discovery
  for k in select jsonb_object_keys(coalesce(new.field_evidence, '{}'::jsonb)) loop
    if v_rec ? k and new.extracted ? k and (v_rec -> k)::text = (new.extracted -> k)::text and coalesce(btrim(new.field_evidence ->> k), '') <> '' then
      insert into field_evidence (kind, content_id, field, excerpt, source_url, discovery_id)
      values (v_kind, v_id, k, left(new.field_evidence ->> k, 1000), new.item_url, new.id);
    end if;
  end loop;

  -- the reviewer's per-field decisions follow the discovery onto the record
  insert into field_verifications (subject_kind, subject_id, field, status, value_checked, note, verified_by, verified_at)
  select v_kind, v_id, l.field, l.status, l.value_checked, l.note, l.verified_by, l.verified_at
    from field_verification_latest l where l.subject_kind = 'discovery' and l.subject_id = new.id;

  -- an amendment becomes an entry in the record's public chain of official updates
  if new.amendment_type is not null then
    for k in select jsonb_object_keys(coalesce(new.changes, '{}'::jsonb)) loop
      if v_rec ? k and (v_rec -> k)::text = (new.changes -> k -> 'to')::text then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', new.changes -> k -> 'from', 'to', new.changes -> k -> 'to'));
      end if;
    end loop;
    v_issued := coalesce(nullif(new.extracted ->> 'notification_date', '')::date, new.discovered_at::date);
    insert into official_updates (kind, content_id, update_type, title, official_url, issued_on, changes, discovery_id, created_by)
    values (v_kind, v_id, new.amendment_type, left(new.title, 300), new.item_url, v_issued, v_changes, new.id, coalesce(new.reviewed_by, auth.uid()))
    on conflict (discovery_id) where discovery_id is not null do nothing;
  end if;
  return null;
end $$;
revoke execute on function discovery_outcome_capture() from public, anon, authenticated;
drop trigger if exists discovery_outcome_capture on discovered_items;
create trigger discovery_outcome_capture after update of review_status, resulting_id on discovered_items
  for each row execute function discovery_outcome_capture();
