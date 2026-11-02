import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve('.'),output=resolve('.local/edge/um-api');
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty=Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim());
if(process.argv.includes('--release')&&(dirty||process.env.UM_CANDIDATE_SHA!==head))throw Error('Edge release exige candidata identificada e limpa.');
await mkdir(output,{recursive:true});const files:string[]=[];
async function copy(directory:string){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name),name=relative(root,path).replaceAll('\\','/');if(entry.isDirectory()){if(name!=='src/web')await copy(path);}else if(entry.isFile()&&entry.name.endsWith('.ts')&&name!=='src/server.ts'){await mkdir(resolve(output,name,'..'),{recursive:true});await copyFile(path,resolve(output,name));files.push(name);}}}
await copy(resolve('src'));
await writeFile(join(output,'index.ts'),(await readFile('supabase/functions/um-api/index.ts','utf8')).replaceAll("'../../../src/","'./src/"));files.push('index.ts');
const deps=JSON.parse(await readFile('package.json','utf8')).dependencies,imports:Record<string,string>={};
for(const [name,version]of Object.entries(deps)){if(name==='express'||name==='@modelcontextprotocol/node')continue;imports[name]=`npm:${name}@${version}`;imports[name+'/']=`npm:${name}@${version}/`;}
await writeFile(join(output,'deno.json'),JSON.stringify({imports,nodeModulesDir:'none',compilerOptions:{strict:true,lib:['deno.window','dom','dom.iterable','esnext']}},null,2)+'\n');files.push('deno.json');
const manifest=[];for(const name of files.sort())manifest.push({name,sha256:createHash('sha256').update(await readFile(join(output,name))).digest('hex')});
await writeFile(join(output,'build-identity.json'),JSON.stringify({product:'Um',function:'um-api',head,dirty,files:manifest},null,2)+'\n');
console.log(`Edge preparado: ${files.length} arquivos; head ${head}; dirty ${dirty}. Sem publicação.`);
