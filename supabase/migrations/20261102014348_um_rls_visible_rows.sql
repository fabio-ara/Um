-- INSERT ... RETURNING deve avaliar a própria linha, sem lookup em snapshot anterior.
drop policy profile_read on um.profiles;
create policy profile_read on um.profiles for select to authenticated using(um.session_valid() and (holder_id=auth.uid() or creator_id=auth.uid() and creator_access));
drop policy project_read on um.projects;
create policy project_read on um.projects for select to authenticated using(um.session_valid() and (owner_id=auth.uid() or um.project_access(id)));
drop policy source_read on um.sources;
create policy source_read on um.sources for select to authenticated using(um.session_valid() and (owner_id=auth.uid() or um.source_access(id)));
