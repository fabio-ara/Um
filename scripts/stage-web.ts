import {execFileSync} from 'node:child_process';
const release=process.argv.includes('--release');
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(release){
 if(process.env.UM_CANDIDATE_SHA!==head||execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('Pages exige candidata identificada e limpa.');
 const url=new URL(process.env.VITE_API_ORIGIN||'');
 if(url.protocol!=='https:'||url.username||url.password||['localhost','127.0.0.1','10.0.2.2','[::1]'].includes(url.hostname))throw Error('Pages exige backend HTTPS verificado.');
}
execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{stdio:'inherit',env:{...process.env,VITE_BASE:'/Um/',UM_BUILD_OUT:'dist'}});
