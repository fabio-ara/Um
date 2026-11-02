-- Apply only after the Um migrations and Storage initialization. Additive: no
-- policy, object or bucket belonging to another product is replaced.
-- Operation names: supabase/storage v1.73.1 src/http/routes/operations.ts.
begin;
insert into storage.buckets(id,name,public,file_size_limit) values('um-private','um-private',false,8388608);
create policy um_object_upload on storage.objects for insert to authenticated with check(
 bucket_id='um-private' and storage.allow_only_operation('object.upload') and um.file_upload_access(name)
);
create policy um_object_read on storage.objects for select to authenticated using(
 bucket_id='um-private' and (
  (storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info','object.head_authenticated_info'])
   and exists(select 1 from um.files f where f.path=name))
  or (storage.allow_any_operation(array['object.delete','object.delete_many']) and um.file_deletion_access(name))
 )
);
create policy um_object_delete on storage.objects for delete to authenticated using(
 bucket_id='um-private' and storage.allow_any_operation(array['object.delete','object.delete_many']) and um.file_deletion_access(name)
);
commit;
