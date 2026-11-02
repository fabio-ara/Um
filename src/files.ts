import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {config} from './config.ts';
import {ensure} from './errors.ts';
import {transaction} from './db.ts';
import {getPublic} from './importers.ts';
import type {Identity} from './contracts.ts';
export const hashBytes=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
// Contrato de host conferido em developers.openai.com/plugins/reference#define-file-inputs.
export const hostFileSchema=z.strictObject({download_url:z.url().max(16384),file_id:z.string().min(1).max(300),mime_type:z.string().max(200).optional(),file_name:z.string().max(500).optional()});
const hostFileHosts=new Set(['files.oaiusercontent.com','sdmntprbrazilsouth.oaiusercontent.com','oaisdmntprbrazilsouth.blob.core.windows.net']);
export async function hostFile(raw:unknown){
 const file=hostFileSchema.parse(raw),url=new URL(file.download_url);
 ensure(hostFileHosts.has(url.hostname)&&!url.hash,'FILE_ORIGIN','Origem do anexo ainda não verificada. Solicite um novo anexo ao cliente.',403);
 // getPublic pins a verified public address and retains TLS hostname validation.
 const response=await getPublic(url.href,8*1024*1024,AbortSignal.timeout(30000));
 ensure(response.status===200,'FILE_UNAVAILABLE','Anexo expirado ou indisponível; solicite novo acesso ao cliente.',409);
 return {bytes:response.body,name:file.file_name||'arquivo',mime:response.mime,fileId:file.file_id};
}
const root=resolve('.local/blobs');
function localPath(path:string){ensure(/^[a-f0-9-]{36}\/[a-f0-9-]{36}(?:\.[a-z]+)?$/.test(path),'INVALID_FILE','Identidade de arquivo inválida.');const dest=resolve(root,path);ensure(dest.startsWith(root+sep),'INVALID_FILE','Arquivo fora do armazenamento.');return dest;}
function storage(identity:Identity){
 ensure(config.storageUrl&&config.storageKey&&identity.accessToken,'CONFIGURATION','Storage autenticado não configurado.',503);
 return createClient(config.storageUrl,config.storageKey,{global:{headers:{Authorization:`Bearer ${identity.accessToken}`}},auth:{persistSession:false,autoRefreshToken:false}}).storage.from(config.bucket);
}
export async function putFile(identity:Identity,bytes:Uint8Array,mediaType:string){
 const path=`${identity.id}/${randomUUID()}`,sha256=hashBytes(bytes);
 if(config.local){const dest=localPath(path);await mkdir(dirname(dest),{recursive:true});const tmp=dest+'.preparing';await writeFile(tmp,bytes,{flag:'wx'});await rename(tmp,dest);}
 else {const {error}=await storage(identity).upload(path,bytes,{contentType:mediaType,upsert:false});ensure(!error,'STORAGE','Não foi possível preparar o arquivo.',503);}
 return {path,sha256,bytes:bytes.byteLength,mediaType};
}
/** The caller does not choose a filesystem path: an authorized metadata row does. */
export async function getFile(identity:Identity,path:string):Promise<Buffer>{
 const row=await transaction(identity,async db=>(await db.query('select path,sha256,bytes from um.files where path=$1',[path])).rows[0]);
 ensure(row,'NOT_FOUND','Arquivo indisponível.',404);let bytes:Buffer;
 if(config.local)bytes=await readFile(localPath(row.path));
 else{const {data,error}=await storage(identity).download(row.path);ensure(!error&&data,'STORAGE','Arquivo indisponível.',503);bytes=Buffer.from(await data.arrayBuffer());}
 ensure(bytes.length===Number(row.bytes)&&hashBytes(bytes)===row.sha256,'INTEGRITY','O arquivo não corresponde à revisão salva.',409);return bytes;
}
/** Only paths from a committed deletion ticket can reach physical deletion. */
export async function deleteQueuedFile(identity:Identity,path:string):Promise<void>{
 const allowed=await transaction(identity,async db=>(await db.query('select path from um.file_deletions where path=$1 and requested_by=$2 and completed_at is null',[path,identity.id])).rowCount);
 ensure(allowed,'NOT_FOUND','Remoção indisponível.',404);
 if(config.local)await rm(localPath(path),{force:true});
 else{const {error}=await storage(identity).remove([path]);ensure(!error,'STORAGE','Remoção de arquivo ainda não confirmada.',503);}
 await transaction(identity,db=>db.query('update um.file_deletions set completed_at=now() where path=$1 and completed_at is null',[path]));
}
