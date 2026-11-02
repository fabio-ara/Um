-- Aditiva: somente domínio Um. Não altera tabelas/hooks/redirects de AraLearn.
create schema if not exists um;
revoke all on schema um from public, anon;
grant usage on schema um to authenticated;
alter default privileges in schema um revoke execute on functions from public;

create function um.session_valid() returns boolean language sql stable security definer
set search_path = pg_catalog as $$
 select exists(select 1 from auth.sessions s
 where s.user_id=auth.uid()
 and s.id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid
 and (s.not_after is null or s.not_after>now()))
$$;
revoke all on function um.session_valid() from public,anon;
grant execute on function um.session_valid() to authenticated;

create table um.client_grants (
 account_id uuid not null references auth.users(id) on delete cascade,
 client_id uuid not null, permission text not null check(permission in ('read','write')),
 primary key(account_id,client_id)
);
create table um.profiles (
 id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users(id),
 holder_id uuid references auth.users(id), creator_access boolean not null default true,
 visibility text not null default 'private' check(visibility in ('private','public')),
 fields jsonb not null default '{}' check(jsonb_typeof(fields)='object'), revision integer not null default 1 check(revision>0)
);
create table um.invites (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null references um.profiles(id) on delete cascade,
 token_hash text not null unique, expires_at timestamptz not null, revoked boolean not null default false,
 used_by uuid references auth.users(id), created_by uuid not null references auth.users(id)
);
create table um.projects (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 title text not null, metadata jsonb not null default '{}', revision integer not null default 1,
 active_revision integer, base_state text not null default 'preparing' check(base_state in ('preparing','producing','available','correcting'))
);
create table um.participations (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references um.projects(id) on delete cascade,
 profile_id uuid not null references um.profiles(id) on delete cascade,
 state text not null default 'invited' check(state in ('invited','form_available','submitted','producing','available','stale')),
 form_id uuid, submission_id uuid, active_revision integer,
 unique(project_id,profile_id)
);
create function um.profile_access(target uuid) returns boolean language sql stable security definer
set search_path = pg_catalog as $$
 select um.session_valid() and exists(select 1 from um.profiles p where p.id=target and
 (p.holder_id=auth.uid() or p.creator_id=auth.uid() and p.creator_access))
$$;
create function um.project_access(target uuid) returns boolean language sql stable security definer
set search_path = pg_catalog as $$
 select um.session_valid() and (exists(select 1 from um.projects p where p.id=target and p.owner_id=auth.uid())
 or exists(select 1 from um.participations p join um.profiles f on f.id=p.profile_id
 where p.project_id=target and f.holder_id=auth.uid()))
$$;
create function um.project_owner(target uuid) returns boolean language sql stable security definer
set search_path = pg_catalog as $$
 select um.session_valid() and exists(select 1 from um.projects p where p.id=target and p.owner_id=auth.uid())
$$;
create function um.profile_holder(target uuid) returns boolean language sql stable security definer
set search_path = pg_catalog as $$
 select um.session_valid() and exists(select 1 from um.profiles p where p.id=target and p.holder_id=auth.uid())
$$;
revoke all on function um.profile_access(uuid),um.project_access(uuid),um.project_owner(uuid),um.profile_holder(uuid) from public,anon;
grant execute on function um.profile_access(uuid),um.project_access(uuid),um.project_owner(uuid),um.profile_holder(uuid) to authenticated;

create table um.sources (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 revision integer not null default 1, sha256 text not null,
 metadata jsonb not null, body_file text not null, original_file text,
 unique(owner_id,sha256)
);
create table um.source_revisions (
 source_id uuid not null references um.sources(id) on delete cascade,
 revision integer not null, body_file text not null, sha256 text not null,
 primary key(source_id,revision)
);
create table um.project_sources (
 project_id uuid not null references um.projects(id) on delete cascade,
 source_id uuid not null references um.sources(id), primary key(project_id,source_id)
);
create function um.source_access(target uuid) returns boolean language sql stable security definer
set search_path = pg_catalog as $$
 select um.session_valid() and (exists(select 1 from um.sources s where s.id=target and s.owner_id=auth.uid())
 or exists(select 1 from um.project_sources s where s.source_id=target and um.project_access(s.project_id)))
$$;
revoke all on function um.source_access(uuid) from public,anon;
grant execute on function um.source_access(uuid) to authenticated;

create table um.forms (
 id uuid primary key, project_id uuid not null, profile_id uuid not null,
 revision integer not null, definition jsonb not null, published boolean not null default false,
 foreign key(project_id,profile_id) references um.participations(project_id,profile_id) on delete cascade
);
create table um.submissions (
 id uuid primary key default gen_random_uuid(), form_id uuid not null references um.forms(id) on delete cascade,
 profile_id uuid not null references um.profiles(id) on delete cascade,
 respondent_id uuid not null references auth.users(id), project_id uuid not null references um.projects(id) on delete cascade,
 form_revision integer not null, revision integer not null, answers jsonb not null, submitted_at timestamptz not null default now(),
 unique(form_id,revision)
);
create table um.bundles (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references um.projects(id) on delete cascade,
 profile_id uuid references um.profiles(id) on delete cascade, revision integer not null, base_revision integer not null,
 manifest jsonb not null, status text not null check(status in ('prepared','published')),
 unique nulls not distinct (project_id,profile_id,revision)
);
create table um.personalization_reasons (
 resource_id uuid primary key, project_id uuid not null references um.projects(id) on delete cascade,
 profile_id uuid not null references um.profiles(id) on delete cascade,
 submission_id uuid not null references um.submissions(id) on delete cascade, metadata jsonb not null
);
create table um.reader_records (
 id uuid primary key, account_id uuid not null references auth.users(id) on delete cascade,
 profile_id uuid not null references um.profiles(id) on delete cascade,
 project_id uuid not null references um.projects(id) on delete cascade,
 kind text not null check(kind in ('state','draft','note','term','attempt','time')),
 revision integer not null default 1, data jsonb not null
);
create table um.comments (
 id uuid primary key, account_id uuid not null references auth.users(id),
 project_id uuid not null references um.projects(id) on delete cascade,
 target jsonb not null, text text not null, reply_to uuid references um.comments(id)
);
create table um.observations (
 id uuid primary key, account_id uuid not null references auth.users(id),
 project_id uuid not null references um.projects(id) on delete cascade,
 target jsonb not null, text text not null, status text not null default 'open' check(status in ('open','addressed','unchanged')), result text
);
create table um.catalog (
 id uuid not null, account_id uuid, kind text not null check(kind in ('method','resource','entity','relation')),
 revision integer not null, data jsonb not null, unique nulls not distinct (id,account_id)
);
create table um.operations (
 account_id uuid not null references auth.users(id) on delete cascade, id uuid not null,
 task text not null, intent text not null, result jsonb not null, committed_at timestamptz not null default now(),
 primary key(account_id,id)
);
create table um.files (
 path text primary key, owner_id uuid not null references auth.users(id),
 source_id uuid references um.sources(id) on delete cascade, project_id uuid references um.projects(id) on delete cascade,
 profile_id uuid references um.profiles(id) on delete cascade, sha256 text not null, bytes bigint not null,
 media_type text not null, offline_allowed boolean not null, state text not null check(state in ('prepared','published')),
 created_at timestamptz not null default now()
);

do $$ declare t text; begin
 foreach t in array array['client_grants','profiles','invites','projects','participations','sources','source_revisions','project_sources','forms','submissions','bundles','personalization_reasons','reader_records','comments','observations','catalog','operations','files'] loop
 execute format('alter table um.%I enable row level security',t);
 execute format('revoke all on um.%I from public,anon',t);
 end loop;
end $$;

create policy own_grants on um.client_grants for all to authenticated using(account_id=auth.uid() and um.session_valid() and nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'client_id' is null) with check(account_id=auth.uid() and um.session_valid() and nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'client_id' is null);
create policy read_grant on um.client_grants for select to authenticated using(account_id=auth.uid() and um.session_valid());
create policy profile_read on um.profiles for select to authenticated using(um.profile_access(id));
create policy profile_create on um.profiles for insert to authenticated with check(creator_id=auth.uid() and holder_id is null and creator_access and visibility='private' and um.session_valid());
create policy profile_edit on um.profiles for update to authenticated using(um.profile_access(id)) with check(um.profile_access(id));
create policy invite_owner on um.invites for all to authenticated using(created_by=auth.uid() and um.profile_access(profile_id)) with check(created_by=auth.uid() and exists(select 1 from um.profiles p where p.id=profile_id and p.holder_id is null and p.creator_id=auth.uid() and p.creator_access));
create policy project_read on um.projects for select to authenticated using(um.project_access(id));
create policy project_write on um.projects for all to authenticated using(owner_id=auth.uid() and um.session_valid()) with check(owner_id=auth.uid() and um.session_valid());
create policy participation_read on um.participations for select to authenticated using(um.project_owner(project_id) and um.profile_access(profile_id) or um.profile_holder(profile_id));
create policy participation_write on um.participations for all to authenticated using(um.project_owner(project_id) and um.profile_access(profile_id)) with check(um.project_owner(project_id) and um.profile_access(profile_id));
create policy source_read on um.sources for select to authenticated using(um.source_access(id));
create policy source_write on um.sources for all to authenticated using(owner_id=auth.uid() and um.session_valid()) with check(owner_id=auth.uid() and um.session_valid());
create policy source_revision_read on um.source_revisions for select to authenticated using(um.source_access(source_id));
create policy source_revision_write on um.source_revisions for insert to authenticated with check(exists(select 1 from um.sources s where s.id=source_id and s.owner_id=auth.uid()));
create policy project_source_read on um.project_sources for select to authenticated using(um.project_access(project_id));
create policy project_source_write on um.project_sources for all to authenticated using(um.project_owner(project_id)) with check(um.project_owner(project_id) and um.source_access(source_id));
create policy form_read on um.forms for select to authenticated using(um.profile_holder(profile_id) or um.project_owner(project_id) and um.profile_access(profile_id));
create policy form_write on um.forms for all to authenticated using(um.project_owner(project_id) and um.profile_access(profile_id)) with check(um.project_owner(project_id) and um.profile_access(profile_id));
create policy submission_read on um.submissions for select to authenticated using(um.profile_holder(profile_id) or um.project_owner(project_id) and um.profile_access(profile_id));
create policy submission_insert on um.submissions for insert to authenticated with check(respondent_id=auth.uid() and um.profile_holder(profile_id) and exists(select 1 from um.forms f where f.id=form_id and f.profile_id=submissions.profile_id and f.project_id=submissions.project_id and f.revision=form_revision and f.published));
create policy bundle_read on um.bundles for select to authenticated using(um.project_owner(project_id) and (profile_id is null or um.profile_access(profile_id)) or status='published' and um.project_access(project_id) and (profile_id is null or um.profile_holder(profile_id)));
create policy bundle_write on um.bundles for all to authenticated using(um.project_owner(project_id) and (profile_id is null or um.profile_access(profile_id))) with check(um.project_owner(project_id) and (profile_id is null or um.profile_access(profile_id)));
create policy reasons_read on um.personalization_reasons for select to authenticated using(um.profile_holder(profile_id) or um.project_owner(project_id) and um.profile_access(profile_id));
create policy reasons_write on um.personalization_reasons for all to authenticated using(um.project_owner(project_id) and um.profile_access(profile_id)) with check(um.project_owner(project_id) and um.profile_access(profile_id));
create policy reader_own on um.reader_records for all to authenticated using(account_id=auth.uid() and um.profile_holder(profile_id) and um.project_access(project_id)) with check(account_id=auth.uid() and um.profile_holder(profile_id) and um.project_access(project_id));
create policy comments_read on um.comments for select to authenticated using(um.project_access(project_id));
create policy comments_write on um.comments for all to authenticated using(account_id=auth.uid() and um.project_access(project_id)) with check(account_id=auth.uid() and um.project_access(project_id));
create policy observations_read on um.observations for select to authenticated using(account_id=auth.uid() and um.project_access(project_id) or um.project_owner(project_id));
create policy observations_insert on um.observations for insert to authenticated with check(account_id=auth.uid() and um.project_access(project_id) and status='open' and result is null);
create policy observations_resolve on um.observations for update to authenticated using(um.project_owner(project_id)) with check(um.project_owner(project_id));
create policy catalog_read on um.catalog for select to authenticated using(um.session_valid() and (account_id is null or account_id=auth.uid()));
create policy catalog_write on um.catalog for all to authenticated using(account_id=auth.uid() and um.session_valid()) with check(account_id=auth.uid() and um.session_valid());
create policy operations_own on um.operations for all to authenticated using(account_id=auth.uid() and um.session_valid()) with check(account_id=auth.uid() and um.session_valid());
create policy files_read on um.files for select to authenticated using(um.session_valid() and (owner_id=auth.uid() and (profile_id is null or um.profile_access(profile_id)) or state='published' and (source_id is not null and um.source_access(source_id) or project_id is not null and um.project_access(project_id)) and (profile_id is null or um.profile_holder(profile_id))));
create policy files_write on um.files for all to authenticated using(owner_id=auth.uid() and um.session_valid() and (profile_id is null or um.profile_access(profile_id))) with check(owner_id=auth.uid() and um.session_valid() and (profile_id is null or um.profile_access(profile_id)) and (source_id is null or exists(select 1 from um.sources s where s.id=source_id and s.owner_id=auth.uid())) and (project_id is null or um.project_owner(project_id)));

grant select,insert,delete on um.profiles to authenticated;
grant update(fields,revision) on um.profiles to authenticated;
grant select,insert,update,delete on um.client_grants,um.invites,um.projects,um.participations,um.sources,um.project_sources,um.forms,um.bundles,um.personalization_reasons,um.reader_records,um.comments,um.catalog,um.operations,um.files to authenticated;
grant select,insert on um.source_revisions,um.submissions to authenticated;
grant select,insert on um.observations to authenticated;
grant update(status,result) on um.observations to authenticated;

create function um.accept_invite(digest text) returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare inv um.invites; target uuid; begin
 if not um.session_valid() then raise exception 'UNAUTHENTICATED'; end if;
 select * into inv from um.invites where token_hash=digest and not revoked and used_by is null and expires_at>now() for update;
 if not found then raise exception 'INVALID_INVITE'; end if;
 update um.profiles set holder_id=auth.uid(),revision=revision+1 where id=inv.profile_id and holder_id is null and creator_access returning id into target;
 if target is null then raise exception 'INVALID_INVITE'; end if;
 update um.invites set used_by=auth.uid() where id=inv.id;
 update um.invites set revoked=true where profile_id=target and id<>inv.id;
 return target;
end $$;
create function um.profile_control(target uuid, action text) returns void language plpgsql security definer set search_path = pg_catalog as $$
begin
 if not um.profile_holder(target) then raise exception 'FORBIDDEN'; end if;
 if action='revoke_creator' then
  update um.profiles set creator_access=false,revision=revision+1 where id=target;
  update um.invites set revoked=true where profile_id=target;
 elsif action='publish' then update um.profiles set visibility='public',revision=revision+1 where id=target;
 elsif action='private' then update um.profiles set visibility='private',revision=revision+1 where id=target;
 elsif action='delete' then delete from um.profiles where id=target;
 else raise exception 'INVALID_ACTION'; end if;
end $$;
revoke all on function um.accept_invite(text),um.profile_control(uuid,text) from public,anon;
grant execute on function um.accept_invite(text),um.profile_control(uuid,text) to authenticated;

create index participation_profile_idx on um.participations(profile_id);
create index source_project_idx on um.project_sources(source_id);
create index form_profile_idx on um.forms(profile_id);
create index reader_profile_idx on um.reader_records(account_id,profile_id);
create index comments_project_idx on um.comments(project_id);
create index observations_project_idx on um.observations(project_id);
create index files_owner_idx on um.files(owner_id);
