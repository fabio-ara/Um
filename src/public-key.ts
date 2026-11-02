import {Buffer} from 'node:buffer';
/** Reject administrative secrets before public configuration can expose them. */
export function isPublishableKey(key:string){
 if(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))return true;
 try{const parts=key.split('.');return parts.length===3&&JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')).role==='anon';}catch{return false;}
}
