import {randomUUID as uuid} from 'node:crypto';
import {execute} from '../src/service.ts';
import {sourceView} from '../src/sources.ts';
import type {Identity} from '../src/contracts.ts';
export async function sourceGuardFixture(actor:Identity,publish=true){
 const call=(name:any,args:any)=>execute(name,args,actor) as Promise<any>;
 const metadata={title:'Fonte de prova de direitos',language:'pt',nature:'original',extent:'fragment',authors:[],rights:{status:'permission',statement:'Fixture própria',evidence:'Prova sintética local',offlineAllowed:true},provenance:'Fonte criada exclusivamente para prova'};
 const projectId=(await call('project_create',{operationId:uuid(),title:'Fixture de direitos e publicação',metadata:{object:{kind:'theme',workIds:[],subject:'Direitos'},scope:'Fragmento sintético',language:'pt',audience:'Teste',configuration:{editorial:{},instructional:{}}}})).result.projectId;
 const sourceId=(await call('source_import',{operationId:uuid(),metadata,format:'text',text:'Conferir a fonte permite distinguir a afirmação da evidência usada para sustentá-la.'})).result.sourceId;
 await call('source_attach',{operationId:uuid(),projectId,sourceId});const source=await sourceView(actor,sourceId);
 const anchor={sourceId,sourceRevision:1,elementId:source.blocks[0].id,start:0,end:8,exact:'Conferir',prefix:'',suffix:''};
 const unitId=uuid(),coverageId=uuid(),provenance={kind:'example',references:['Fixture própria'],limitations:['Sem pretensão de conteúdo editorial real.']};
 const bundle={projectId,profileId:null,revision:1,baseRevision:1,units:[{id:unitId,title:'Distinguir afirmação e evidência',body:'Um exemplo sintético para conferir direitos e persistência.',references:[{id:uuid(),from:[anchor],to:[anchor],relation:'illustrates',provenance}],knowledgeTargets:[coverageId],provenance:[provenance]}],resources:[],choices:[],coverage:[{id:coverageId,description:'Conferir a fonte',unitIds:[unitId],sourceAnchors:[anchor],practiceIds:[]}],inspection:{kind:'ai',references:['Inspeção sintética explícita'],findings:[],completed:true}};
 if(publish)await call('bundle_publish',{operationId:uuid(),expectedRevision:0,bundle});
 return {call,metadata,projectId,sourceId,source,anchor,unitId,coverageId,bundle};
}
