// Chaves locais novas; não usa credenciais ou ambiente dos produtos de referência.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {generateKeyPair,exportJWK} from 'jose';
import {randomUUID} from 'node:crypto';
await mkdir('.local',{recursive:true});
let keys: string;
try { keys=await readFile('.local/jwt-keys.json','utf8'); }
catch { const pair=await generateKeyPair('ES256',{extractable:true}); keys=JSON.stringify([{...await exportJWK(pair.privateKey),kid:randomUUID(),alg:'ES256',use:'sig',key_ops:['sign','verify']}]); await writeFile('.local/jwt-keys.json',keys,{mode:0o600}); }
let env: string;
try { env=await readFile('.env','utf8'); } catch { env=await readFile('.env.example','utf8'); }
if(!/^APP_MODE=local$/m.test(env))throw Error('Configuração existente não é local.');
env=env.replace(/^LOCAL_JWT_KEYS=.*\r?\n?/gm,'')+`\nLOCAL_JWT_KEYS='${keys}'\n`;
await writeFile('.env',env,{mode:0o600});
console.log('Chave ES256 local preparada em arquivos ignorados pelo Git.');
