import {test} from 'node:test';
import assert from 'node:assert/strict';
import {edgeRequest} from '../src/edge-request.ts';
const origin='https://project.supabase.co/functions/v1/um-api';
test('hosted gateway prefix preserves OAuth query, authorization and POST body',async()=>{
 const request=new Request('http://edge-runtime/um-api/oauth/token?state=a%2Bb',{method:'POST',headers:{authorization:'Bearer synthetic-token','content-type':'application/x-www-form-urlencoded'},body:'code=synthetic&resource=https%3A%2F%2Fproject.supabase.co%2Ffunctions%2Fv1%2Fum-api%2Fmcp'});
 const translated=edgeRequest(request,origin);
 assert.equal(translated.url,origin+'/oauth/token?state=a%2Bb');
 assert.equal(translated.headers.get('authorization'),'Bearer synthetic-token');
 assert.equal(translated.method,'POST');
 assert.equal(await translated.text(),'code=synthetic&resource=https%3A%2F%2Fproject.supabase.co%2Ffunctions%2Fv1%2Fum-api%2Fmcp');
 assert.equal(edgeRequest(new Request('http://edge-runtime/functions/v1/um-api/api/config'),origin).url,origin+'/api/config');
});
test('edge adapter does not accept sibling, encoded separator or prefix-confusion paths',()=>{
 for(const path of ['/another/api/config','/um-api-other/api/config','/um-api%2fapi/config','/functions/v1/um-api-other/api/config','/health']){
  const request=new Request('http://edge-runtime'+path);assert.equal(edgeRequest(request,origin),request);
 }
 const local=new Request('http://127.0.0.1:4417/api/config');assert.equal(edgeRequest(local,'http://127.0.0.1:4417'),local);
});
