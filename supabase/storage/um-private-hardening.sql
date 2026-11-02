-- Apply after um-private.sql. A permissive policy owned by another product must
-- not bypass Um's ACL. This restrictive policy evaluates TRUE for other buckets.
create policy um_object_isolation on storage.objects as restrictive for all to authenticated
using(bucket_id<>'um-private' or (
 (storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info','object.head_authenticated_info'])
  and exists(select 1 from um.files f where f.path=storage.objects.name))
 or (storage.allow_any_operation(array['object.delete','object.delete_many']) and um.file_deletion_access(name))
))
with check(bucket_id<>'um-private' or (
 storage.allow_only_operation('object.upload') and um.file_upload_access(name)
));
