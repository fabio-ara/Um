import {randomUUID as uuid} from 'node:crypto';
import type {Identity} from '../src/contracts.ts';
import {sourceGuardFixture} from './source-guard-fixture.ts';
export async function personalStudyFixture(identity:Identity){
 const f=await sourceGuardFixture(identity),{call,projectId,unitId,coverageId,anchor}=f;
 const profileId=(await call('profile_create',{operationId:uuid(),self:true,fields:{name:'Titular sintético da continuidade'}})).result.profileId;
 await call('participation_add',{operationId:uuid(),projectId,profileId});
 const formId=uuid();await call('form_save',{operationId:uuid(),expectedRevision:0,definition:{id:formId,revision:1,projectId,profileId,questions:[{id:'support',type:'single_choice',prompt:'Qual apoio ajuda?',required:true,options:[{id:'Exemplos concretos',label:'Exemplos concretos'},{id:'Comparações',label:'Comparações'}]}],purposeByQuestion:{support:'Escolher apoio'},planningReference:'Fixture de continuidade',maxQuestions:4}});await call('form_publish',{operationId:uuid(),formId,expectedRevision:1});
 const submission=(await call('form_submit',{operationId:uuid(),formId,formRevision:1,answers:{support:'Exemplos concretos'}})).result;
 const questionId=uuid(),personal={projectId,profileId,revision:1,baseRevision:1,units:[],resources:[],choices:[{id:questionId,revision:1,unitId,profileId,position:0,prompt:'Como conferir a afirmação?',options:[{id:'a',text:'Consultar a fonte',feedback:'A fonte permite verificar a razão.'},{id:'b',text:'Repetir o enunciado',feedback:'Repetição não confere a razão.'}],correctOptionId:'a',coverageTargets:[coverageId],sources:[anchor]}],coverage:[{id:coverageId,description:'Conferir a fonte',unitIds:[unitId],sourceAnchors:[anchor],practiceIds:[questionId]}],inspection:f.bundle.inspection};
 const reasons=[{resourceId:questionId,submissionId:submission.submissionId,submissionRevision:1,questionIds:['support'],rationale:'A resposta solicita exemplo concreto de consulta.'}];
 await call('bundle_publish',{operationId:uuid(),expectedRevision:0,bundle:personal,reasons});
 return {...f,profileId,formId,submission,questionId,personal,reasons};
}
