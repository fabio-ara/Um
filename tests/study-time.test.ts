import {test} from 'node:test';
import assert from 'node:assert/strict';
import {foregroundSeconds,remainingMinutes} from '../src/study-time.ts';
test('clock excludes hidden, unfocused, suspended and anomalous intervals',()=>{
 assert.equal(foregroundSeconds(1000,2000,true,true),1);
 for(const [end,visible,focused]of [[2000,false,true],[2000,true,false],[3601000,true,true],[900,true,true]] as const)assert.equal(foregroundSeconds(1000,end,visible,focused),0);
});
test('remaining estimate uses observed principal reading, excludes practice, and needs evidence',()=>{
 assert.equal(remainingMinutes(['a','b'],'a',[]),null);
 assert.equal(remainingMinutes(['a','b','c'],'b',[{unitId:'a',seconds:120,mode:'reading'},{unitId:'a',seconds:3600,mode:'practice'}]),4);
});
