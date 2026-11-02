import {z} from 'zod';
import {id,type Identity,type Project,type ContentBundle} from './contracts.ts';
import {transaction,operation,contentHash,type Transaction} from './db.ts';
import {ensure} from './errors.ts';

// A present key is a fixed choice. Missing keys remain automatic. Independent
// requirements accumulate across scopes; overriding a choice never erases them.
const choices=z.record(z.string().regex(/^[\p{L}\p{N}_-]{1,80}$/u).refine(k=>!['__proto__','constructor','prototype'].includes(k)),z.json()).refine(v=>Object.keys(v).length<=80&&JSON.stringify(v).length<=16000,'Configuração extensa demais.');
export const configurationSchema=z.strictObject({editorial:choices,instructional:choices});
export const requirementsSchema=z.array(z.string().trim().min(1).max(1000)).max(50);
export const intentionSchema=z.string().trim().min(1).max(4000);
type Configuration=z.infer<typeof configurationSchema>;
type Layer={scope:'account'|'project'|'unit';revision:number;configuration:Configuration;requirements:string[];intention:string};
const target={scope:z.enum(['account','project','unit']),projectId:id.optional(),unitId:id.optional()};
const targetValid=(a:any)=>a.scope==='account'?!a.projectId&&!a.unitId:a.scope==='project'?Boolean(a.projectId)&&!a.unitId:Boolean(a.projectId&&a.unitId);
export const parameterSchemas={
 parameter_get:z.strictObject(target).refine(targetValid,'Alcance incompatível com as identidades.'),
 parameter_save:z.strictObject({...target,operationId:id,expectedRevision:z.number().int().nonnegative(),configuration:configurationSchema,requirements:requirementsSchema,intention:intentionSchema}).refine(targetValid,'Alcance incompatível com as identidades.'),
};
export const parameterReadTasks=new Set(['parameter_get']);
export async function lockAccountParameters(db:Transaction,accountId:string){await db.query("select pg_advisory_xact_lock(hashtextextended('um.parameters:'||$1,0))",[accountId]);}
function empty(scope:Layer['scope']):Layer{return {scope,revision:0,configuration:{editorial:{},instructional:{}},requirements:[],intention:''};}
function fromRow(scope:Layer['scope'],row:any):Layer{return row?{scope,revision:row.revision,configuration:row.configuration,requirements:row.requirements,intention:row.intention}:empty(scope);}
export async function resolveParameters(db:Transaction,ownerId:string,project?:Pick<Project,'id'|'configuration'|'revision'> & {parameterIntention?:string;requirements?:string[]},unitId?:string){
 const account=fromRow('account',(await db.query('select * from um.account_parameters where account_id=$1',[ownerId])).rows[0]);
 const layers:Layer[]=[account];
 if(project)layers.push({scope:'project',revision:project.revision,configuration:configurationSchema.parse(project.configuration),requirements:project.requirements||[],intention:project.parameterIntention||''});
 if(unitId)layers.push(fromRow('unit',(await db.query('select * from um.unit_parameters where project_id=$1 and unit_id=$2',[project!.id,unitId])).rows[0]));
 const effective:Configuration={editorial:{},instructional:{}},requirements:string[]=[],origins:Record<string,string>={},overrides:{field:string;from:string;to:string;previous:unknown;value:unknown}[]=[];
 for(const layer of layers){
  for(const group of ['editorial','instructional'] as const)for(const [key,value] of Object.entries(layer.configuration[group])){
   const field=`${group}.${key}`;
   if(Object.hasOwn(effective[group],key)&&contentHash(effective[group][key])!==contentHash(value))overrides.push({field,from:origins[field],to:layer.scope,previous:effective[group][key],value});
   effective[group][key]=value;origins[field]=layer.scope;
  }
  for(const requirement of layer.requirements)if(!requirements.includes(requirement))requirements.push(requirement);
 }
 return {layers,effective,requirements,origins,overrides,automatic:'As escolhas sem chave fixada são decididas pelo autor e registradas no conteúdo aplicado.'};
}
async function ownedProject(db:Transaction,identity:Identity,projectId:string,lock=false){
 const row=(await db.query(`select * from um.projects where id=$1${lock?' for update':''}`,[projectId])).rows[0];ensure(row?.owner_id===identity.id,'NOT_FOUND','Parâmetros disponíveis somente ao autor do projeto.',404);
 return {...row.metadata,id:row.id,revision:row.revision} as Project & {parameterIntention?:string;requirements?:string[]};
}
async function knownUnit(db:Transaction,projectId:string,unitId:string){
 const found=await db.query("select 1 from um.bundles b where project_id=$1 and profile_id is null and exists(select 1 from jsonb_array_elements(b.manifest->'index') i where i->>'kind'='unit' and i->>'id'=$2) union all select 1 from um.authoring_items i join um.authoring_drafts d on d.id=i.draft_id where d.project_id=$1 and d.profile_id is null and i.kind='unit' and i.id=$2::uuid limit 1",[projectId,unitId]);
 ensure(found.rowCount,'NOT_FOUND','Salve a unidade na preparação da base comum antes de fixar parâmetros para ela.',404);
}
export async function parameterTask(identity:Identity,task:keyof typeof parameterSchemas,input:unknown){
 const a=parameterSchemas[task].parse(input) as any;
 return transaction(identity,async db=>{
  if(task==='parameter_get'){
   const project=a.projectId?await ownedProject(db,identity,a.projectId):undefined;if(a.unitId)await knownUnit(db,a.projectId,a.unitId);
   return resolveParameters(db,identity.id,project,a.unitId);
  }
  return operation(db,identity,a.operationId,task,a,async()=>{
   await lockAccountParameters(db,identity.id);
   const project=a.projectId?await ownedProject(db,identity,a.projectId,true):undefined;if(a.unitId)await knownUnit(db,a.projectId,a.unitId);
   if(a.scope==='project'){
    ensure(project!.revision===a.expectedRevision,'CONFLICT','O projeto mudou. Releia os parâmetros.',409);
    await db.query("update um.projects set metadata=metadata||$2::jsonb,revision=revision+1 where id=$1",[a.projectId,JSON.stringify({configuration:a.configuration,requirements:a.requirements,parameterIntention:a.intention})]);
   }else{
    const table=a.scope==='account'?'account_parameters':'unit_parameters',keys=a.scope==='account'?['account_id']:['project_id','unit_id'],values=a.scope==='account'?[identity.id]:[a.projectId,a.unitId],where=keys.map((k,i)=>`${k}=$${i+1}`).join(' and ');
    const prior=(await db.query(`select revision from um.${table} where ${where} for update`,values)).rows[0];ensure((prior?.revision||0)===a.expectedRevision,'CONFLICT','Os parâmetros mudaram. Releia antes de gravar.',409);
    if(prior)await db.query(`update um.${table} set configuration=$${values.length+1},requirements=$${values.length+2},intention=$${values.length+3},revision=revision+1 where ${where}`,[...values,JSON.stringify(a.configuration),JSON.stringify(a.requirements),a.intention]);
    else await db.query(`insert into um.${table}(${keys.join(',')},configuration,requirements,intention) values(${[...values,a.configuration,a.requirements,a.intention].map((_,i)=>`$${i+1}`).join(',')})`,[...values,JSON.stringify(a.configuration),JSON.stringify(a.requirements),a.intention]);
   }
   return {scope:a.scope,...(a.projectId?{projectId:a.projectId}:{}),...(a.unitId?{unitId:a.unitId}:{}),revision:a.expectedRevision+1};
  });
 });
}
export async function publicationParameters(db:Transaction,ownerId:string,project:Project,bundle:ContentBundle){
 const global=await resolveParameters(db,ownerId,project),units:Record<string,unknown>={};
 function validate(applied:any,policy:Awaited<ReturnType<typeof resolveParameters>>,objectId:string){
  for(const group of ['editorial','instructional'] as const)for(const [key,value]of Object.entries(policy.effective[group]))ensure(applied?.[group]&&Object.hasOwn(applied[group],key)&&contentHash(applied[group][key])===contentHash(value),'PARAMETERS_CHANGED',`Confira a configuração aplicada em ${objectId}: ${group}.${key}.`,409);
 }
 const snapshot=(p:typeof global)=>({effective:p.effective,requirements:p.requirements});
 for(const u of bundle.units){const policy=await resolveParameters(db,ownerId,project,u.id);validate(u.appliedConfiguration,policy,u.id);units[u.id]=snapshot(policy);}
 for(const q of bundle.choices){const policy=await resolveParameters(db,ownerId,project,q.unitId);validate(q.appliedConfiguration,policy,q.id);units[q.unitId]=snapshot(policy);}
 for(const r of bundle.resources){const policy=r.unitId?await resolveParameters(db,ownerId,project,r.unitId):global;validate(r.appliedConfiguration,policy,r.id);if(r.unitId)units[r.unitId]=snapshot(policy);}
 return {...snapshot(global),units};
}
