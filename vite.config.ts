import {defineConfig} from 'vite';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {relative,join} from 'node:path';
const outDir=process.env.UM_BUILD_OUT||'dist';
// Shell-only offline mechanism adapted from AraRead (MIT); private files stay in IndexedDB.
export default defineConfig(({command,isPreview})=>({base:process.env.VITE_BASE||(command==='build'||isPreview?'/Um/':'/'),server:{host:'127.0.0.1',port:4419,strictPort:true},build:{target:'es2022',outDir},define:{__UM_API__:JSON.stringify(process.env.VITE_API_ORIGIN||'http://127.0.0.1:4417')},plugins:[{
 name:'um-offline-shell',closeBundle(){
  if(command!=='build')return;
  const files=readdirSync(outDir,{recursive:true,withFileTypes:true}).filter(f=>f.isFile()).map(f=>relative(outDir,join(f.parentPath,f.name)).replaceAll('\\','/')).filter(f=>f!=='sw.js').sort();
  const version=createHash('sha256').update(files.map(f=>f+':'+createHash('sha256').update(readFileSync(join(outDir,f))).digest('hex')).join('\n')).digest('hex');
  writeFileSync(join(outDir,'sw.js'),`const VERSION=${JSON.stringify(version)},FILES=${JSON.stringify(files)};\n`+readFileSync('src/web/shell-worker.js','utf8'));
 }
}]}));
