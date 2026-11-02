import {httpHandler} from '../../../src/http.ts';
import {config} from '../../../src/config.ts';
if(!config.local){
 if(!config.database||!config.storageUrl||!config.storageKey||!Deno.env.get('UM_OAUTH_ENCRYPTION_KEY'))throw Error('Configuração do Um incompleta.');
 for(const value of [config.origin,config.apiOrigin,config.authUrl,config.issuer])if(new URL(value).protocol!=='https:')throw Error('Configuração hospedada exige HTTPS.');
 if(config.storageKey.startsWith('sb_secret_'))throw Error('Chave pública incompatível.');
}
Deno.serve({hostname:config.local?'127.0.0.1':'0.0.0.0',port:Number(Deno.env.get('UM_EDGE_PORT')||8000)},httpHandler);
