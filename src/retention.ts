import {z} from 'zod';
import {id,type Identity} from './contracts.ts';
import {transaction,operation,priorOperation} from './db.ts';
import {deleteQueuedFile,scanAbandonedFiles} from './files.ts';
export const retentionSchemas={data_cleanup:z.strictObject({operationId:id,limit:z.number().int().min(1).max(100).default(30)}),data_orphan_scan:z.strictObject({operationId:id,after:z.string().regex(/^(?:[a-f0-9-]{36}\/[a-f0-9-]{36})?$/).default(''),limit:z.number().int().min(1).max(100).default(100)}),data_status:z.strictObject({})};
export const retentionReadTasks=new Set(['data_status']);
export async function deletionStatus(identity:Identity){return transaction(identity,async db=>(await db.query('select count(*) filter(where completed_at is null)::int pending,count(*) filter(where completed_at is not null)::int completed from um.file_deletions where requested_by=$1',[identity.id])).rows[0]);}
export async function cleanupFiles(identity:Identity,limit=30){
 const jobs=await transaction(identity,async db=>(await db.query('select path from um.file_deletions where requested_by=$1 and completed_at is null order by requested_at,path limit $2',[identity.id,limit])).rows);
 let removed=0;
 for(const job of jobs){try{await deleteQueuedFile(identity,job.path);removed++;}catch{break;}}
 return {removed,...await deletionStatus(identity)};
}
export async function retentionTask(identity:Identity,task:keyof typeof retentionSchemas,input:unknown){
 if(task==='data_status'){retentionSchemas.data_status.parse(input);return deletionStatus(identity);}
 const args=retentionSchemas[task].parse(input),prior=await transaction(identity,db=>priorOperation(db,identity,args.operationId,task,args));if(prior)return prior;
 const result=task==='data_orphan_scan'?await scanAbandonedFiles(identity,'after' in args?String(args.after):'',args.limit):await cleanupFiles(identity,args.limit);
 return transaction(identity,db=>operation(db,identity,args.operationId,task,args,async()=>result));
}
