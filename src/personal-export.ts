import {z} from 'zod';
import {id,type Identity} from './contracts.ts';
import {transaction,contentHash,type Transaction} from './db.ts';
import {ensure} from './errors.ts';
import {getFile} from './files.ts';

const sections={
 participations:'select * from um.participations where profile_id=$1',
 forms:'select * from um.forms where profile_id=$1',
 formHistory:"select r.form_id::text||':'||r.revision::text as id,r.* from um.form_revisions r join um.forms f on f.id=r.form_id where f.profile_id=$1",
 submissions:'select * from um.submissions where profile_id=$1',
 records:'select * from um.reader_records where profile_id=$1',
 bundles:'select * from um.bundles where profile_id=$1',
 reasons:'select resource_id as id,* from um.personalization_reasons where profile_id=$1',
 authoring:'select * from um.authoring_drafts where profile_id=$1',
 authoringItems:"select i.draft_id::text||':'||i.kind||':'||i.id::text as id,i.kind,i.position,i.file_path from um.authoring_items i join um.authoring_drafts d on d.id=i.draft_id where d.profile_id=$1",
 comments:'select * from um.comments where origin_profile_id=$1',
 observations:'select * from um.observations where origin_profile_id=$1',
 files:'select path as id,path,sha256,bytes,media_type,offline_allowed from um.files where profile_id=$1',
} as const;
const sectionNames=Object.keys(sections) as (keyof typeof sections)[];
export const personalExportSchemas={
 profile_export:z.strictObject({profileId:id}),
 profile_export_page:z.strictObject({profileId:id,section:z.enum(sectionNames),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(100)}),
 profile_export_file:z.strictObject({profileId:id,path:z.string().regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}$/)}),
};
export const personalExportReadTasks=new Set(Object.keys(personalExportSchemas));
async function ownProfile(db:Transaction,identity:Identity,profileId:string){
 const row=(await db.query('select * from um.profiles where id=$1',[profileId])).rows[0];ensure(row,'NOT_FOUND','Perfil indisponível.',404);
 ensure(row.holder_id===identity.id||row.holder_id===null&&row.creator_id===identity.id,'FORBIDDEN','A exportação pertence ao titular.',403);
 return {id:row.id,creatorId:row.creator_id,holderId:row.holder_id,creatorAccess:row.creator_access,visibility:row.visibility,fields:row.fields,revision:row.revision};
}
export async function personalExportTask(identity:Identity,task:keyof typeof personalExportSchemas,input:unknown):Promise<unknown>{
 const a=personalExportSchemas[task].parse(input) as any;
 if(task==='profile_export_file'){
  const file=await transaction(identity,async db=>{await ownProfile(db,identity,a.profileId);const row=(await db.query('select path,sha256,bytes,media_type,offline_allowed from um.files where profile_id=$1 and path=$2',[a.profileId,a.path])).rows[0];ensure(row,'NOT_FOUND','Arquivo pessoal indisponível.',404);ensure(row.offline_allowed,'RIGHTS','Os direitos registrados permitem consulta, mas não exportação deste material preparado.',403);return row;});
  const bytes=await getFile(identity,file.path);
  return {...file,encoding:'base64',content:bytes.toString('base64')};
 }
 return transaction(identity,async db=>{
  const profile=await ownProfile(db,identity,a.profileId);
  if(task==='profile_export_page'){
   const sql=sections[a.section as keyof typeof sections];
   const items=(await db.query(`select * from (${sql}) e order by e.id limit $2 offset $3`,[a.profileId,a.limit,a.offset])).rows;
   return {profileId:a.profileId,section:a.section,items,offset:a.offset,limit:a.limit};
  }
  const inventory=[];
  for(const name of sectionNames){
   // The SQL digest detects changes during a paginated export; it does not
   // replace the SHA-256 integrity check on canonical file bytes.
   const stat=(await db.query(`select count(*)::int total,md5(coalesce(string_agg(md5(to_jsonb(e)::text),'' order by e.id),'')) signature from (${sections[name]}) e`,[a.profileId])).rows[0];
   inventory.push({name,...stat});
  }
  return {format:'um-personal-export/2',exportedAt:new Date().toISOString(),profile,sections:inventory.map(({name,total})=>({name,total})),snapshot:contentHash({profile,inventory}),retention:{personal:'Perfil, formulários, respostas, estado, apoios e justificativas são dados desta exportação.',preparedFiles:'Arquivos preparados são obtidos separadamente quando os direitos permitem. O índice registra as restrições.',externalCopies:'Cópias exportadas para fora do Um não podem ser recolhidas pelo serviço.'}};
 });
}
