-- Authoring stays private until the existing atomic publication succeeds.
create table um.authoring_drafts (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references um.projects(id) on delete cascade,
 profile_id uuid references um.profiles(id) on delete cascade,
 revision integer not null default 1 check(revision>0),
 expected_revision integer not null check(expected_revision>=0),
 base_revision integer not null check(base_revision>0),
 status text not null default 'draft' check(status in ('draft','published')),
 next_step text not null,
 inspection jsonb not null,
 updated_at timestamptz not null default now(),
 foreign key(project_id,profile_id) references um.participations(project_id,profile_id) on delete cascade
);
create unique index authoring_one_open on um.authoring_drafts(project_id,profile_id) nulls not distinct where status='draft';
create table um.authoring_items (
 draft_id uuid not null references um.authoring_drafts(id) on delete cascade,
 kind text not null check(kind in ('unit','resource','choice','coverage','reason')),
 id uuid not null, position integer not null check(position>=0), body jsonb not null,
 primary key(draft_id,kind,id)
);
alter table um.authoring_drafts enable row level security;
alter table um.authoring_drafts force row level security;
alter table um.authoring_items enable row level security;
alter table um.authoring_items force row level security;
create policy authoring_read on um.authoring_drafts for select to authenticated using(
 um.project_owner(project_id) and (profile_id is null or um.profile_access(profile_id)) or profile_id is not null and um.profile_holder(profile_id)
);
create policy authoring_write on um.authoring_drafts for all to authenticated using(
 um.project_owner(project_id) and (profile_id is null or um.profile_access(profile_id))
) with check(um.project_owner(project_id) and (profile_id is null or um.profile_access(profile_id)));
create policy authoring_item_read on um.authoring_items for select to authenticated using(exists(select 1 from um.authoring_drafts d where d.id=draft_id));
create policy authoring_item_write on um.authoring_items for all to authenticated using(exists(
 select 1 from um.authoring_drafts d where d.id=draft_id and um.project_owner(d.project_id) and (d.profile_id is null or um.profile_access(d.profile_id))
)) with check(exists(select 1 from um.authoring_drafts d where d.id=draft_id and um.project_owner(d.project_id) and (d.profile_id is null or um.profile_access(d.profile_id))));
grant select,insert,update,delete on um.authoring_drafts,um.authoring_items to authenticated;
