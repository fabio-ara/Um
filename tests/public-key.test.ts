import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPublishableKey} from '../src/public-key.ts';
test('configuração pública rejeita segredos e JWT de serviço',()=>{
 const jwt=(role:string)=>'header.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
 assert.equal(isPublishableKey(jwt('anon')),true);assert.equal(isPublishableKey('sb_publishable_synthetic'),true);
 for(const value of [jwt('service_role'),jwt('authenticated'),'sb_secret_synthetic','malformed'])assert.equal(isPublishableKey(value),false);
});
