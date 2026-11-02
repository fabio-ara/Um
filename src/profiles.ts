import {randomBytes,createHash} from 'node:crypto';
import {z} from 'zod';
import type {Identity,Profile} from './contracts.ts';
import {id} from './contracts.ts';
import {ensure} from './errors.ts';
import {personalExportSchemas,personalExportTask} from './personal-export.ts';
import {operation,transaction,priorOperation,type Transaction} from './db.ts';
const fieldsSchema=z.record(z.string().min(1).max(80),z.string().max(4000)).refine(v=>Object.keys(v).length<=40,'Perfil excede 40 campos.');
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
function profile(row:any):Profile{return {id:row.id,creatorId:row.creator_id,holderId:row.holder_id,creatorAccess:row.creator_access,visibility:row.visibility,fields:row.fields,revision:row.revision};}
export const profileSchemas={
  profile_list:z.strictObject({offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(50).default(20)}),
  profile_get:z.strictObject({profileId:id}),
  profile_create:z.strictObject({operationId:id,fields:fieldsSchema,self:z.boolean().default(false)}),
  profile_update:z.strictObject({operationId:id,profileId:id,fields:fieldsSchema}),
  invite_create:z.strictObject({operationId:id,profileId:id,expiresInHours:z.number().int().min(1).max(168).default(72)}),
  invite_revoke:z.strictObject({operationId:id,inviteId:id}),
  invite_accept:z.strictObject({operationId:id,token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}),
  profile_control:z.strictObject({operationId:id,profileId:id,action:z.enum(['revoke_creator','publish','private','delete'])}),
  ...personalExportSchemas,
};
export const profileReadTasks=new Set(['profile_list','profile_get',...Object.keys(personalExportSchemas)]);
async function requireProfile(db:Transaction,profileId:string){const q=await db.query('select * from um.profiles where id=$1',[profileId]);ensure(q.rowCount,'NOT_FOUND','Perfil indisponível.',404);return profile(q.rows[0]);}
export async function profileTask(identity:Identity,task:keyof typeof profileSchemas,input:unknown){
  if(Object.hasOwn(personalExportSchemas,task))return personalExportTask(identity,task as keyof typeof personalExportSchemas,input);
  const args=profileSchemas[task].parse(input) as any;
  return transaction(identity,async db=>{
    if(task==='profile_control'&&args.action==='delete'){
      const prior=await priorOperation(db,identity,args.operationId,task,args);if(prior)return prior;
    }
    if(task==='profile_list')return {items:(await db.query('select * from um.profiles order by id limit $1 offset $2',[args.limit,args.offset])).rows.map(profile),offset:args.offset,limit:args.limit};
    if(task==='profile_get')return requireProfile(db,args.profileId);
    // Check current access BEFORE a receipt can be returned after revocation.
    if(args.profileId)await requireProfile(db,args.profileId);
    return operation(db,identity,args.operationId,task,args,async()=>{
      if(task==='profile_create'){
        const q=await db.query('insert into um.profiles(creator_id,fields) values($1,$2) returning id',[identity.id,JSON.stringify(args.fields)]),profileId=q.rows[0].id;
        if(args.self){const token=randomBytes(32).toString('base64url');await db.query("insert into um.invites(profile_id,token_hash,expires_at,created_by) values($1,$2,now()+interval '1 minute',$3)",[profileId,digest(token),identity.id]);await db.query('select um.accept_invite($1)',[digest(token)]);}
        return {profileId};
      }
      if(task==='profile_update'){
        const q=await db.query('update um.profiles set fields=fields||$2::jsonb,revision=revision+1 where id=$1 returning revision',[args.profileId,JSON.stringify(args.fields)]);
        ensure(q.rowCount,'NOT_FOUND','Perfil indisponível.',404);return {profileId:args.profileId,revision:q.rows[0].revision};
      }
      if(task==='invite_create'){
        const p=await requireProfile(db,args.profileId);ensure(p.holderId===null&&p.creatorId===identity.id,'FORBIDDEN','Perfil já associado ou sem permissão.',403);
        const token=randomBytes(32).toString('base64url');
        const q=await db.query("insert into um.invites(profile_id,token_hash,expires_at,created_by) values($1,$2,now()+make_interval(hours=>$3),$4) returning id,expires_at",[args.profileId,digest(token),args.expiresInHours,identity.id]);
        // Token is a deliberate invitation capability. It is returned only to its creator.
        return {inviteId:q.rows[0].id,profileId:args.profileId,token,expiresAt:q.rows[0].expires_at.toISOString()};
      }
      if(task==='invite_revoke'){
        const q=await db.query('update um.invites set revoked=true where id=$1 returning id',[args.inviteId]);ensure(q.rowCount,'NOT_FOUND','Convite indisponível.',404);return {inviteId:args.inviteId};
      }
      if(task==='invite_accept'){
        const q=await db.query('select um.accept_invite($1) as id',[digest(args.token)]);return {profileId:q.rows[0].id};
      }
      if(task==='profile_control'){
        await db.query('select um.profile_control($1,$2)',[args.profileId,args.action]);return {profileId:args.profileId,action:args.action};
      }
      throw Error('Tarefa de perfil não implementada.');
    });
  });
}
