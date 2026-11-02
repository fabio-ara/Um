create table um.account_parameters (
 account_id uuid primary key references auth.users(id) on delete cascade,
 revision integer not null default 1 check(revision>0),
 configuration jsonb not null, requirements jsonb not null, intention text not null
);
create table um.unit_parameters (
 project_id uuid not null references um.projects(id) on delete cascade, unit_id uuid not null,
 revision integer not null default 1 check(revision>0),
 configuration jsonb not null, requirements jsonb not null, intention text not null,
 primary key(project_id,unit_id)
);
alter table um.account_parameters enable row level security;
alter table um.account_parameters force row level security;
alter table um.unit_parameters enable row level security;
alter table um.unit_parameters force row level security;
create policy account_parameters_owner on um.account_parameters for all to authenticated using(account_id=auth.uid()) with check(account_id=auth.uid());
create policy unit_parameters_owner on um.unit_parameters for all to authenticated using(um.project_owner(project_id)) with check(um.project_owner(project_id));
grant select,insert,update,delete on um.account_parameters,um.unit_parameters to authenticated;
