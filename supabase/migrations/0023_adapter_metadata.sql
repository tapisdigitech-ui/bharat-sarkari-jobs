-- 0023 · Source adapter metadata on discoveries (Phase 3.6 items 9, 17). Idempotent.
--   amendment_type — what kind of official update the notice is (corrigendum, addendum, postponement, extension, cancellation,
--                    revival, revised schedule, vacancy revision, errata, clarification, change notice); null for an original notice.
--   external_id    — the source's own id for the notice when a feed provides one.
--   group_key      — the source's grouping key (e.g. the exam a notice belongs to) — links an original to its later corrigenda.
alter table discovered_items add column if not exists amendment_type text;
alter table discovered_items add column if not exists external_id text;
alter table discovered_items add column if not exists group_key text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'discovered_items_amendment_type_check') then
    alter table discovered_items add constraint discovered_items_amendment_type_check check (amendment_type is null or amendment_type in
      ('corrigendum','addendum','errata','clarification','postponement','extension','cancellation','revival','revised_schedule','vacancy_revision','change_notice'));
  end if;
end $$;
create index if not exists discovered_items_group_key_idx on discovered_items (source_id, group_key) where group_key is not null;
