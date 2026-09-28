-- 0022 · Source trust model (Phase 3.6 item 8). Idempotent (create or replace only).
--
-- Rule: a record can only be PUBLISHED if at least one of its official links is on a TRUSTED domain:
--   registered  — the domain (or a sub-domain) of a source in the official-source registry (government_sources), or
--   government  — a .gov.in / .nic.in host.
-- Other links (e.g. an application portal run by an exam agency) are still allowed alongside a trusted one; public pages show
-- the host of every link so a reader can see where it goes. This stops an editor-created record from looking like an official
-- publication when all it points to is a private portal. Registering a new official domain needs `source:manage`.

create or replace function official_url_trust(p_url text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_url is null or url_host(p_url) is null then null
    when exists (select 1 from government_sources g where url_in_domain(p_url, g.official_domain)) then 'registered'
    when url_host(p_url) ~ '(^|\.)(gov\.in|nic\.in)$' then 'government'
    else 'unrecognised' end
$$;
revoke execute on function official_url_trust(text) from public, anon;
grant execute on function official_url_trust(text) to authenticated, service_role;

-- Shared by every non-job kind (see 0006). Now also requires one trusted URL among the kind's official URLs + source_url.
create or replace function official_source_missing(r jsonb, p_url_keys text[]) returns text[]
language plpgsql stable set search_path = public as $$
declare m text[] := '{}'; k text; has_url boolean := false; trusted boolean := false;
begin
  if coalesce(btrim(r->>'source_name'), '') = '' then m := array_append(m, 'source name'); end if;
  if r->>'source_checked_at' is null then m := array_append(m, 'source last checked date'); end if;
  foreach k in array p_url_keys loop
    if coalesce(btrim(r->>k), '') <> '' then
      has_url := true;
      if official_url_trust(r->>k) in ('registered', 'government') then trusted := true; end if;
    end if;
  end loop;
  if official_url_trust(r->>'source_url') in ('registered', 'government') then trusted := true; end if;
  if not has_url then m := array_append(m, 'official URL (' || array_to_string(p_url_keys, ' or ') || ')');
  elsif not trusted then m := array_append(m, 'an official link on a registered official domain or a .gov.in/.nic.in domain (register the organisation''s official website under Sources first)');
  end if;
  return m;
end $$;
revoke execute on function official_source_missing(jsonb, text[]) from public, anon;

-- Jobs have their own gate (0003). Same rules as before, plus the trusted-domain rule over notification / website / source URL.
create or replace function assert_job_publishable(j jobs) returns void
language plpgsql stable set search_path = public as $$
declare missing text[] := '{}';
begin
  if btrim(coalesce(j.title, '')) = ''                          then missing := array_append(missing, 'title'); end if;
  if j.organization_id is null                                   then missing := array_append(missing, 'organization'); end if;
  if not (j.is_all_india or j.state_id is not null)              then missing := array_append(missing, 'state (or All India)'); end if;
  if coalesce(btrim(j.source_name), '') = ''                     then missing := array_append(missing, 'source name'); end if;
  if j.source_checked_at is null                                 then missing := array_append(missing, 'source last checked date'); end if;
  if coalesce(j.notification_url, j.official_website_url) is null then missing := array_append(missing, 'official notification URL or official website URL');
  elsif not (coalesce(official_url_trust(j.notification_url), '') in ('registered', 'government')
          or coalesce(official_url_trust(j.official_website_url), '') in ('registered', 'government')
          or coalesce(official_url_trust(j.source_url), '') in ('registered', 'government')) then
    missing := array_append(missing, 'an official link on a registered official domain or a .gov.in/.nic.in domain (register the organisation''s official website under Sources first)');
  end if;
  if not exists (select 1 from job_qualifications q where q.job_id = j.id) then missing := array_append(missing, 'at least one qualification'); end if;
  if array_length(missing, 1) is not null then
    raise exception 'Cannot publish: missing required official information: %', array_to_string(missing, ', ') using errcode = '23514';
  end if;
end $$;
