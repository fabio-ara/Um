import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authProxyUrl} from '../src/auth-proxy.ts';
test('local auth proxy validates the normalized destination and preserves token queries',()=>{
 for(const path of ['/admin/x','/./admin/x','/%2e/admin/x','/user/../admin/x','/%61dmin/x','/user%2f..%2fadmin/x','/user/%252e%252e/admin/x'])assert.throws(()=>authProxyUrl('/auth/v1'+path,'http://127.0.0.1:4418'),/exposta|inválida/);
 assert.equal(authProxyUrl('/auth/v1/token?grant_type=password','http://127.0.0.1:4418').href,'http://127.0.0.1:4418/token?grant_type=password');
});
