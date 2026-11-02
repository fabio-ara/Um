// Own disposable Um services only; never reads a hosted project's credentials.
import {mkdir,writeFile,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
try{await access('.local/storage.env');console.log('Configuração local existente preservada.');process.exit(0);}catch{}
const response=await fetch('http://127.0.0.1:4418/.well-known/jwks.json');if(!response.ok)throw Error('Auth local indisponível');
const jwks=await response.json();
await mkdir('.local',{recursive:true});
const values={DATABASE_URL:'postgres://postgres:um-local-admin-only@db:5432/um',AUTH_JWT_SECRET:randomBytes(48).toString('base64url'),JWT_JWKS:JSON.stringify(jwks),STORAGE_BACKEND:'file',STORAGE_FILE_BACKEND_PATH:'/var/lib/storage',UPLOAD_FILE_SIZE_LIMIT:'8388608',TENANT_ID:'um-local',REGION:'local',GLOBAL_S3_BUCKET:'um-local',PG_QUEUE_ENABLE:'false',DB_INSTALL_ROLES:'false',DB_ALLOW_MIGRATION_REFRESH:'false',LOG_LEVEL:'error',S3_PROTOCOL_ENABLED:'false'};
await writeFile('.local/storage.env',Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
console.log('Configuração privada de Storage local criada.');
